/**
 * MentalTap — Main entry point.
 * Camera → PPG → live waveform + BPM → final HRV → zero-shot screening.
 * All processing on main thread. Heavy HRV/FFT only at end of recording.
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

// ---- Constants ----
const RECORDING_DURATION = 120; // seconds

// ---- State ----
let stream = null;
let track = null;
let stopCapture = null;
let ppgExtractor = null;
let waveform = null;
let recordingTimer = null;
let secondsRemaining = RECORDING_DURATION;

// Accumulate all PPG data during recording for final analysis
let allTimestamps = [];
let allGreenValues = [];

// ---- DOM ----
const btnStart = document.getElementById('btn-start');
const btnReady = document.getElementById('btn-ready');
const btnCancel = document.getElementById('btn-cancel');
const btnRetake = document.getElementById('btn-retake');
const btnRetry = document.getElementById('btn-retry');
const waveformCanvas = document.getElementById('waveform-canvas');

// ---- Init ----
waveform = new WaveformDisplay(waveformCanvas);
showStep('step-welcome');

btnStart.addEventListener('click', () => showStep('step-setup'));
btnReady.addEventListener('click', () => startRecording());
btnCancel.addEventListener('click', () => cancelRecording());
btnRetake.addEventListener('click', () => showStep('step-setup'));
btnRetry.addEventListener('click', () => showStep('step-setup'));

// ---- Recording ----
async function startRecording() {
  try {
    setButtonEnabled('btn-ready', false);
    showSetupError('');

    // Get camera
    const camera = await getCamera();
    stream = camera.stream;
    track = camera.track;

    if (!track || track.readyState !== 'live') {
      throw new Error('Camera not available');
    }

    // Init
    ppgExtractor = createPPGExtractor();
    allTimestamps = [];
    allGreenValues = [];

    // Transition to recording
    showStep('step-recording');
    secondsRemaining = RECORDING_DURATION;
    updateTimer(secondsRemaining);
    updateBPM(0);
    updateProgress(0);

    // Quick BPM tracker — simple peak counter on recent window
    let recentVals = [];
    let lastPeakTime = 0;
    let bpmHistory = [];

    // Start frame capture
    stopCapture = startCapture(track, (greenValue, timestamp) => {
      // Store for final analysis
      allGreenValues.push(greenValue);
      allTimestamps.push(timestamp);

      // Keep buffers bounded
      if (allGreenValues.length > 7200) {
        allGreenValues = allGreenValues.slice(-5400);
        allTimestamps = allTimestamps.slice(-5400);
      }

      // Feed PPG extractor for live waveform
      const result = ppgExtractor.add(greenValue, timestamp);
      if (result) {
        // Push recent ~1s of signal to waveform display
        const dispLen = Math.min(30, result.signal.length);
        for (let i = result.signal.length - dispLen; i < result.signal.length; i++) {
          waveform.push(result.signal[i]);
        }
      }

      // Quick BPM: count peaks in green values over ~5s window
      recentVals.push(greenValue);
      if (recentVals.length > 180) recentVals = recentVals.slice(-180);

      if (recentVals.length >= 90) {
        const avg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;
        const threshold = avg * 1.002; // slight above mean = heartbeat candidate
        let peakCount = 0;
        for (let i = 1; i < recentVals.length - 1; i++) {
          if (recentVals[i] > threshold &&
              recentVals[i] > recentVals[i - 1] &&
              recentVals[i] >= recentVals[i + 1]) {
            // Refractory check: ~0.4s at 30fps = 12 frames
            if (i - lastPeakTime > 12) {
              peakCount++;
              lastPeakTime = i;
            }
          }
        }

        if (peakCount > 0) {
          const bpm = Math.round(peakCount * 12); // peaks in 5s → peaks/min
          if (bpm >= 40 && bpm <= 180) {
            bpmHistory.push(bpm);
            if (bpmHistory.length > 5) bpmHistory.shift();
            const avgBpm = Math.round(bpmHistory.reduce((a, b) => a + b, 0) / bpmHistory.length);
            updateBPM(avgBpm);
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

  } catch (err) {
    console.error('Recording error:', err);
    let msg = err.message || 'Camera access failed.';
    if (err.name === 'NotAllowedError') msg = 'Camera permission denied. Please allow camera access and try again.';
    else if (err.name === 'NotFoundError') msg = 'No camera found. This app requires a rear camera.';
    else if (err.name === 'NotReadableError') msg = 'Camera is in use by another app. Close other apps and try again.';
    showSetupError(msg);
    setButtonEnabled('btn-ready', true);
  }
}

function finishRecording() {
  clearInterval(recordingTimer);
  recordingTimer = null;

  if (stopCapture) { stopCapture(); stopCapture = null; }
  if (stream) { stopCamera(stream); stream = null; track = null; }

  // ---- Full analysis of accumulated data ----
  if (allGreenValues.length < 180) { // need at least 6s
    showError('Not enough data. Keep your fingertip steady on the camera for the full 2 minutes.');
    cleanup();
    return;
  }

  try {
    // Build full PPG signal
    const raw = new Float64Array(allGreenValues);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const inverted = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) inverted[i] = -(raw[i] - mean);

    // Detrend with window ~60 samples
    const w = Math.min(60, Math.floor(raw.length / 3));
    const trend = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const start = Math.max(0, i - w);
      let sum = 0;
      for (let j = start; j <= i; j++) sum += inverted[j];
      trend[i] = sum / (i - start + 1);
    }
    const detrended = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) detrended[i] = inverted[i] - trend[i];

    // Normalize
    const sqSum = detrended.reduce((a, b) => a + b * b, 0);
    const std = Math.sqrt(sqSum / raw.length) || 1;
    const signal = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) signal[i] = detrended[i] / std;

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
    showError('Analysis failed. Please try again with a steady fingertip.');
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
