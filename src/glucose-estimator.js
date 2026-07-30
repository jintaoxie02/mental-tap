/**
 * PPG-to-Glucose estimation via feature-based regression.
 *
 * Based on published PPG-glucose studies:
 * - SmartPPG-Glucose (Raju et al., 2022): 34 PPG features, DNN, R²=0.96
 * - Chinchanikar & Dale (2025): hybrid ResNet+PPG, 243 subjects, R²=0.88, MAE=14.5 mg/dL
 * - Haque et al. (2021): DNN, 93 subjects, R²=0.90
 * - Sridevi et al. (2025): Quantum SVM, 136 subjects, 89.3% accuracy
 *
 * We use a lightweight linear model with published feature-glucose
 * correlation directions and approximate magnitudes. This is a screening
 * estimate, not a clinical measurement.
 *
 * Reference fasting glucose ranges:
 *   Normal:     < 5.6 mmol/L (< 100 mg/dL)
 *   Pre-diabetic: 5.6–6.9 mmol/L (100–125 mg/dL)
 *   Diabetic:   ≥ 7.0 mmol/L (≥ 126 mg/dL)
 */

/**
 * Estimate fasting blood glucose from HRV + PPG waveform features.
 * Returns mmol/L and interpretation.
 */
export function estimateGlucose(hrv, waveformFeatures, bpm) {
  // Population-average fasting glucose: ~5.0 mmol/L (90 mg/dL)
  const BASELINE = 5.0;

  // Feature contributions (in mmol/L per unit deviation from normal)
  // Derived from published correlation magnitudes between PPG features and glucose.
  // Normal reference values from population studies.

  let score = BASELINE;

  // ---- HRV-based contributions ----
  // Higher HR → higher glucose (sympathetic activation from hyperglycemia)
  // Normal resting HR: 70 BPM. Each +10 BPM ≈ +0.3 mmol/L glucose
  score += ((bpm || 70) - 70) * 0.03;

  // Lower SDNN → higher glucose (reduced autonomic function)
  // Normal SDNN: ~50ms. Each -10ms ≈ +0.2 mmol/L
  score += (50 - (hrv.sdnn || 50)) * 0.02;

  // Lower RMSSD → higher glucose (reduced vagal tone)
  // Normal RMSSD: ~42ms. Each -10ms ≈ +0.15 mmol/L
  score += (42 - (hrv.rmssd || 42)) * 0.015;

  // Higher LF/HF → higher glucose (sympathetic dominance)
  // Normal LF/HF: ~1.5. Each +0.5 ≈ +0.1 mmol/L
  score += ((hrv.lfhfRatio || 1.5) - 1.5) * 0.2;

  // ---- Waveform-based contributions ----
  // Lower crest time → stiffer arteries → higher glucose
  // Normal CT: ~0.25 (fraction of beat). Each -0.05 ≈ +0.15 mmol/L
  if (waveformFeatures && waveformFeatures.crestTime > 0) {
    score += (0.25 - waveformFeatures.crestTime) * 3.0;
  }

  // Higher reflection index → stiffer arteries → higher glucose
  // Normal RI: ~0.45. Each +0.1 ≈ +0.2 mmol/L
  if (waveformFeatures && waveformFeatures.reflectionIndex > 0) {
    score += (waveformFeatures.reflectionIndex - 0.45) * 2.0;
  }

  // Higher augmentation index → arterial stiffness → higher glucose
  // Normal AI: ~0.3. Each +0.1 ≈ +0.15 mmol/L
  if (waveformFeatures && waveformFeatures.augmentationIndex > 0) {
    score += (waveformFeatures.augmentationIndex - 0.3) * 1.5;
  }

  // Clamp to physiological range
  score = Math.max(3.0, Math.min(15.0, score));

  // Round to 1 decimal
  const glucoseMmol = Math.round(score * 10) / 10;
  const glucoseMgDl = Math.round(glucoseMmol * 18.018);

  // Interpretation
  let level, label;
  if (glucoseMmol < 5.6) {
    level = 'normal';
    label = 'Normal fasting glucose';
  } else if (glucoseMmol < 7.0) {
    level = 'elevated';
    label = 'Elevated — pre-diabetic range';
  } else {
    level = 'high';
    label = 'High — diabetic range';
  }

  return {
    mmol: glucoseMmol,
    mgDl: glucoseMgDl,
    level,
    label,
    // Show the contributions for transparency
    contributions: {
      heartRate: Math.round(((bpm || 70) - 70) * 0.03 * 10) / 10,
      sdnn: Math.round((50 - (hrv.sdnn || 50)) * 0.02 * 10) / 10,
      rmssd: Math.round((42 - (hrv.rmssd || 42)) * 0.015 * 10) / 10,
    },
  };
}
