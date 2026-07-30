/**
 * MentalTap — Main entry point.
 * Wires camera → PPG extraction → Web Worker signal processing →
 * zero-shot classifier → UI layer.
 */

import { getCamera, startCapture, stopCamera } from './camera.js';
import { createPPGExtractor } from './ppg-extractor.js';
import { screenDisorders } from './zero-shot.js';
import { WaveformDisplay } from './waveform-display.js';
import {
  showStep, updateTimer, updateBPM, updateProgress,
  renderResults, showError, showSetupError,
  setButtonEnabled, getAgeSex,
} from './ui.js';
import SignalWorker from '../workers/signal-worker.js?worker';

// ---- State ----
const RECORDING_DURATION = 120; // seconds
let stream = null;
let track = null;
let stopCapture = null;
let ppgExtractor = null;
let worker = null;
let waveform = null;
let recordingTimer = null;
let secondsRemaining = RECORDING_DURATION;
let lastHRV = null;
let lastBPM = 0;

// ---- DOM Elements ----
const btnStart = document.getElementById('btn-start');
const btnReady = document.getElementById('btn-ready');
const btnCancel = document.getElementById('btn-cancel');
const btnRetake = document.getElementById('btn-retake');
const btnRetry = document.getElementById('btn-retry');
const waveformCanvas = document.getElementById('waveform-canvas');

// ---- Init ----
waveform = new WaveformDisplay(waveformCanvas);
showStep('step-welcome');

// ---- Button Handlers ----
btnStart.addEventListener('click', () => {
  showStep('step-setup');
});

btnReady.addEventListener('click', async () => {
  await startRecording();
});

btnCancel.addEventListener('click', () => {
  cancelRecording();
});

btnRetake.addEventListener('click', () => {
  showStep('step-setup');
});

btnRetry.addEventListener('click', () => {
  showStep('step-setup');
});

// ---- Recording Flow ----
async function startRecording() {
  try {
    setButtonEnabled('btn-ready', false);
    showSetupError('');

    // Get camera
    const camera = await getCamera();
    stream = camera.stream;
    track = camera.track;

    // Check that video track is live
    if (!track || track.readyState !== 'live') {
      throw new Error('Could not access camera. Please check permissions.');
    }

    // Init PPG extractor
    ppgExtractor = createPPGExtractor();

    // Init Web Worker (Vite bundles via ?worker import)
    worker = new SignalWorker();

    worker.onerror = (err) => {
      console.error('Worker error:', err);
      cancelRecording();
      showError('Signal processing error. Please ensure your fingertip covers the camera and flash completely, then try again.');
    };

    worker.postMessage({ type: 'init', payload: { sampleRate: 30 } });

    worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'error') {
        console.error('Worker processing error:', payload.message);
        cancelRecording();
        showError(`Signal processing failed: ${payload.message}. Try again with your fingertip fully covering the camera.`);
        return;
      }
      if (type === 'result') {
        lastBPM = payload.bpm;
        lastHRV = payload.hrv;
        updateBPM(payload.bpm);

        // Feed display signal to waveform
        if (payload.displaySignal?.length > 0) {
          const step = Math.max(1, Math.floor(payload.displaySignal.length / 60));
          for (let i = 0; i < payload.displaySignal.length; i += step) {
            waveform.push(payload.displaySignal[i]);
          }
        }
      }
    };

    // Transition to recording step
    showStep('step-recording');
    secondsRemaining = RECORDING_DURATION;
    updateTimer(secondsRemaining);
    updateBPM(0);
    updateProgress(0);

    // Start frame capture
    stopCapture = startCapture(track, (greenValue, timestamp) => {
      if (!ppgExtractor) return;

      const result = ppgExtractor.add(greenValue, timestamp);
      if (result && worker) {
        worker.postMessage({
          type: 'process',
          payload: {
            signal: Array.from(result.signal),
            timestamps: Array.from(result.timestamps),
            sampleRate: 30,
          },
        });
      }
    });

    // Start countdown timer
    recordingTimer = setInterval(() => {
      secondsRemaining--;
      updateTimer(secondsRemaining);
      updateProgress(((RECORDING_DURATION - secondsRemaining) / RECORDING_DURATION) * 100);

      if (secondsRemaining <= 0) {
        finishRecording();
      }
    }, 1000);

  } catch (err) {
    console.error('Recording error:', err);
    let message = err.message || 'Camera access failed.';
    if (err.name === 'NotAllowedError') {
      message = 'Camera permission denied. Please allow camera access and try again.';
    } else if (err.name === 'NotFoundError') {
      message = 'No camera found. This app requires a rear camera with flash.';
    } else if (err.name === 'NotReadableError') {
      message = 'Camera is in use by another app. Please close other apps and try again.';
    }
    showSetupError(message);
    setButtonEnabled('btn-ready', true);
  }
}

function finishRecording() {
  // Stop timers and capture
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  if (stopCapture) {
    stopCapture();
    stopCapture = null;
  }

  if (stream) {
    stopCamera(stream);
    stream = null;
    track = null;
  }

  // Get final results from worker
  if (worker && lastHRV) {
    const { age, sex } = getAgeSex();
    const screening = screenDisorders(lastHRV, age, sex);
    renderResults(lastHRV, screening, age, sex);
  } else {
    showError('Not enough data collected. Please try again with a steady fingertip.');
    cleanup();
    return;
  }

  showStep('step-results');
  cleanup();
}

function cancelRecording() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  if (stopCapture) {
    stopCapture();
    stopCapture = null;
  }

  if (stream) {
    stopCamera(stream);
    stream = null;
    track = null;
  }

  cleanup();
  waveform.clear();
  showStep('step-setup');
}

function cleanup() {
  if (worker) {
    try { worker.postMessage({ type: 'reset' }); } catch {}
    worker.terminate();
    worker = null;
  }
  ppgExtractor = null;
  setButtonEnabled('btn-ready', true);
  secondsRemaining = RECORDING_DURATION;
  lastHRV = null;
  lastBPM = 0;
}
