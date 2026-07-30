/**
 * MentalTap — Main entry point.
 * Two-phase start:
 *   1. Setup: getUserMedia → store stream
 *   2. Recording: user taps overlay → video.play() in gesture context → capture
 * All heavy analysis (HRV/FFT) runs only at end, not during recording.
 */

import { getCamera, startCapture, stopCamera } from './camera.js';
import { createBandpassFilter } from './signal-filter.js';
import { detectBeats } from './beat-detector.js';
import { computeHRV } from './hrv-calculator.js';
import { computeWaveformFeatures } from './waveform-features.js';
import { screenDisorders } from './zero-shot.js';
import { estimateGlucose } from './glucose-estimator.js';
import { WaveformDisplay } from './waveform-display.js';
import { t, initLang, setLang, getLang } from './i18n.js';
import {
  showStep, updateTimer, updateBPM, updateProgress,
  renderResults, showError, showSetupError,
  setButtonEnabled, getAgeSex, triggerBeatVisual,
} from './ui.js';
import { translatePage } from './translate.js';

const RECORDING_DURATION = 120;

// ---- State ----
let stream = null;
let track = null;
let stopCapture = null;
let waveform = null;
let recordingTimer = null;
let secondsRemaining = RECORDING_DURATION;
let allTimestamps = [];
let allGreenValues = [];

// ---- DOM ----
const waveformCanvas = document.getElementById('waveform-canvas');
const tapOverlay = document.getElementById('tap-overlay');

waveform = new WaveformDisplay(waveformCanvas);

// Init i18n
initLang();
translatePage();

// Language switcher
const langSwitch = document.getElementById('lang-switch');
langSwitch.addEventListener('click', () => {
  const next = getLang() === 'en' ? 'zh-HK' : 'en';
  setLang(next);
  translatePage();
  langSwitch.textContent = t('lang.switch');
  // Re-render explainers if results are visible
  const explainerMetrics = document.getElementById('explainer-metrics');
  const explainerCalc = document.getElementById('explainer-calc');
  if (explainerMetrics) {
    explainerMetrics.querySelector('.explainer-content').innerHTML = t('explain.metrics');
  }
  if (explainerCalc) {
    explainerCalc.querySelector('.explainer-content').innerHTML = t('explain.calc');
  }
  renderRefs();
  updateDisclaimer();
});
langSwitch.textContent = t('lang.switch');

function updateDisclaimer() {
  const disc = document.querySelector('.disclaimer');
  if (disc) disc.innerHTML = t('results.disclaimer');
}
updateDisclaimer();

// Render reference list (called on init and lang switch)
function renderRefs() {
  const container = document.getElementById('refs-container');
  if (!container) return;
  const refs = [
    ['tag.hrv_norms', 'ref.hrv_norms_berg'],
    ['tag.hrv_norms', 'ref.hrv_norms_ortega'],
    ['tag.depression', 'ref.depression_wu'],
    ['tag.all_disorders', 'ref.all_transpsych'],
    ['tag.smartphone_ppg', 'ref.ppg_cajal'],
    ['tag.smartphone_ppg', 'ref.ppg_liu'],
    ['tag.pulse_waveform', 'ref.waveform_kaizu'],
    ['tag.suicidal_ideation', 'ref.suicide_khandoker'],
    ['tag.wearable_ppg', 'ref.bipolar_lyu'],
    ['tag.multi_disorder', 'ref.multi_gpsychsw'],
    ['tag.signal_processing', 'ref.signal_cho'],
    ['tag.ppg_glucose', 'ref.glucose_chinchanikar'],
    ['tag.ppg_glucose', 'ref.glucose_raju'],
    ['tag.ppg_glucose', 'ref.glucose_sridevi'],
    ['tag.metabolic', 'ref.metabolic_wong'],
    ['tag.multimodal', 'ref.multimodal_jin'],
  ];
  container.innerHTML = refs.map(([tag, ref]) =>
    `<div class="ref"><span class="ref-tag">${t(tag)}</span><span>${t(ref)}</span></div>`
  ).join('');
}
renderRefs();

showStep('step-welcome');

document.getElementById('btn-start').addEventListener('click', () => showStep('step-setup'));
document.getElementById('btn-ready').addEventListener('click', () => setupCamera());
document.getElementById('btn-cancel').addEventListener('click', () => cancelRecording());
document.getElementById('btn-retake').addEventListener('click', () => showStep('step-setup'));
document.getElementById('btn-retry').addEventListener('click', () => showStep('step-setup'));

// ---- Phase 1: Get camera permission (user gesture #1) ----
async function setupCamera() {
  try {
    setButtonEnabled('btn-ready', false);
    showSetupError('');

    const camera = await getCamera();
    stream = camera.stream;
    track = camera.track;

    if (!track || track.readyState !== 'live') {
      throw new Error('Camera not available');
    }

    // Transition to recording screen — show tap overlay
    showStep('step-recording');
    tapOverlay.classList.remove('hidden');
    waveform.clear();
    secondsRemaining = RECORDING_DURATION;
    updateTimer(secondsRemaining);
    updateBPM(0);
    updateProgress(0);

    // Wait for user tap on overlay (user gesture #2 for video.play)
    tapOverlay.onclick = () => beginCapture();

  } catch (err) {
    console.error('Setup error:', err);
    let msg = err.message || t('error.camera_unavailable');
    if (err.name === 'NotAllowedError') msg = t('error.camera_denied');
    else if (err.name === 'NotFoundError') msg = t('error.camera_not_found');
    showSetupError(msg);
    setButtonEnabled('btn-ready', true);
  }
}

// ---- Phase 2: Start capture (user gesture #2 — preserves autoplay permission) ----
function beginCapture() {
  tapOverlay.classList.add('hidden');

  // Resize canvas now that it's visible
  waveform.resize();

  allTimestamps = [];
  allGreenValues = [];

  let recentVals = [];
  let recentTimes = [];
  let lastPeakTs = 0;
  let prevPeakTs = 0;
  let bpmHistory = [];

  stopCapture = startCapture(track, (greenValue, timestamp) => {
    // Accumulate all data for end-of-recording analysis
    allGreenValues.push(greenValue);
    allTimestamps.push(timestamp);

    if (allGreenValues.length > 7200) {
      allGreenValues = allGreenValues.slice(-5400);
      allTimestamps = allTimestamps.slice(-5400);
    }

    // Push raw green value to waveform every 3rd frame (~10Hz)
    if (allGreenValues.length % 3 === 0) {
      waveform.push(greenValue);
    }

    // BPM via detrended signal minima detection (5s rolling window)
    recentVals.push(greenValue);
    recentTimes.push(timestamp);
    if (recentVals.length > 180) {
      recentVals = recentVals.slice(-180);
      recentTimes = recentTimes.slice(-180);
    }

    if (recentVals.length >= 90) {
      // ---- Fingertip presence check ----
      // With fingertip covering camera+flash: green values are dark (lit through skin),
      // stable, with subtle pulsatile variation. Without fingertip: bright, high-variance.
      const valMean = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;
      const valStd = Math.sqrt(
        recentVals.reduce((a, b) => a + (b - valMean) ** 2, 0) / recentVals.length
      );
      const valRange = Math.max(...recentVals) - Math.min(...recentVals);

      // Conditions for valid fingertip signal:
      // 1. Mean brightness < 80 (fingertip blocks most ambient light, flash shines through)
      // 2. Raw std < 25 (ambient light without finger causes large swings from auto-exposure)
      // 3. Range > 0.5 (there must be SOME variation — completely flat = no signal)
      const fingerPresent = valMean < 80 && valStd < 25 && valRange > 0.5;

      if (!fingerPresent) {
        // Reset BPM state when finger is removed
        bpmHistory = [];
        lastPeakTs = 0;
        prevPeakTs = 0;
        updateBPM(0);
        return;
      }

      // ---- Signal looks like a fingertip — run beat detection ----
      const n = recentVals.length;
      const smaWindow = 30;
      const detrended = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - smaWindow);
        let sum = 0;
        for (let j = start; j <= i; j++) sum += recentVals[j];
        detrended[i] = recentVals[i] - sum / (i - start + 1);
      }

      const dMean = detrended.reduce((a, b) => a + b, 0) / n;
      const dStd = Math.sqrt(detrended.reduce((a, b) => a + (b - dMean) ** 2, 0) / n) || 1e-6;

      const threshold = dMean - dStd * 0.4;

      let beatDetected = false;
      for (let i = 1; i < n - 1; i++) {
        const ts = recentTimes[i];
        if (detrended[i] < threshold &&
            detrended[i] < detrended[i - 1] &&
            detrended[i] <= detrended[i + 1] &&
            ts - lastPeakTs > 400) {
          if (prevPeakTs > 0 && lastPeakTs > 0) {
            const ibi = lastPeakTs - prevPeakTs;
            if (ibi >= 300 && ibi <= 2000) {
              const instantBpm = Math.round(60000 / ibi);
              if (instantBpm >= 40 && instantBpm <= 180) {
                bpmHistory.push(instantBpm);
                if (bpmHistory.length > 8) bpmHistory.shift();
                updateBPM(Math.round(bpmHistory.reduce((a, b) => a + b, 0) / bpmHistory.length));
              }
            }
          }
          prevPeakTs = lastPeakTs;
          lastPeakTs = ts;
          beatDetected = true;
        }
      }

      if (beatDetected) {
        waveform.markBeat();
        triggerBeatVisual();
      }
    }
  });

  // Timer
  recordingTimer = setInterval(() => {
    secondsRemaining--;
    updateTimer(secondsRemaining);
    updateProgress(((RECORDING_DURATION - secondsRemaining) / RECORDING_DURATION) * 100);
    if (secondsRemaining <= 0) finishRecording();
  }, 1000);
}

// ---- Analysis (runs once at end) ----
function finishRecording() {
  clearInterval(recordingTimer);
  recordingTimer = null;

  if (stopCapture) { stopCapture(); stopCapture = null; }
  if (stream) { stopCamera(stream); stream = null; track = null; }

  if (allGreenValues.length < 180) {
    showError(t('error.no_data'));
    cleanup();
    return;
  }

  try {
    // Build PPG signal
    const raw = new Float64Array(allGreenValues);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const inverted = Float64Array.from(raw, v => -(v - mean));

    // Detrend
    const w = Math.min(60, Math.floor(raw.length / 3));
    const trend = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const start = Math.max(0, i - w);
      let sum = 0;
      for (let j = start; j <= i; j++) sum += inverted[j];
      trend[i] = sum / (i - start + 1);
    }
    const detrended = Float64Array.from(raw, (_, i) => inverted[i] - trend[i]);

    // Normalize
    const sqSum = detrended.reduce((a, b) => a + b * b, 0);
    const std = Math.sqrt(sqSum / raw.length) || 1;
    const signal = Float64Array.from(detrended, v => v / std);

    // Bandpass filter
    const bpFilter = createBandpassFilter(30);
    const filtered = bpFilter.process(signal);

    // Beat detection
    const times = new Float64Array(allTimestamps);
    const { beats, ibis, bpm } = detectBeats(filtered, times, 30);

    // HRV
    const hrv = computeHRV(ibis);

    // Pulse waveform features (for glucose estimation)
    const waveformFeatures = computeWaveformFeatures(filtered, times, beats);

    // Estimate glucose from PPG features
    const glucose = estimateGlucose(hrv, waveformFeatures, bpm);

    // Zero-shot screening with combined HRV + glucose
    const { age, sex } = getAgeSex();
    const screening = screenDisorders(hrv, age, sex, glucose.mmol);

    renderResults(hrv, screening, age, sex, glucose);
    showStep('step-results');
  } catch (err) {
    console.error('Analysis error:', err);
    showError(t('error.analysis_failed'));
  }

  cleanup();
}

function cancelRecording() {
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  if (stopCapture) { stopCapture(); stopCapture = null; }
  if (stream) { stopCamera(stream); stream = null; track = null; }
  waveform.clear();
  showStep('step-setup');
  cleanup();
}

function cleanup() {
  allTimestamps = [];
  allGreenValues = [];
  setButtonEnabled('btn-ready', true);
  secondsRemaining = RECORDING_DURATION;
}
