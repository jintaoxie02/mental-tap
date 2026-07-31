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
 * Frequency-domain HRV. LF band: 0.04–0.15 Hz; HF band: 0.15–0.40 Hz.
 * (LF is unreliable at 2 minutes per Task Force 1996 — only the HF component
 * is defensible for ultra-short recordings.)
 */
function computeFrequencyDomain(ibis) {
  // Frequency-domain HRV per Task Force conventions: the unevenly-sampled RR
  // tachogram is resampled onto a uniform 4 Hz grid (monotone cubic Hermite,
  // PCHIP), detrended (2nd-order polynomial) to keep slow trends out of LF,
  // Hanning-windowed, and transformed with a radix-2 FFT. Band powers are
  // one-sided and window-compensated, so they are in ms².
  const resampleRate = 4; // Hz
  const resampleInterval = 1000 / resampleRate; // ms

  // Cumulate IBI times: cumTimes[i] is the time of the i-th beat.
  const cumTimes = [0];
  for (let i = 0; i < ibis.length; i++) cumTimes.push(cumTimes[i] + ibis[i]);
  const totalDuration = cumTimes[cumTimes.length - 1];

  const nSamples = Math.floor(totalDuration / resampleInterval);
  if (nSamples < 32) return { lfPower: 0, hfPower: 0 };

  // FFT length — zero-padded to a power of two; bin k sits at k·fs/N.
  const N = 1 << Math.ceil(Math.log2(nSamples));

  // Monotone cubic-Hermite resample of the tachogram (beat times → IBI values)
  const rrUniform = resamplePCHIP(cumTimes.slice(0, ibis.length), ibis, nSamples, resampleInterval);

  // 2nd-order polynomial detrend, then Hanning window
  const detrended = polyDetrend(rrUniform);
  const windowed = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    const hanning = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nSamples - 1)));
    windowed[i] = detrended[i] * hanning;
  }

  const spectrum = computePSD(windowed, N);

  // One-sided power: ×2 for non-DC bins; Hanning mean-square = 3/8 compensates
  // the window's attenuation. Both bands share the factors, so LF/HF is stable.
  const winComp = 1 / 0.375;
  let lfPower = 0, hfPower = 0;
  for (let k = 0; k < N / 2; k++) {
    const freq = (k * resampleRate) / N;
    const p = spectrum[k] * (k === 0 ? 1 : 2) * winComp;
    if (freq >= 0.04 && freq < 0.15) lfPower += p;
    else if (freq >= 0.15 && freq <= 0.40) hfPower += p;
  }

  return { lfPower, hfPower };
}

/** Monotone cubic-Hermite (PCHIP) interpolation onto a uniform grid. */
function resamplePCHIP(x, y, nSamples, interval) {
  const m = x.length;
  const out = new Float64Array(nSamples);
  if (m < 2) return out;

  // Fritsch–Carlson tangents (no overshoot: tangent = 0 at local extrema)
  const h = new Float64Array(m - 1);
  const d = new Float64Array(m - 1);
  const tang = new Float64Array(m);
  for (let i = 0; i < m - 1; i++) {
    h[i] = x[i + 1] - x[i];
    d[i] = h[i] > 0 ? (y[i + 1] - y[i]) / h[i] : 0;
  }
  tang[0] = d[0];
  for (let i = 1; i < m - 1; i++) {
    if (d[i - 1] * d[i] <= 0) tang[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      const den = w1 / d[i - 1] + w2 / d[i];
      tang[i] = den !== 0 ? (w1 + w2) / den : 0;
    }
  }
  tang[m - 1] = d[m - 2];

  let lo = 0;
  for (let s = 0; s < nSamples; s++) {
    const t = s * interval;
    while (lo < m - 2 && x[lo + 1] < t) lo++;
    const x0 = x[lo], x1 = x[lo + 1];
    const hh = x1 - x0;
    if (hh <= 0) { out[s] = y[lo]; continue; }
    const u = (t - x0) / hh;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    out[s] = h00 * y[lo] + h10 * hh * tang[lo] + h01 * y[lo + 1] + h11 * hh * tang[lo + 1];
  }
  return out;
}

/** Remove a least-squares 2nd-order polynomial trend (centered time axis). */
function polyDetrend(y) {
  const n = y.length;
  const mid = (n - 1) / 2;
  let s0 = 0, s2 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i - mid;
    const yv = y[i];
    s0 += 1; s2 += t * t; s4 += t * t * t * t;
    b0 += yv; b1 += t * yv; b2 += t * t * yv;
  }
  const c0 = s0 > 0 ? b0 / s0 : 0;
  const c1 = s2 > 0 ? b1 / s2 : 0;
  const c2 = s4 > 0 ? b2 / s4 : 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i - mid;
    out[i] = y[i] - (c0 + c1 * t + c2 * t * t);
  }
  return out;
}

/**
 * Periodogram of a zero-padded real signal (RR intervals in ms) via a radix-2
 * FFT. Two-sided bin power = |X[k]|² / N², independent of sample rate and of
 * the padding length; the one-sided/window compensation is applied in the
 * band integration.
 */
function computePSD(signal, N) {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  re.set(signal);
  fft(re, im);
  const psd = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    psd[k] = (re[k] * re[k] + im[k] * im[k]) / (N * N);
  }
  return psd;
}

/** Iterative in-place radix-2 Cooley–Tukey FFT (bit-reversal + butterflies). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
