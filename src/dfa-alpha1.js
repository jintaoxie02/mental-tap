/**
 * Detrended Fluctuation Analysis — short-term scaling exponent (DFA α1).
 *
 * DFA α1 is the one nonlinear HRV index reliable on a 2-minute recording
 * (minimum reliable window ≈ 120 s, ICC ≈ 0.90) and the least sensitive to
 * beat-timing quantization (~1% error at 8 ms timing noise). Reduced α1 is an
 * established correlate of depression, PTSD, and schizophrenia, and it is only
 * weakly correlated with the time-domain vagal indices (SDNN/RMSSD), so it adds
 * genuinely independent evidence to the screening model.
 */

/**
 * Compute DFA α1 over box sizes n = 4..16 beats.
 * @param {number[]} ibis — inter-beat intervals in ms (artifact-edited)
 * @returns {number|null} α1, or null if the series is too short
 */
export function computeDFA(ibis, minBox = 4, maxBox = 16) {
  const n = ibis.length;
  if (n < 2 * maxBox + 10) return null;

  const mean = ibis.reduce((a, b) => a + b, 0) / n;
  // Integrated, mean-detrended series
  const y = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += ibis[i] - mean;
    y[i] = acc;
  }

  const logN = [];
  const logF = [];
  for (let box = minBox; box <= maxBox; box++) {
    const nSegs = Math.floor(n / box);
    if (nSegs < 2) break;
    let sumSq = 0;
    let count = 0;
    for (let seg = 0; seg < nSegs; seg++) {
      const start = seg * box;
      // Least-squares linear fit of y over [start, start+box-1]
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let j = 0; j < box; j++) {
        const idx = start + j;
        sx += j; sy += y[idx]; sxy += j * y[idx]; sxx += j * j;
      }
      const denom = box * sxx - sx * sx;
      const a = denom !== 0 ? (box * sxy - sx * sy) / denom : 0;
      const b = (sy - a * sx) / box;
      for (let j = 0; j < box; j++) {
        const r = y[start + j] - (a * j + b);
        sumSq += r * r;
      }
      count += box;
    }
    if (count === 0) continue;
    logN.push(Math.log(box));
    logF.push(Math.log(Math.sqrt(sumSq / count)));
  }

  if (logN.length < 2) return null;

  // Slope of log F vs log n (least squares)
  const m = logN.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < m; i++) {
    sx += logN[i]; sy += logF[i]; sxy += logN[i] * logF[i]; sxx += logN[i] * logN[i];
  }
  const denom = m * sxx - sx * sx;
  return denom !== 0 ? (m * sxy - sx * sy) / denom : null;
}
