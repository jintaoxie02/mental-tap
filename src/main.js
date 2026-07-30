/**
 * MentalTap — Main entry point.
 * Two-phase start:
 *   1. Setup: getUserMedia → store stream
 *   2. Recording: user taps overlay → video.play() in gesture context → capture
 * All heavy analysis (HRV/FFT) runs only at end, not during recording.
 */

import { getCamera, startCapture, stopCamera } from './camera.js';
import { createPPGExtractor } from './ppg-extractor.js';
import { createBandpassFilter } from './signal-filter.js';
import { detectBeats } from './beat-detector.js';
import { computeHRV } from './hrv-calculator.js';
import { screenDisorders } from './zero-shot.js';
import { WaveformDisplay } from './waveform-display.js';
import {
  showStep, updateTimer, updateBPM, updateProgress,
  renderResults, showError, showSetupError,
  setButtonEnabled, getAgeSex,
} from './ui.js';

const RECORDING_DURATION = 120;

// ---- State ----
let stream = null;
let track = null;
let stopCapture = null;
let ppgExtractor = null;
let waveform = null;
let recordingTimer = null;
let secondsRemaining = RECORDING_DURATION;
let allTimestamps = [];
let allGreenValues = [];

// ---- DOM ----
const waveformCanvas = document.getElementById('waveform-canvas');
const tapOverlay = document.getElementById('tap-overlay');

waveform = new WaveformDisplay(waveformCanvas);
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
    let msg = err.message || 'Camera access failed.';
    if (err.name === 'NotAllowedError') msg = 'Camera permission denied. Allow camera access and try again.';
    else if (err.name === 'NotFoundError') msg = 'No rear camera found.';
    showSetupError(msg);
    setButtonEnabled('btn-ready', true);
  }
}

// ---- Phase 2: Start capture (user gesture #2 — preserves autoplay permission) ----
function beginCapture() {
  tapOverlay.classList.add('hidden');

  ppgExtractor = createPPGExtractor();
  allTimestamps = [];
  allGreenValues = [];

  // Quick BPM state
  let recentVals = [];
  let lastPeakTime = 0;
  let bpmHistory = [];

  // Start frame capture — video.play() happens inside startCapture(),
  // now within a fresh user gesture context
  stopCapture = startCapture(track, (greenValue, timestamp) => {
    allGreenValues.push(greenValue);
    allTimestamps.push(timestamp);

    if (allGreenValues.length > 7200) {
      allGreenValues = allGreenValues.slice(-5400);
      allTimestamps = allTimestamps.slice(-5400);
    }

    // Waveform display — only push every few frames to avoid overload
    const result = ppgExtractor.add(greenValue, timestamp);
    if (result && allGreenValues.length % 3 === 0) {
      // Push just the latest value (smoothed)
      const sig = result.signal;
      waveform.push(sig[sig.length - 1]);
    }

    // Quick BPM from green value peaks (lightweight)
    recentVals.push(greenValue);
    if (recentVals.length > 180) recentVals = recentVals.slice(-180);

    if (recentVals.length >= 90) {
      const avg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;
      const threshold = avg * 1.002;
      let peakCount = 0;
      for (let i = 1; i < recentVals.length - 1; i++) {
        if (recentVals[i] > threshold &&
            recentVals[i] > recentVals[i - 1] &&
            recentVals[i] >= recentVals[i + 1] &&
            i - lastPeakTime > 12) {
          peakCount++;
          lastPeakTime = i;
        }
      }
      if (peakCount > 0) {
        const bpm = Math.round(peakCount * 12);
        if (bpm >= 40 && bpm <= 180) {
          bpmHistory.push(bpm);
          if (bpmHistory.length > 5) bpmHistory.shift();
          updateBPM(Math.round(bpmHistory.reduce((a, b) => a + b, 0) / bpmHistory.length));
        }
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
    showError('Not enough data. Keep your fingertip steady for the full duration.');
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
    const { ibis, bpm } = detectBeats(filtered, times, 30);

    // HRV
    const hrv = computeHRV(ibis);

    // Zero-shot screening
    const { age, sex } = getAgeSex();
    const screening = screenDisorders(hrv, age, sex);

    renderResults(hrv, screening, age, sex);
    showStep('step-results');
  } catch (err) {
    console.error('Analysis error:', err);
    showError('Analysis failed. Try again with a steady fingertip.');
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
  ppgExtractor = null;
  allTimestamps = [];
  allGreenValues = [];
  setButtonEnabled('btn-ready', true);
  secondsRemaining = RECORDING_DURATION;
}
