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
import { editIbis } from './ibi-editor.js';
import { evaluateSegments } from './signal-quality.js';
import { computeHRV } from './hrv-calculator.js';
import { computeWaveformFeatures } from './waveform-features.js';
import { screenDisorders } from './zero-shot.js';
import { estimateGlucose } from './glucose-estimator.js';
import { WaveformDisplay } from './waveform-display.js';
import { t, initLang, setLang, getLang } from './i18n.js';
import {
  showStep, updateTimer, updateBPM, updateProgress,
  renderResults, reRenderResults, showError, showSetupError,
  setButtonEnabled, getAgeSex, triggerBeatVisual,
} from './ui.js';
import { translatePage } from './translate.js';

const RECORDING_DURATION = 120;

// RMSSD noise-floor (ms), calibrated on clean synthetic PPG through the fixed
// pipeline (see calibrate-floor.mjs): RMSSD²_measured ≈ RMSSD²_true + c.
// The 30 fps floor is ~4.9 ms; 60 fps ~4.5 ms.
const RMSSD_FLOOR = { 30: 4.9, 60: 4.5 };

/** Estimate the real capture sample rate from the recorded frame timestamps. */
function estimateFs(times) {
  const diffs = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 5 && d < 200) diffs.push(d);
  }
  if (!diffs.length) return 30;
  diffs.sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  return Math.max(15, Math.min(90, Math.round(1000 / med)));
}

/** De-bias RMSSD for the beat-timing noise floor so low-HRV isn't inflated. */
function correctRMSSD(hrv, fs) {
  const floor = fs >= 45 ? RMSSD_FLOOR[60] : RMSSD_FLOOR[30];
  const corr = Math.sqrt(Math.max(hrv.rmssd * hrv.rmssd - floor * floor, 0));
  return { ...hrv, rmssd: Math.round(corr * 100) / 100, rmssdFloor: floor };
}

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
  reRenderResults(); // screening list carries translated disorder descriptions
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

    if (allGreenValues.length > 10800) {
      allGreenValues = allGreenValues.slice(-8100);
      allTimestamps = allTimestamps.slice(-8100);
    }

    // Push raw green value to the waveform every 3rd frame
    if (allGreenValues.length % 3 === 0) {
      waveform.push(greenValue);
    }

    // BPM via detrended signal valley detection (~6s rolling window).
    // Window sizes are scaled by the live capture rate so the same code works
    // at 30 or 60 fps.
    recentVals.push(greenValue);
    recentTimes.push(timestamp);
    const liveFs = recentTimes.length > 4 ? estimateFs(recentTimes) : 30;
    const windowLen = Math.max(90, Math.round(6 * liveFs));
    if (recentVals.length > windowLen) {
      recentVals = recentVals.slice(-windowLen);
      recentTimes = recentTimes.slice(-windowLen);
    }

    if (recentVals.length >= Math.round(3 * liveFs)) {
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
      // Cumulative-sum running-mean detrend (O(n), ~1s window scaled to fs)
      const n = recentVals.length;
      const smaWindow = Math.round(liveFs);
      const detrended = new Float64Array(n);
      let run = 0;
      for (let i = 0; i < n; i++) {
        run += recentVals[i];
        if (i > smaWindow) run -= recentVals[i - smaWindow - 1];
        detrended[i] = recentVals[i] - run / Math.min(smaWindow + 1, i + 1);
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
    // Real capture rate (30 or 60 fps on typical phones) — every downstream
    // window/coefficient is parameterized on it.
    const fs = estimateFs(allTimestamps);

    // Segmental signal-quality gate: drop corrupted windows (motion, exposure
    // shifts, finger lifts). Garbage windows would otherwise feed spurious
    // beats into the HRV metrics; require at least 60 s of accepted signal.
    const segments = evaluateSegments(allGreenValues, allTimestamps, fs);
    const acceptedSec = segments
      .filter(s => s.good)
      .reduce((sum, s) => sum + (s.end - s.start) / fs, 0);
    if (acceptedSec < 60) {
      showError(t('error.signal_quality'));
      return;
    }
    const goodGreen = [];
    const goodTimes = [];
    segments.forEach(seg => {
      if (!seg.good) return;
      for (let i = seg.start; i < seg.end; i++) {
        goodGreen.push(allGreenValues[i]);
        goodTimes.push(allTimestamps[i]);
      }
    });

    // Build PPG signal
    const times = new Float64Array(goodTimes);
    const raw = new Float64Array(goodGreen);
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
    const bpFilter = createBandpassFilter(fs);
    const filtered = bpFilter.process(signal);

    // Beat detection
    const { beats, ibis, bpm } = detectBeats(filtered, times, fs);

    // IBI artifact editing — a single missed/extra beat would otherwise
    // dominate RMSSD/SDNN (inflating them by >50%) and push every disorder
    // posterior toward false negatives.
    const edited = editIbis(ibis);
    if (!edited.clean) {
      showError(t('error.no_data'));
      return;
    }

    // HRV, with RMSSD de-biased for the beat-timing noise floor
    const hrv = correctRMSSD(computeHRV(edited.ibis), fs);

    // Bail on insufficient beats — all-zero HRV metrics fed into the Bayesian
    // screening would produce wildly inflated false-positive posteriors.
    if (hrv.error) {
      showError(t('error.no_data'));
      return;
    }

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
