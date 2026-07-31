/**
 * Beat detection from filtered PPG signal.
 * Uses adaptive threshold peak detection with refractory period.
 */

/**
 * Sub-sample parabolic vertex offset for samples (prev, mid, next), mid a local
 * maximum. Returns 0 on a degenerate (flat/linear) neighbourhood, and clamps to
 * ±0.5 so a small-but-nonzero second difference (ill-conditioned upstroke) can
 * never produce an arbitrarily large index → NaN timestamp.
 */
function parabolicOffset(prev, mid, next) {
  const denom = prev - 2 * mid + next;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) return 0;
  const off = (prev - next) / (2 * denom);
  return Math.max(-0.5, Math.min(0.5, off));
}

/**
 * Detect systolic peaks in PPG signal.
 * Returns array of { index, value, timestamp } for each detected beat.
 * `index` is the refined systolic apex (for waveform morphology); `timestamp`
 * is located at the maximum-slope point of the systolic upstroke (a far more
 * repeatable timing marker than the band-pass-flattened apex).
 */
export function detectBeats(signal, timestamps, sampleRate = 30) {
  if (signal.length < 60) return { beats: [], ibis: [], bpm: 0 };

  // Adaptive threshold: 55% of rolling max over ~1.5s window
  const windowSize = Math.floor(1.5 * sampleRate);
  const threshold = new Float64Array(signal.length);

  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - windowSize);
    let maxVal = -Infinity;
    for (let j = start; j <= i; j++) {
      if (signal[j] > maxVal) maxVal = signal[j];
    }
    threshold[i] = maxVal * 0.55;
  }

  // Minimum distance between peaks (refractory period ~0.4s)
  const minDist = Math.floor(0.4 * sampleRate);

  // Samples of the upstroke scanned for the max-slope fiducial (~200 ms before peak)
  const slopeWindow = Math.max(4, Math.floor(0.2 * sampleRate));

  // Detect peaks
  const beats = [];
  let lastPeakIdx = -minDist;

  for (let i = 1; i < signal.length - 1; i++) {
    if (i - lastPeakIdx < minDist) continue;
    if (signal[i] <= threshold[i]) continue;

    // Local maximum check
    if (signal[i] >= signal[i - 1] && signal[i] > signal[i + 1]) {
      // Peak index — parabolic refinement of the apex. Used by waveform
      // morphology, where the template must stay centered on the peak.
      const alpha = signal[i - 1];
      const beta = signal[i];
      const gamma = signal[i + 1];
      const peakIndex = i + parabolicOffset(alpha, beta, gamma);

      // HRV timing fiducial — relocate to the maximum of the first difference
      // within [i - slopeWindow, i]: the inflection point of the upstroke is a
      // far more repeatable timing marker than the band-pass-flattened apex.
      let m = i;
      let maxDiff = -Infinity;
      const lo = Math.max(1, i - slopeWindow);
      for (let j = lo; j <= i; j++) {
        const d = signal[j] - signal[j - 1];
        if (d > maxDiff) { maxDiff = d; m = j; }
      }
      const d0 = signal[m - 1] - signal[m - 2];
      const d1 = signal[m] - signal[m - 1];
      const d2 = signal[m + 1] - signal[m];
      const fidIndex = m + parabolicOffset(d0, d1, d2);

      // Linear interpolation of the timestamp at the refined (fractional) index
      const base = Math.floor(fidIndex);
      const next = Math.min(base + 1, timestamps.length - 1);
      const frac = fidIndex - base;
      const refinedTs = timestamps[base] + (timestamps[next] - timestamps[base]) * frac;

      beats.push({
        index: peakIndex,     // systolic apex (for waveform morphology)
        fiducialIndex: fidIndex, // max-slope upstroke point (for timing)
        value: signal[i],
        timestamp: refinedTs,
      });

      lastPeakIdx = i;
    }
  }

  // Compute inter-beat intervals (in ms)
  const ibis = [];
  for (let i = 1; i < beats.length; i++) {
    const ibi = beats[i].timestamp - beats[i - 1].timestamp;
    // Filter physiologically implausible IBIs (300ms–2000ms = 30–200 BPM)
    if (ibi >= 300 && ibi <= 2000) {
      ibis.push(ibi);
    }
  }

  // Heart rate from mean IBI
  const meanIBI = ibis.reduce((a, b) => a + b, 0) / (ibis.length || 1);
  const bpm = ibis.length > 0 ? Math.round(60000 / meanIBI) : 0;

  return { beats, ibis, bpm };
}
