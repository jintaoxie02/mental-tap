/**
 * Zero-shot Bayesian psychiatric screening.
 *
 * Uses a Naive Bayes model with:
 *   - Prior: population prevalence P(D)
 *   - Likelihood: P(z | D) from feature distributions shifted by
 *     meta-analytic effect sizes (Hedges' g)
 *   - Posterior: P(D | observed features) via Bayes' theorem
 *
 * No training data needed — all parameters come from published
 * meta-analyses and population norms.
 */

import {
  NORMS_SDNN, NORMS_RMSSD, NORMS_PNN50, NORMS_LFHF, NORMS_GLUCOSE,
  DISORDER_SIGNATURES, getAgeGroup,
} from './normative-data.js';

// ---- Population prevalence (prior probability) ----
// Point prevalence from WHO and epidemiological surveys
const PREVALENCE = {
  depression:    0.05,  // ~5% of adults
  anxiety:       0.04,  // ~4%
  ptsd:          0.04,  // ~4% lifetime/past-year
  bipolar:       0.01,  // ~1%
  schizophrenia: 0.005, // ~0.5%
};

// ---- Helpers ----

function zScore(observed, normMean, normSD) {
  if (normSD === 0) return 0;
  return (observed - normMean) / normSD;
}

function getNorm(normTable, age, sex) {
  const group = getAgeGroup(age);
  const entry = normTable[group];
  if (!entry) return { mean: 0, sd: 1 };
  // Tables with mean/sd directly (e.g., NORMS_GLUCOSE — not sex-split)
  if (entry.mean !== undefined) return entry;
  // Tables with sex-split entries (e.g., NORMS_SDNN)
  const sexEntry = entry[sex] || entry.male;
  return sexEntry || { mean: 0, sd: 1 };
}

/** Standard normal log-PDF at x */
function logNormPDF(x) {
  return -0.5 * Math.log(2 * Math.PI) - 0.5 * x * x;
}

/**
 * Log Bayes Factor for a single feature.
 *
 * H0 (healthy): z ~ N(0, 1)
 * H1 (disorder): z ~ N(g × direction, 1)  where g = Hedges' g
 *
 * log BF = log P(z|H1) − log P(z|H0)
 *        = [logNormPDF(z − g×d)] − [logNormPDF(z)]
 *        = −½(z − gd)² + ½z²
 *        = z × g × d − ½g²
 */
function featureLogBF(z, g, direction) {
  return z * g * direction - 0.5 * g * g;
}

/**
 * Bayesian screening.
 *
 * @param {object} hrv — HRV metrics from computeHRV()
 * @param {number} age
 * @param {'male'|'female'} sex
 * @param {number|null} glucoseEstimate — mmol/L or null
 * @returns {object} Screening results with posterior probabilities
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

  // z-scores
  const zScores = {};
  for (const [metric, norm] of Object.entries(norms)) {
    if (hrv[metric] !== undefined) {
      zScores[metric] = zScore(hrv[metric], norm.mean, norm.sd);
    }
  }
  if (glucoseEstimate !== null && glucoseEstimate !== undefined) {
    const gn = getNorm(NORMS_GLUCOSE, age, sex);
    zScores.glucose = zScore(glucoseEstimate, gn.mean, gn.sd);
  }

  // Compute posterior for each disorder
  const results = DISORDER_SIGNATURES.map(disorder => {
    const prior = PREVALENCE[disorder.id] || 0.02;
    const priorOdds = prior / (1 - prior);

    // Sum log Bayes Factors across features
    let totalLogBF = 0;
    let featureCount = 0;
    const featureContributions = {};

    for (const [feature, sig] of Object.entries(disorder.features)) {
      if (zScores[feature] === undefined) continue;
      const z = zScores[feature];
      const logBF = featureLogBF(z, sig.weight, sig.direction);
      totalLogBF += logBF;
      featureCount++;
      featureContributions[feature] = {
        z: Math.round(z * 100) / 100,
        g: sig.weight,
        direction: sig.direction,
        logBF: Math.round(logBF * 1000) / 1000,
      };
    }

    // If no features matched, posterior = prior
    if (featureCount === 0) {
      return {
        id: disorder.id,
        name: disorder.name,
        description: disorder.description,
        probability: Math.round(prior * 100),
        level: 'low',
        prior: Math.round(prior * 100),
        featureContributions: {},
        insufficientData: true,
      };
    }

    // Posterior odds = prior_odds × exp(total_log_BF)
    const posteriorOdds = priorOdds * Math.exp(totalLogBF);

    // Posterior probability P(D | data)
    const posterior = posteriorOdds / (1 + posteriorOdds);
    const probability = Math.round(posterior * 100);

    // Level classification based on posterior probability
    let level;
    if (probability >= 25) level = 'high';       // 25%+ posterior is notable given low prior
    else if (probability >= 10) level = 'medium'; // 10-25% = worth attention
    else level = 'low';                           // <10% = close to or below population average

    return {
      id: disorder.id,
      name: disorder.name,
      description: disorder.description,
      probability,
      level,
      prior: Math.round(prior * 100),
      logBF: Math.round(totalLogBF * 100) / 100,
      featureContributions,
      insufficientData: false,
    };
  });

  // Sort by posterior probability descending
  results.sort((a, b) => b.probability - a.probability);

  return {
    results,
    zScores: Object.fromEntries(
      Object.entries(zScores).map(([k, v]) => [k, Math.round(v * 100) / 100])
    ),
    ageGroup: getAgeGroup(age),
    sex,
  };
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
