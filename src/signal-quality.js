/**
 * Segmental signal-quality index (SQI) for the PPG recording.
 *
 * A zero-shot quality gate: splits the recording into ~10 s windows and scores
 * each on (a) spectral purity — the fraction of window variance that sits in
 * the cardiac band (0.7–3 Hz) — and (b) beat-template consistency — the mean
 * correlation of each beat's normalized shape against the window's median
 * template. Motion, exposure shifts, and finger lifts spread power outside the
 * cardiac band and distort beat shapes, so low scores mark corrupted windows.
 */

import { createBandpassFilter } from './signal-filter.js';
import { detectBeats } from './beat-detector.js';

const SEGMENT_SEC = 10;
const MIN_PURITY = 0.4;
const MIN_TEMPLATE_CORR = 0.6;

/**
 * Score every ~10 s segment of the recording.
 * @returns {Array<{start:number,end:number,good:boolean,purity:number,corr:number}>}
 */
export function evaluateSegments(greenValues, timestamps, fs, segmentSec = SEGMENT_SEC) {
  const segLen = Math.round(segmentSec * fs);
  const results = [];
  for (let s = 0; s < greenValues.length; s += segLen) {
    const e = Math.min(greenValues.length, s + segLen);
    // Windows shorter than ~5 s can't be scored reliably
    if (e - s < Math.round(5 * fs)) {
      results.push({ start: s, end: e, good: false, purity: 0, corr: 0 });
      continue;
    }
    const seg = greenValues.slice(s, e);
    const t = timestamps.slice(s, e);
    results.push({ start: s, end: e, ...evaluateSegment(seg, t, fs) });
  }
  return results;
}

function evaluateSegment(green, times, fs) {
  const n = green.length;
  const mean = green.reduce((a, b) => a + b, 0) / n;
  const detrended = new Float64Array(n);
  let varTotal = 0;
  for (let i = 0; i < n; i++) {
    const v = green[i] - mean;
    detrended[i] = v;
    varTotal += v * v;
  }
  varTotal /= n;
  if (varTotal <= 1e-9) return { good: false, purity: 0, corr: 0 };

  // Cardiac-band power fraction (spectral purity). Use a wider 0.5–3.5 Hz band
  // than the analysis filter so a genuinely clean low-HR (40–46 BPM) recording
  // is not attenuated and falsely rejected.
  const bp = createBandpassFilter(fs, 0.5, 3.5);
  const filtered = bp.process(detrended);
  let varCardiac = 0;
  for (let i = 0; i < n; i++) varCardiac += filtered[i] * filtered[i];
  varCardiac /= n;
  const purity = varCardiac / varTotal;

  const { beats } = detectBeats(filtered, times, fs);
  const corr = templateCorrelation(filtered, beats);

  return { good: purity > MIN_PURITY && corr > MIN_TEMPLATE_CORR, purity, corr };
}

/** Mean Pearson correlation of each beat template against the median template. */
function templateCorrelation(signal, beats) {
  if (beats.length < 3) return 0;
  const halfWindow = 8; // samples (~±0.27 s at 30 fps)
  const templates = [];
  for (const beat of beats) {
    const c = Math.round(beat.index);
    const start = Math.max(0, c - halfWindow);
    const end = Math.min(signal.length, c + halfWindow);
    if (end - start < 2 * halfWindow) continue;
    const seg = signal.slice(start, end);
    const m = seg.reduce((a, b) => a + b, 0) / seg.length;
    let v = 0;
    for (const x of seg) v += (x - m) * (x - m);
    v /= seg.length;
    if (v < 1e-12) continue;
    templates.push(Float64Array.from(seg, x => (x - m) / Math.sqrt(v)));
  }
  if (templates.length < 3) return 0;

  const len = templates[0].length;
  const med = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const vals = templates.map(t => t[i]).sort((a, b) => a - b);
    med[i] = vals[Math.floor(vals.length / 2)];
  }
  // The element-wise median of unit-variance templates is not unit-variance
  // itself, so re-normalize it before taking dot products (dot of two
  // unit-variance, zero-mean signals = Pearson r, ≤ 1).
  const mm = med.reduce((a, b) => a + b, 0) / len;
  let mv = 0;
  for (let i = 0; i < len; i++) mv += (med[i] - mm) * (med[i] - mm);
  mv = Math.sqrt(mv / len);
  if (mv < 1e-12) return 0;
  for (let i = 0; i < len; i++) med[i] = (med[i] - mm) / mv;

  let sum = 0;
  for (const t of templates) {
    let dot = 0;
    for (let i = 0; i < len; i++) dot += t[i] * med[i];
    sum += dot / len; // both unit-variance, zero-mean → dot/len = Pearson r
  }
  return sum / templates.length;
}
