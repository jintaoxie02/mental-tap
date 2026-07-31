/**
 * Normative HRV data by age and sex.
 * Sources:
 * - Ortega et al. (2024): 2,143 healthy participants, 5-min HRV
 * - van den Berg et al. (2018): 13,943 participants, 10-sec ECG
 * - Welltory (2023): 296,000+ individuals
 * - Wu et al. (2023): meta-analysis, 43 studies, 5,906 participants
 *
 * Disorder signatures derived from:
 * - Translational Psychiatry (2025) umbrella review: 442 studies, 34,625 participants
 * - Wu et al. (2023) meta-analysis for depression HRV effect sizes
 */

// Normative RMSSD values (ms) by age group and sex — 50th percentile
export const NORMS_RMSSD = {
  '18-24': { male: { mean: 46, sd: 17 }, female: { mean: 48, sd: 16 } },
  '25-34': { male: { mean: 41, sd: 15 }, female: { mean: 43, sd: 14 } },
  '35-44': { male: { mean: 34, sd: 13 }, female: { mean: 36, sd: 12 } },
  '45-54': { male: { mean: 28, sd: 11 }, female: { mean: 30, sd: 11 } },
  '55-64': { male: { mean: 24, sd: 10 }, female: { mean: 25, sd: 10 } },
  '65-74': { male: { mean: 22, sd: 9 },  female: { mean: 23, sd: 9 } },
  '75-90': { male: { mean: 20, sd: 9 },  female: { mean: 20, sd: 9 } },
};

// Normative SDNN values (ms) by age group and sex
export const NORMS_SDNN = {
  '18-24': { male: { mean: 58, sd: 19 }, female: { mean: 55, sd: 18 } },
  '25-34': { male: { mean: 53, sd: 17 }, female: { mean: 50, sd: 16 } },
  '35-44': { male: { mean: 45, sd: 15 }, female: { mean: 43, sd: 14 } },
  '45-54': { male: { mean: 38, sd: 13 }, female: { mean: 36, sd: 12 } },
  '55-64': { male: { mean: 32, sd: 11 }, female: { mean: 31, sd: 11 } },
  '65-74': { male: { mean: 28, sd: 10 }, female: { mean: 27, sd: 10 } },
  '75-90': { male: { mean: 25, sd: 9 },  female: { mean: 25, sd: 9 } },
};

// Normative pNN50 (%) by age group
export const NORMS_PNN50 = {
  '18-24': { male: { mean: 25, sd: 14 }, female: { mean: 27, sd: 14 } },
  '25-34': { male: { mean: 20, sd: 12 }, female: { mean: 22, sd: 12 } },
  '35-44': { male: { mean: 15, sd: 10 }, female: { mean: 16, sd: 10 } },
  '45-54': { male: { mean: 10, sd: 8 },  female: { mean: 11, sd: 8 } },
  '55-64': { male: { mean: 7, sd: 6 },   female: { mean: 8, sd: 7 } },
  '65-74': { male: { mean: 5, sd: 5 },   female: { mean: 6, sd: 5 } },
  '75-90': { male: { mean: 4, sd: 4 },   female: { mean: 4, sd: 4 } },
};

// Normative LF/HF ratio
export const NORMS_LFHF = {
  '18-24': { male: { mean: 1.5, sd: 0.9 }, female: { mean: 1.4, sd: 0.8 } },
  '25-34': { male: { mean: 1.6, sd: 1.0 }, female: { mean: 1.5, sd: 0.9 } },
  '35-44': { male: { mean: 1.7, sd: 1.0 }, female: { mean: 1.6, sd: 1.0 } },
  '45-54': { male: { mean: 1.8, sd: 1.1 }, female: { mean: 1.7, sd: 1.0 } },
  '55-64': { male: { mean: 1.7, sd: 1.0 }, female: { mean: 1.6, sd: 1.0 } },
  '65-74': { male: { mean: 1.5, sd: 0.9 }, female: { mean: 1.5, sd: 0.9 } },
  '75-90': { male: { mean: 1.4, sd: 0.8 }, female: { mean: 1.4, sd: 0.8 } },
};

/**
 * Disorder autonomic signatures.
 * For each disorder, lists which HRV features are altered and in which
 * direction (1 = elevated in disorder, -1 = reduced in disorder), with weights
 * based on meta-analytic effect sizes (Hedges' g).
 *
 * Hedges' g from Wu et al. (2023) and Translational Psychiatry (2025):
 * - Depression: SDNN g=-0.87, RMSSD g=-0.51
 * - Anxiety: RMSSD reduced, HF reduced
 * - PTSD: overall HRV reduced
 * - Schizophrenia: RMSSD and HF strongly reduced
 * - Depression/PTSD/schizophrenia also show reduced DFA α1 (fractal scaling)
 *
 * Excluded from the signatures (see zero-shot.js):
 * - Absolute LF/HF power: FFT scale is recording-length/amplitude dependent,
 *   no validated norm.
 * - pNN50: its 50 ms threshold sits inside the 30 fps beat-timing noise and it
 *   needs ~5 min to stabilize; RMSSD already captures the vagal signal.
 * - LF/HF ratio: non-significant in Wu et al. (g=-0.05, p=0.68) and
 *   low-precision at 2 min.
 * - PPG-glucose heuristic: a deterministic function of the same HRV metrics
 *   (double-counting) and not clinically validated.
 */
export const DISORDER_SIGNATURES = [
  {
    id: 'depression',
    name: 'Major Depressive Disorder',
    features: {
      sdnn:    { direction: -1, weight: 0.87 },
      rmssd:   { direction: -1, weight: 0.51 },
      dfaAlpha1: { direction: -1, weight: 0.40 },
    },
    threshold: 1.0,
    description: 'Reduced HRV across all domains (especially SDNN, g = −0.87).',
  },
  {
    id: 'anxiety',
    name: 'Generalized Anxiety Disorder',
    features: {
      sdnn:    { direction: -1, weight: 0.30 },
      rmssd:   { direction: -1, weight: 0.40 },
    },
    threshold: 0.9,
    description: 'Mild to moderate HRV reduction, particularly parasympathetic (RMSSD, HF).',
  },
  {
    id: 'ptsd',
    name: 'Post-Traumatic Stress Disorder',
    features: {
      sdnn:    { direction: -1, weight: 0.50 },
      rmssd:   { direction: -1, weight: 0.50 },
      dfaAlpha1: { direction: -1, weight: 0.40 },
    },
    threshold: 0.9,
    description: 'Broad HRV reduction. One of the strongest HRV-psychiatric associations in umbrella review.',
  },
  {
    id: 'bipolar',
    name: 'Bipolar Disorder',
    features: {
      sdnn:    { direction: -1, weight: 0.35 },
      rmssd:   { direction: -1, weight: 0.35 },
    },
    threshold: 0.9,
    description: 'Mild HRV reduction. May normalize during euthymic states.',
  },
  {
    id: 'schizophrenia',
    name: 'Schizophrenia Spectrum',
    features: {
      sdnn:    { direction: -1, weight: 0.40 },
      rmssd:   { direction: -1, weight: 0.70 },
      dfaAlpha1: { direction: -1, weight: 0.40 },
    },
    threshold: 0.9,
    description: 'Strong parasympathetic (RMSSD, HF) reduction. Strongest evidence in umbrella review.',
  },
];

// Normative DFA α1 (healthy adults, short-term scaling exponent).
// Reduced α1 (~0.7-0.9 vs ~1.0) is an established correlate of depression,
// PTSD, and schizophrenia; it is the one nonlinear index reliable at 120 s.
export const NORMS_DFA = { mean: 1.0, sd: 0.2 };

// Normative fasting glucose (mmol/L) by age
export const NORMS_GLUCOSE = {
  '18-24': { mean: 4.8, sd: 0.5 },
  '25-34': { mean: 4.9, sd: 0.5 },
  '35-44': { mean: 5.1, sd: 0.6 },
  '45-54': { mean: 5.3, sd: 0.7 },
  '55-64': { mean: 5.5, sd: 0.8 },
  '65-74': { mean: 5.6, sd: 0.9 },
  '75-90': { mean: 5.7, sd: 1.0 },
};

/**
 * Get age group bucket for the given age.
 */
export function getAgeGroup(age) {
  if (age < 18) return '18-24';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  if (age <= 64) return '55-64';
  if (age <= 74) return '65-74';
  return '75-90';
}
