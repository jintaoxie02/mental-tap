/**
 * Signal processing Web Worker.
 * Offloads bandpass filtering, beat detection, and HRV computation
 * from the main thread so the UI stays responsive during recording.
 */

import { createBandpassFilter } from '../src/signal-filter.js';
import { detectBeats } from '../src/beat-detector.js';
import { computeHRV } from '../src/hrv-calculator.js';

let filter = null;
let signalBuffer = [];
let timestampBuffer = [];
let sampleCount = 0;

self.onmessage = function (e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'init': {
      const sampleRate = payload.sampleRate || 30;
      filter = createBandpassFilter(sampleRate);
      signalBuffer = [];
      timestampBuffer = [];
      sampleCount = 0;
      break;
    }

    case 'process': {
      // payload: { signal: Float64Array, timestamps: Float64Array }
      // Accumulate samples
      for (let i = 0; i < payload.signal.length; i++) {
        signalBuffer.push(payload.signal[i]);
        timestampBuffer.push(payload.timestamps[i]);
      }
      sampleCount += payload.signal.length;

      // Keep buffer manageable
      const maxBuffer = 5400; // ~3 min at 30fps
      if (signalBuffer.length > maxBuffer) {
        signalBuffer = signalBuffer.slice(-maxBuffer);
        timestampBuffer = timestampBuffer.slice(-maxBuffer);
      }

      // Need at least 2 seconds of data
      if (signalBuffer.length < 60) {
        self.postMessage({
          type: 'interim',
          payload: { bpm: 0, sampleCount },
        });
        return;
      }

      // Apply bandpass filter to recent data
      const signal = new Float64Array(signalBuffer);
      const filtered = filter.process(signal);

      // Re-initialize filter state to avoid transient accumulation issues
      // ponytail: full re-filter is O(n), fine for n < 10k
      filter.reset();
      const filtered2 = filter.process(signal);

      // Detect beats
      const timestamps = new Float64Array(timestampBuffer);
      const { beats, ibis, bpm } = detectBeats(filtered2, timestamps, payload.sampleRate || 30);

      // Compute HRV if we have enough beats
      let hrv = null;
      if (ibis.length >= 10) {
        hrv = computeHRV(ibis);
      }

      // Compute last few seconds of filtered signal for waveform display
      const displayLen = Math.min(300, filtered2.length); // last 10 seconds
      const displaySignal = Array.from(filtered2.slice(-displayLen));

      self.postMessage({
        type: 'result',
        payload: {
          bpm,
          ibiCount: ibis.length,
          hrv,
          displaySignal,
          sampleCount,
        },
      });
      break;
    }

    case 'reset': {
      if (filter) filter.reset();
      signalBuffer = [];
      timestampBuffer = [];
      sampleCount = 0;
      break;
    }
  }
};
