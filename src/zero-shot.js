/**
 * Zero-shot Bayesian psychiatric screening.
 *
 * Multivariate-Gaussian likelihood model:
 *   - Prior: population prevalence P(D)
 *   - Likelihood: P(z | D) — feature z-scores under the disorder distribution,
 *     shifted by meta-analytic effect sizes (Hedges' g) and sharing the
 *     population correlation between features
 *   - Posterior: P(D | observed features) via Bayes' theorem
 *
 * The correlation structure matters: SDNN/RMSSD are ~0.85-correlated views of
 * one vagal construct, so summing per-feature log-Bayes-factors (naive Bayes)
 * double-counts the evidence and inflates posterior confidence. We instead
 * compute the log-Bayes-factor of a multivariate normal likelihood,
 * logBF = μᵀΣ⁻¹z − ½μᵀΣ⁻¹μ, which reduces to the naive formula when a single
 * feature is used. No training data needed — all parameters come from
 * published meta-analyses and population norms.
 */

import {
  NORMS_SDNN, NORMS_RMSSD, NORMS_PNN50, NORMS_LFHF, NORMS_DFA,
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

// SDNN grows with recording length; the normative tables are 5-minute values
// but MentalTap records 2 minutes. A 2-min SDNN runs ~15% low, which would
// bias the strongest depression feature (g=−0.87) toward "reduced HRV" for
// everyone. We scale the SDNN norm mean down to the 2-min scale.
const SDNN_DURATION_FACTOR = 0.85;

// Population correlations between HRV features (published norm studies).
// LF/HF ratio is essentially independent of the time-domain vagal indices.
const FEATURE_CORR = {
  sdnn_rmssd: 0.85,
  sdnn_pnn50: 0.80,
  rmssd_pnn50: 0.95,
  sdnn_lfhfRatio: 0.15,
  rmssd_lfhfRatio: 0.10,
  pnn50_lfhfRatio: 0.10,
  // DFA α1 is only weakly coupled to the vagal time-domain indices
  dfaAlpha1_sdnn: 0.40,
  dfaAlpha1_rmssd: 0.30,
  dfaAlpha1_pnn50: 0.25,
  dfaAlpha1_lfhfRatio: 0.10,
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
  // Tables with mean/sd directly (not sex-split)
  if (entry.mean !== undefined) return entry;
  // Tables with sex-split entries
  const sexEntry = entry[sex] || entry.male;
  return sexEntry || { mean: 0, sd: 1 };
}

function getSDNNNorm(age, sex) {
  const n = getNorm(NORMS_SDNN, age, sex);
  return { mean: n.mean * SDNN_DURATION_FACTOR, sd: n.sd * SDNN_DURATION_FACTOR };
}

function featureCorr(f1, f2) {
  if (f1 === f2) return 1;
  return FEATURE_CORR[[f1, f2].sort().join('_')] ?? 0;
}

/**
 * Solve the linear system A·x = b by Gaussian elimination with partial
 * pivoting. Used to compute Σ⁻¹·v without materializing the inverse.
 */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) continue;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = 0; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map(row => row[n]);
}

/**
 * Log Bayes Factor for a multivariate-normal feature set.
 *
 * H0: z ~ N(0, Σ), H1: z ~ N(μ, Σ), μ = g·direction per feature.
 * log BF = μᵀΣ⁻¹z − ½μᵀΣ⁻¹μ.
 * With a single feature (Σ=[1]) this reduces to z·g·d − ½g².
 */
function multivariateLogBF(features, zScores) {
  const used = features.filter(([name]) => zScores[name] !== undefined);
  const m = used.length;
  if (m === 0) return { logBF: 0, used: 0 };

  const z = used.map(([name]) => zScores[name]);
  const mu = used.map(([, s]) => s.weight * s.direction);

  // Correlation matrix Σ for the used features (small ridge for conditioning)
  const Sigma = used.map(([a]) => used.map(([b]) => featureCorr(a, b)));
  for (let i = 0; i < m; i++) Sigma[i][i] += 1e-6;

  const sigmaInvZ = solveLinear(Sigma, z);
  const sigmaInvMu = solveLinear(Sigma, mu);
  let logBF = 0;
  for (let i = 0; i < m; i++) {
    logBF += mu[i] * sigmaInvZ[i] - 0.5 * mu[i] * sigmaInvMu[i];
  }
  return { logBF, used: m };
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
  // Refuse invalid HRV input: all-zero metrics (insufficient beats) would
  // z-score as severely reduced HRV and inflate every disorder posterior.
  if (!hrv || hrv.error) {
    return {
      results: [],
      zScores: {},
      ageGroup: getAgeGroup(age),
      sex,
      error: hrv && hrv.error ? hrv.error : 'Invalid HRV input',
    };
  }

  // Absolute LF/HF power and the PPG-glucose heuristic are deliberately NOT
  // screened: the FFT's power scale is recording-length/amplitude dependent
  // (no validated norm), and the glucose estimate is a deterministic function
  // of the same HRV metrics — feeding it in would double-count the evidence.
  // The scale-free LF/HF ratio is used only where a signature calls for it.
  const norms = {
    sdnn: getSDNNNorm(age, sex), // 2-min duration-corrected
    rmssd: getNorm(NORMS_RMSSD, age, sex),
    pnn50: getNorm(NORMS_PNN50, age, sex),
    lfhfRatio: getNorm(NORMS_LFHF, age, sex),
    dfaAlpha1: NORMS_DFA,
  };

  // z-scores (skip missing / non-finite values, e.g. DFA unavailable)
  const zScores = {};
  for (const [metric, norm] of Object.entries(norms)) {
    const v = hrv[metric];
    if (v !== undefined && v !== null && Number.isFinite(v)) {
      zScores[metric] = zScore(v, norm.mean, norm.sd);
    }
  }

  // Compute posterior for each disorder
  const results = DISORDER_SIGNATURES.map(disorder => {
    const prior = PREVALENCE[disorder.id] || 0.02;
    const priorOdds = prior / (1 - prior);

    // Multivariate log-Bayes-factor across the disorder's features
    const { logBF, used } = multivariateLogBF(
      Object.entries(disorder.features),
      zScores
    );

    // If no features matched, posterior = prior
    if (used === 0) {
      return {
        id: disorder.id,
        name: disorder.name,
        description: disorder.description,
        probability: Math.round(prior * 100),
        level: 'low',
        prior: Math.round(prior * 100),
        bayesFactor: 1,
        featureContributions: {},
        insufficientData: true,
      };
    }

    // Posterior probability P(D | data), computed in log-odds form so an
    // extreme Bayes factor can't overflow exp() to Infinity → NaN posterior.
    const logPosteriorOdds = Math.log(priorOdds) + logBF;
    const posterior = 1 / (1 + Math.exp(-logPosteriorOdds));
    const probability = Math.round(posterior * 100);

    // Level classification on a fixed evidence bar (Kass & Raftery):
    // BF ≥ 10 = strong, BF ≥ 3 = moderate, else weak.
    let level;
    if (logBF >= Math.log(10)) level = 'high';
    else if (logBF >= Math.log(3)) level = 'medium';
    else level = 'low';

    return {
      id: disorder.id,
      name: disorder.name,
      description: disorder.description,
      probability,
      level,
      prior: Math.round(prior * 100),
      logBF: Math.round(logBF * 100) / 100,
      bayesFactor: Math.min(999, Math.round(Math.exp(logBF))),
      featureContributions: {},
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
  let norm;
  if (metric === 'sdnn') norm = getSDNNNorm(age, sex); // 2-min duration-corrected
  else if (metric === 'rmssd') norm = getNorm(NORMS_RMSSD, age, sex);
  else if (metric === 'pnn50') norm = getNorm(NORMS_PNN50, age, sex);
  else if (metric === 'lfhfRatio') norm = getNorm(NORMS_LFHF, age, sex);
  else return 'normal';
  const z = zScore(value, norm.mean, norm.sd);
  if (z < -1.5) return 'low';
  if (z > 1.5) return 'high';
  return 'normal';
}
