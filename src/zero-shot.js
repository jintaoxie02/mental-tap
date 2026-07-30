/**
 * Zero-shot psychiatric screening classifier.
 * No training data needed — uses population normative HRV values
 * and known disorder autonomic signatures from published meta-analyses.
 */

import {
  NORMS_SDNN, NORMS_RMSSD, NORMS_PNN50, NORMS_LFHF, NORMS_GLUCOSE,
  DISORDER_SIGNATURES, getAgeGroup,
} from './normative-data.js';

/**
 * Compute z-score: how many standard deviations from the age/sex norm.
 * Negative z means below norm (most psychiatric conditions reduce HRV).
 */
function zScore(observed, normMean, normSD) {
  if (normSD === 0) return 0;
  return (observed - normMean) / normSD;
}

/**
 * Get normative value for a given metric, age, and sex.
 */
function getNorm(normTable, age, sex) {
  const group = getAgeGroup(age);
  const entry = normTable[group]?.[sex] || normTable[group]?.male;
  return entry || { mean: 0, sd: 1 };
}

/**
 * Run zero-shot screening.
 * @param {object} hrv - HRV metrics from computeHRV()
 * @param {number} age - User's age
 * @param {'male'|'female'} sex - User's sex
 * @returns {object} Screening results with disorder matches and confidence levels
 */
export function screenDisorders(hrv, age, sex, glucoseEstimate = null) {
  const norms = {
    sdnn: getNorm(NORMS_SDNN, age, sex),
    rmssd: getNorm(NORMS_RMSSD, age, sex),
    pnn50: getNorm(NORMS_PNN50, age, sex),
    lfhfRatio: getNorm(NORMS_LFHF, age, sex),
    lfPower: { mean: 1200, sd: 800 },
    hfPower: { mean: 800, sd: 600 },
  };

  // Add glucose norm if estimate available
  let glucoseZ = null;
  if (glucoseEstimate !== null && glucoseEstimate !== undefined) {
    const glucoseNorm = getNorm(NORMS_GLUCOSE, age, sex);
    glucoseZ = zScore(glucoseEstimate, glucoseNorm.mean, glucoseNorm.sd);
  }

  // Compute z-scores for each metric
  const zScores = {};
  for (const [metric, norm] of Object.entries(norms)) {
    if (hrv[metric] !== undefined) {
      zScores[metric] = zScore(hrv[metric], norm.mean, norm.sd);
    }
  }
  // Add glucose z-score as a synthetic feature
  if (glucoseZ !== null) {
    zScores.glucose = glucoseZ;
  }

  // Match against each disorder signature
  const results = DISORDER_SIGNATURES.map(disorder => {
    let deviationScore = 0;
    let totalWeight = 0;
    const featureDeviations = {};

    for (const [feature, sig] of Object.entries(disorder.features)) {
      if (zScores[feature] === undefined) continue;
      const z = zScores[feature];
      // Only penalize when the deviation is in the expected direction
      const deviation = sig.direction === -1 ? Math.max(0, -z) : Math.max(0, z);
      deviationScore += sig.weight * deviation;
      totalWeight += sig.weight;
      featureDeviations[feature] = {
        z: Math.round(z * 100) / 100,
        deviation: Math.round(deviation * 100) / 100,
        weight: sig.weight,
      };
    }

    // Normalize deviation score
    const avgDeviation = totalWeight > 0 ? deviationScore / totalWeight : 0;

    // Sigmoid to get confidence (0-100%)
    const confidence = Math.round(sigmoid(avgDeviation - disorder.threshold * 0.7) * 100);

    // Confidence level
    let level;
    if (confidence >= 60) level = 'high';
    else if (confidence >= 30) level = 'medium';
    else level = 'low';

    return {
      id: disorder.id,
      name: disorder.name,
      description: disorder.description,
      confidence,
      level,
      deviationScore: Math.round(avgDeviation * 100) / 100,
      featureDeviations,
    };
  });

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  return {
    results,
    zScores: Object.fromEntries(
      Object.entries(zScores).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    ageGroup: getAgeGroup(age),
    sex,
  };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x * 2.5));
}

/**
 * Get status label for a metric vs its norm.
 */
export function getMetricStatus(metric, value, age, sex) {
  const normMap = {
    sdnn: NORMS_SDNN,
    rmssd: NORMS_RMSSD,
    pnn50: NORMS_PNN50,
    lfhfRatio: NORMS_LFHF,
  };

  const normTable = normMap[metric];
  if (!normTable) return 'normal';

  const { mean, sd } = getNorm(normTable, age, sex);
  const z = zScore(value, mean, sd);

  if (z < -1.5) return 'low';
  if (z > 1.5) return 'high';
  return 'normal';
}
