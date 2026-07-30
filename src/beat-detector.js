/**
 * Beat detection from filtered PPG signal.
 * Uses adaptive threshold peak detection with refractory period.
 */

/**
 * Detect systolic peaks in PPG signal.
 * Returns array of { index, value, timestamp } for each detected beat.
 */
export function detectBeats(signal, timestamps, sampleRate = 30) {
  if (signal.length < 60) return { beats: [], ibis: [], bpm: 0 };

  // Adaptive threshold: 60% of rolling max over ~1.5s window
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

  // Detect peaks
  const beats = [];
  let lastPeakIdx = -minDist;

  for (let i = 1; i < signal.length - 1; i++) {
    if (i - lastPeakIdx < minDist) continue;
    if (signal[i] <= threshold[i]) continue;

    // Local maximum check
    if (signal[i] >= signal[i - 1] && signal[i] > signal[i + 1]) {
      // Refine peak position using parabolic interpolation
      const alpha = signal[i - 1];
      const beta = signal[i];
      const gamma = signal[i + 1];
      const offset = (alpha - gamma) / (2 * (alpha - 2 * beta + gamma));
      const refinedIdx = i + offset;
      const refinedVal = beta - ((alpha - gamma) * offset) / 4;
      const refinedTs = timestamps[Math.floor(i)]
        + (timestamps[Math.min(Math.floor(i) + 1, timestamps.length - 1)]
           - timestamps[Math.floor(i)]) * (refinedIdx - i);

      beats.push({
        index: refinedIdx,
        value: refinedVal,
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
