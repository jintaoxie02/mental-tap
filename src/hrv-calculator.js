/**
 * HRV (Heart Rate Variability) metrics from inter-beat interval series.
 * Computes time-domain and frequency-domain HRV parameters.
 */

/**
 * Compute comprehensive HRV metrics from an array of NN intervals (in ms).
 */
export function computeHRV(ibis) {
  if (ibis.length < 10) {
    return {
      sdnn: 0, rmssd: 0, pnn50: 0,
      lfPower: 0, hfPower: 0, lfhfRatio: 0,
      meanHR: 0, sd1: 0, sd2: 0,
      ibiCount: ibis.length,
      error: 'Insufficient beats for reliable HRV (need ≥10)',
    };
  }

  const n = ibis.length;
  const meanNN = ibis.reduce((a, b) => a + b, 0) / n;

  // ---- Time domain ----

  // SDNN: standard deviation of NN intervals
  const sqDiffs = ibis.map(x => (x - meanNN) ** 2);
  const sdnn = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / n);

  // RMSSD: root mean square of successive differences
  let rmssdSum = 0;
  for (let i = 1; i < n; i++) {
    rmssdSum += (ibis[i] - ibis[i - 1]) ** 2;
  }
  const rmssd = Math.sqrt(rmssdSum / (n - 1));

  // pNN50: percentage of successive differences > 50ms
  let pnn50Count = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(ibis[i] - ibis[i - 1]) > 50) pnn50Count++;
  }
  const pnn50 = (pnn50Count / (n - 1)) * 100;

  // ---- Poincaré plot (non-linear) ----
  // SD1: short-term variability (width of Poincaré)
  // SD2: long-term variability (length of Poincaré)
  let sd1Sum = 0;
  for (let i = 1; i < n; i++) {
    sd1Sum += (ibis[i] - ibis[i - 1]) ** 2;
  }
  const sd1 = Math.sqrt(sd1Sum / (2 * (n - 1)));
  // Clamp the radicand: for a near-perfectly alternating series, floating-point
  // rounding can push 2·SDNN² − SD1² microscopically negative → NaN.
  const sd2 = Math.sqrt(Math.max(0, 2 * sdnn * sdnn - sd1 * sd1));

  // ---- Frequency domain via Lomb-Scargle periodogram ----
  // We compute LF (0.04–0.15 Hz) and HF (0.15–0.40 Hz) power
  const { lfPower, hfPower } = computeFrequencyDomain(ibis);

  const lfhfRatio = hfPower > 0 ? lfPower / hfPower : 0;
  const meanHR = meanNN > 0 ? Math.round(60000 / meanNN) : 0;

  return {
    sdnn: Math.round(sdnn * 100) / 100,
    rmssd: Math.round(rmssd * 100) / 100,
    pnn50: Math.round(pnn50 * 100) / 100,
    lfPower: Math.round(lfPower * 100) / 100,
    hfPower: Math.round(hfPower * 100) / 100,
    lfhfRatio: Math.round(lfhfRatio * 100) / 100,
    meanHR,
    sd1: Math.round(sd1 * 100) / 100,
    sd2: Math.round(sd2 * 100) / 100,
    ibiCount: n,
    error: null,
  };
}

/**
 * Simple frequency-domain HRV using resampled IBI series + FFT.
 * LF band: 0.04–0.15 Hz (sympathetic + parasympathetic)
 * HF band: 0.15–0.40 Hz (parasympathetic / respiratory)
 */
function computeFrequencyDomain(ibis) {
  // Build unevenly-sampled time series to uniformly-sampled via interpolation
  // Resample at 4 Hz (250ms intervals)
  const resampleRate = 4; // Hz
  const resampleInterval = 1000 / resampleRate; // ms

  // Cumulate IBI times
  const cumTimes = [0];
  for (let i = 0; i < ibis.length; i++) {
    cumTimes.push(cumTimes[i] + ibis[i]);
  }
  const totalDuration = cumTimes[cumTimes.length - 1];

  // Build uniformly sampled RR series
  const nSamples = Math.floor(totalDuration / resampleInterval);
  if (nSamples < 32) return { lfPower: 0, hfPower: 0 };

  // FFT length — the window is zero-padded to this power of two, and bin k
  // truly sits at k * resampleRate / N.
  const N = 1 << Math.ceil(Math.log2(nSamples));

  const rrUniform = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const t = i * resampleInterval;
    // Find surrounding IBIs and interpolate
    let j = 0;
    while (j < cumTimes.length - 1 && cumTimes[j + 1] < t) j++;
    rrUniform[i] = ibis[Math.min(j, ibis.length - 1)];
  }

  // Detrend and apply Hanning window
  const mean = rrUniform.reduce((a, b) => a + b, 0) / nSamples;
  const windowed = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const hanning = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nSamples - 1)));
    windowed[i] = (rrUniform[i] - mean) * hanning;
  }

  // Compute power spectrum via simple FFT approach
  const spectrum = computePSD(windowed, N);

  // Integrate power in LF and HF bands
  let lfPower = 0, hfPower = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const freq = (i * resampleRate) / N;
    if (freq >= 0.04 && freq < 0.15) {
      lfPower += spectrum[i];
    } else if (freq >= 0.15 && freq <= 0.40) {
      hfPower += spectrum[i];
    }
  }

  return { lfPower, hfPower };
}

/**
 * Periodogram of a zero-padded real signal (RR intervals in ms).
 * One-sided bin power = |X[k]|² / N² — independent of sample rate and of the
 * padding length, so LF/HF band sums are on a stable ms² scale.
 */
function computePSD(signal, N) {
  const padded = new Float64Array(N);
  padded.set(signal);

  const psd = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let j = 0; j < N; j++) {
      const angle = (-2 * Math.PI * k * j) / N;
      re += padded[j] * Math.cos(angle);
      im += padded[j] * Math.sin(angle);
    }
    psd[k] = (re * re + im * im) / (N * N);
  }

  return psd;
}
