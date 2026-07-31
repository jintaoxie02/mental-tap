# MentalTap — Accuracy & Performance Improvement Plan

Research deliverable (2026-08-01). Grounded in (a) measured runs of the actual pipeline
(synthetic PPG → detection → HRV → screening), (b) a 6-agent parallel research workflow
(signal processing, HRV science, screening-model statistics, browser performance,
2020–2026 literature), (c) verified literature. Nothing below requires labeled training data;
every item is implementable from published statistics or standard DSP.

## Executive summary — the quantified headline findings

| # | Finding | Measured impact |
|---|---------|-----------------|
| A | **No IBI artifact editing.** The only rejection is a 300–2000 ms range gate. A false beat on the dicrotic notch (then suppressed by the 400 ms refractory) creates a short/long IBI pair; **2 anomalies in 71 IBIs inflate RMSSD from ~0 to ~85 ms** on a perfectly periodic heart. | Artifact editing recovers **RMSSD 84.6 → 0.48 ms** (SDNN 53.8 → 0.28). For a rigid-heart subject the screening flips **depression 0% → 77%** end-to-end. |
| B | **Naive-Bayes double-counts correlated features.** SDNN/RMSSD/pNN50 are r=0.72–0.93 views of one vagal construct; SD1=RMSSD/√2 and SD2 are deterministic. The model treats ~1.4 effective dimensions as 3 independent pieces of evidence. | At HRV z=−2.0 the naive posterior is **50% vs 8.4%** correctly weighted; the "high" 25% threshold fires at z=−1.39 where the honest posterior is 5.6%. |
| C | **Glucose feature is a deterministic function of the same HRV metrics**, z-scored against fasting-glucose norms and injected into depression/bipolar. | Removing it drops the depression posterior **39% → 20%** on identical HRV evidence (the glucose term was bigger than the RMSSD term despite a smaller g). No non-invasive PPG glucose device is FDA-authorized (Jiang et al. 2025, 106-study review). |
| D | **Beat fiducial is the systolic *peak* of a 0.7–3 Hz filtered signal** — amplitude-dependent jitter at 30 fps. | Measured per-beat timing error σ_ε ≈ 21–30 ms, of which the 30 fps grid is only ~13.6 ms. The max-slope point of the upstroke is a far more repeatable fiducial. |
| E | **Performance is already cheap**: full 120 s analysis ≈ 4 ms; the O(N²) DFT is ~1.9 ms. | Radix-2 FFT is **125× faster** (0.016 ms) and bit-identical. Real perf costs are mobile: canvas `shadowBlur`, the 110 KB/frame `getImageData` readback, and per-frame array allocations. |

**Bottom line.** The biggest accuracy gains are *measurement trust* (edit IBIs, choose a stable
fiducial, de-bias RMSSD, gate on signal quality) and *model honesty* (drop glucose, collapse
collinear features, duration-correct SDNN). Performance work is cheap and parallelizable;
it is about mobile smoothness and headroom, not the one-shot analysis.

## Tier 0 — Ship-blocking correctness (do before any release; ~4–6 days)

1. **Remove the glucose feature from every disorder posterior** (low).
   `glucose-estimator.js:37-49` is a deterministic linear function of bpm/sdnn/rmssd/lfhfRatio,
   so it double-counts HRV evidence and injects a systematic false-positive bias. Delete
   `glucose` from `DISORDER_SIGNATURES` (normative-data.js:84,120) and stop z-scoring it
   (zero-shot.js:108-111). Keep the metric card but relabel it "experimental — not validated."

2. **Collapse the collinear time-domain block** (low/medium). Give each disorder **at most one
   parasympathetic marker + one global marker** (e.g. depression: SDNN only, g=−0.87; anxiety/
   schizophrenia: RMSSD; PTSD/bipolar: RMSSD or SDNN, not both). Drop pNN50 everywhere (its 50 ms
   threshold sits inside the quantization noise and needs ~5 min to stabilize). Delete the
   `lfhfRatio` entries (non-significant in the app's own cited meta-analysis: Wu 2023, g=−0.05,
   p=0.68). Rigorous alternative: multivariate-Gaussian logBF `μ'Σ⁻¹z − ½μ'Σ⁻¹μ` with Σ from
   published population correlations. Fire "high" at a fixed evidence bar (Bayes factor ≥ 10)
   instead of a raw posterior percentage.

3. **IBI artifact editing pass before computeHRV** (medium). Lipponen & Tarvainen (2019) QD
   method on the ~140-beat series: flag `|dRR|`/`|mRR|` > median + 4–5·MAD; classify short-long
   pair (ectopic → delete both, cubic-spline interpolate), isolated long (missed → split),
   isolated short (extra → merge). **Interpolate, never delete** (Peltola 2012). If >20–30% of
   IBIs are edited, return "signal quality too low — retake." Post-correction HRV error < 2%.

4. **Move the beat fiducial to the max-slope point of the systolic upstroke** (low). In
   beat-detector.js, relocate each candidate to the max of the first difference within
   `[peak−6, peak]` and parabolic-refine the *difference* signal. Cuts the RMSSD floor from
   30–43 ms toward ~10–15 ms.

5. **RMSSD noise-floor de-bias** (low). `RMSSD_corr = sqrt(max(RMSSD² − c, 0))` with `c = 2σ_ε²`
   calibrated once on a **synthetic** clean PPG at the app's own fs (zero-shot, no patient data).
   Display as "est." with the measurement floor shown.

6. **Fix the SDNN duration/norm mismatch** (low). 120 s recording scored against 5-min norms
   (and the source attribution is internally inconsistent: i18n.js:71 cites 10-s ECG). Apply a
   duration factor to the SDNN norm means (~0.75–0.8) or shift the z by +0.2–0.6 σ. Keep 120 s
   (5 min is a big UX cost; RMSSD is duration-stable and DFA α1 is reliable at exactly 120 s).

## Tier 1 — Signal trust and capture (~3–5 days)

7. **Segmental SQI + quality gate** (medium). Split 120 s into ~10 s windows; per window compute
   spectral purity (0.7–3 Hz / 0.2–4 Hz power), mean beat-template correlation vs the window's
   median template (self-referential, no training data), and skewness/kurtosis. Drop windows
   below threshold; if accepted signal < 60 s, guide a retake. Quality filtering alone raised
   smartphone-PPG RMSSD correlation vs ECG from 0.64 → 0.88 (SPQI, Sensors 2020).

8. **Request 60 fps and parameterize fs end-to-end** (low). `frameRate: { ideal: 60 }`,
   `targetInterval = 16`; compute `fs = round(1000/median(dt))` at record end and pass into
   `createBandpassFilter(fs)` / `detectBeats(..., fs)`; scale live-path windows (180→360 samples)
   and the accumulation cap (7200→10800). Grid quantization halves (~13.6 → 6.8 ms). Pair with #11
   to keep 60 fps affordable.

## Tier 2 — Spectral honesty (~2–3 days)

9. **Rewrite the frequency-domain path** (medium). Cubic-spline (PCHIP) resample at 4 Hz instead
   of zero-order-hold (ZOH inflates HF ~36% and biases LF/HF ~21% low), smoothness-priors
   detrend (Tarvainen 2002, λ=500), and a radix-2 FFT (~106× faster, bit-identical). The only
   defensible 2-min spectral component is HF (respiration tracking) — treat LF/HF accordingly.
   Do **not** switch to Lomb-Scargle now (O(M·N), slower than the DFT).

## Tier 3 — Mobile performance (~2 days, parallelizable)

10. **Delete `ctx.shadowBlur`** from the waveform trace (the canonical mobile-GPU killer); the CSS
    `.waveform-glow` already provides the ambient glow. Cap devicePixelRatio at 2.0.
11. **Shrink the per-frame readback to a 64×64 ROI** — 6.75× less `getImageData` (110 KB/frame →
    ~16 KB), the biggest sustained-jank fix during recording. The browser's bilinear downscale
    does the spatial averaging.
12. **Ring buffers + cumulative-sum detrend** in the live BPM path (main.js:179-220): fixed
    Float64Array buffers with running sum/sumSq (O(1) mean/std) and an O(n) running-mean detrend
    (bit-identical, ~3× fewer allocations/frame).

## Tier 4 — New evidence & robustness (~4–6 days)

13. **Add DFA α1** as the only genuinely independent autonomic dimension (reliable at exactly
    120 s, ICC ~0.90, least quantization-sensitive nonlinear index).
14. **Replace the rolling-max threshold with the Elgendi two-moving-average detector** (99.84% Se
    / 99.89% +P in the 2013 PLoS ONE evaluation); also fixes the 55% vs 60% comment mismatch.
15. **Unify the live and offline detection pipelines** — they currently use opposite polarity
    (live detects minima on raw green; offline detects maxima on inverted band-passed signal).
16. **Media-synced timestamps via `requestVideoFrameCallback`** to remove display-to-media timing
    jitter (rVFC fallback for iOS).

## Tier 5 — Polish (as time allows)

17. Report a continuous posterior + Bayes factor + 95% credible interval (the published g's carry
    95% CIs the code discards), instead of bare "%" as disease probability.
18. Compute waveform morphology on a wider 0.5–8 Hz stream, bound RI/AI to [0,1], require a
    consistent dicrotic notch.
19. Worker offload only when analysis exceeds ~15–30 ms on mid-range phones (today's ~4 ms is
    negligible).
20. Drop the redundant SMA detrend (the 0.7 Hz high-pass covers it), normalize by MAD/percentiles,
    pad filter input to kill the biquad startup transient.

## Deferred / do-not-do

- **Sample entropy** — needs ≥180 s and is the most quantization-sensitive nonlinear index.
  Route the nonlinear budget to DFA α1.
- **CSI/CVI Poincaré geometry as screening features** — redundant with RMSSD/SDNN.
- **Lomb-Scargle now** — slower than the DFT; revisit only in a 5-min research mode.
- **Absolute LF/HF power at 2 min** — stays excluded; needs the 5-min recording.
- **Discriminating the five disorders** — all signatures are "reduced HRV"; the discrimination
  ceiling is real. Reframe the results as a *ranking given shared evidence*.
- **Worker offload today** — 4 ms is not blocking.
- **A validated PPG-glucose number** — requires a finger-prick calibration study across skin tones
  and devices; not a zero-shot fix.

## The no-training-data boundary

**Improvable purely from literature/statistics:** IBI editing (Lipponen & Tarvainen 2019),
max-slope fiducial (DSP), RMSSD floor constant (synthetic-signal calibration), SDNN duration
norm (published tables), feature collapse / multivariate Σ (published correlation matrices),
spectral pipeline (Tarvainen 2002), SQI thresholds (literature + self-referential templates),
DFA α1 (published reliability), Elgendi detector (published params), glucose removal (evidence).

**Requires a calibration study (out of zero-shot scope — label it in the UI):** any *retained*
glucose number; a device/user-adaptive RMSSD floor constant measured on real fingertip
recordings; help-seeking-adjusted priors; validation that corrected RMSSD/DFA α1 map onto the
normative-population scales.

## Dependency order

Model items (1, 2, 6) land first and are independent. Measurement items (3, 4, 5) protect the
RMSSD/SDNN the model now relies on — 5 must come *after* 4 (calibrate the floor constant on the
fixed detector). Items 7 and 8 reduce corrupted signal reaching the detector; 8 also frees
headroom. Item 9 is isolated to hrv-calculator.js. Items 10–12 are pure performance and can merge
into any sprint. Item 13 depends on the cleaned IBI series from 3–5.

## Verified sources

- Lipponen & Tarvainen 2019, *J Med Eng Technol* — QD artifact correction (<2% HRV error)
- Wu et al. 2023, *Front Public Health* — depression HRV meta-analysis (SDNN g=−0.87, RMSSD
  g=−0.51, pNN50 g=−0.43, LF/HF g=−0.05 ns) — matches the values in normative-data.js
- Choi & Shin 2017, *Physiol Meas* — PPG sampling frequency vs PRV/HRV (degraded below ~25 Hz)
- Jiang, Yao & Ding 2025, *Artif Intell Rev* — PPG glucose sensors: 106-study review (not
  clinically validated)
- Peltola 2012, *Front Physiol* — short-term HRV reliability; artifact editing requirements
- Task Force 1996, *Circulation* — 5-min spectral HRV standard; duration dependence of SDNN
- SPQI, *Sensors* 2020 — quality filtering: smartphone-PPG RMSSD correlation 0.64 → 0.88
- Elgendi 2013, *PLoS ONE* — two-moving-average PPG peak detection (99.84/99.89 Se/+P)
