/**
 * Robust editing of an inter-beat-interval (IBI) series.
 *
 * RMSSD/SDNN are dominated by rare beat-detection errors: a single missed
 * beat produces an IBI of ~2x the true interval, and a false beat on the
 * dicrotic notch suppresses the next real beat (400 ms refractory) producing a
 * (short, long) pair that sums to ~2x the median. Following Lipponen &
 * Tarvainen (2019, J Med Eng Technol 43:173-181), we flag beats that deviate
 * from a robust median + MAD threshold, classify the pattern, and repair by
 * interpolation — never by deletion (Peltola 2012).
 */

/**
 * Edit an IBI array in place-equivalent fashion.
 * @param {number[]} ibis — inter-beat intervals in ms (already range-gated)
 * @returns {{ibis: number[], edited: number, total: number, clean: boolean}}
 *   `clean` is false when >25% of intervals were edited (unreliable signal).
 */
export function editIbis(ibis) {
  const n = ibis.length;
  if (n < 10) return { ibis, edited: 0, total: n, clean: n >= 10 };

  const med = median(ibis);
  const out = ibis.slice();
  let edited = 0;

  // Robust deviation threshold (MAD scaled to σ), floored so a near-periodic
  // series is not over-edited by measurement noise.
  const T = Math.max(3 * 1.4826 * mad(ibis, med), med * 0.2);

  // Pass 1 — ectopic pairs: a short IBI adjacent to a long IBI whose sum is
  // ~2x the median (false beat + refractory-suppressed real beat). Repair both
  // with their average.
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    const short = Math.min(a, b);
    const long = Math.max(a, b);
    if (
      short < med - T &&
      long > med + T &&
      Math.abs(short + long - 2 * med) < med * 0.25
    ) {
      const avg = (a + b) / 2;
      out[i] = avg;
      out[i + 1] = avg;
      edited++;
      i++; // skip the repaired pair
    }
  }

  // Pass 2 — isolated outliers: a missed beat (long interval) is split in two;
  // an extra beat (short interval) is restored to the median. A missed beat is
  // ~2x the median, an extra beat ~0.5x, so use fixed-ratio thresholds (a MAD
  // threshold mis-classifies genuine long/short intervals when variability is low).
  const hiThresh = 1.5 * med;
  const loThresh = 0.6 * med;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v > hiThresh && v < 2.3 * med) {
      out[i] = v / 2; // missed beat -> split into two normal intervals
      edited++;
    } else if (v < loThresh && v > 0.35 * med) {
      out[i] = med; // extra beat -> restore to the dominant interval
      edited++;
    }
  }

  // Pass 3 — hard physiological limits (last line of defense).
  for (let i = 0; i < out.length; i++) {
    if (out[i] < 300 || out[i] > 2000) {
      out[i] = med;
      edited++;
    }
  }

  return { ibis: out, edited, total: n, clean: edited / n <= 0.25 };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mad(arr, m) {
  const d = arr.map(x => Math.abs(x - m)).sort((a, b) => a - b);
  const mid = Math.floor(d.length / 2);
  return d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
}
