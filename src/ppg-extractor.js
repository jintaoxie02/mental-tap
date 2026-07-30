/**
 * PPG signal extraction from raw green-channel brightness values.
 * Converts frame-averaged green channel intensity to a normalized PPG signal.
 */

/**
 * Extracts a raw PPG signal from the green channel values.
 * Applies inversion (more blood → less light → lower green value, so we flip),
 * detrending via simple moving average subtraction.
 */
export function createPPGExtractor() {
  const rawBuffer = [];
  const MAX_BUFFER = 4096; // ~2 min at 30fps

  return {
    /**
     * Add a green-channel sample and return the current processed signal buffer.
     * Returns { signal: Float64Array, timestamps: Float64Array } or null if not enough data.
     */
    add(greenValue, timestamp) {
      rawBuffer.push({ g: greenValue, t: timestamp });
      if (rawBuffer.length > MAX_BUFFER) rawBuffer.shift();

      if (rawBuffer.length < 60) return null; // Need at least 2 seconds

      // Extract values
      const n = rawBuffer.length;
      const raw = new Float64Array(n);
      const times = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        raw[i] = rawBuffer[i].g;
        times[i] = rawBuffer[i].t;
      }

      // Invert: blood absorbs light, so less green = more blood
      // Center around zero by subtracting mean
      const mean = raw.reduce((a, b) => a + b, 0) / n;
      const inverted = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        inverted[i] = -(raw[i] - mean);
      }

      // Simple detrend: subtract SMA with window ~2s (60 samples at 30fps)
      const windowSize = Math.min(60, Math.floor(n / 3));
      const trend = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - windowSize);
        const len = i - start + 1;
        let sum = 0;
        for (let j = start; j <= i; j++) sum += inverted[j];
        trend[i] = sum / len;
      }

      const detrended = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        detrended[i] = inverted[i] - trend[i];
      }

      // Normalize to unit variance
      const sqSum = detrended.reduce((a, b) => a + b * b, 0);
      const std = Math.sqrt(sqSum / n) || 1;
      const signal = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        signal[i] = detrended[i] / std;
      }

      return { signal, timestamps: times };
    },

    reset() {
      rawBuffer.length = 0;
    },
  };
}
