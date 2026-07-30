# MentalTap

**Zero-shot psychiatric screening via smartphone camera fingertip PPG.**

Place your finger on your phone's rear camera for 2 minutes. MentalTap extracts your photoplethysmography (PPG) signal, computes heart rate variability (HRV) and pulse waveform features, and compares your autonomic profile against published meta-analytic signatures of depression, anxiety, PTSD, bipolar disorder, and schizophrenia — all on-device, with no training data, no account, and no data leaving your phone.

## How It Works

1. **PPG extraction** — The camera's green channel captures blood volume changes in your fingertip
2. **Signal processing** — Bandpass filtering (0.7–3 Hz) isolates the cardiac pulse waveform
3. **Beat detection** — Adaptive threshold peak detection computes inter-beat intervals
4. **HRV analysis** — Time-domain (SDNN, RMSSD, pNN50) and frequency-domain (LF, HF, LF/HF) metrics
5. **Zero-shot classification** — Age/sex-normalized z-scores matched against disorder-specific autonomic signatures derived from meta-analyses covering 34,625+ participants

## The Science

HRV is a validated biomarker of autonomic nervous system function. Reduced HRV is associated with:

| Condition | Key HRV Finding | Evidence |
|-----------|----------------|----------|
| **Major Depressive Disorder** | ↓ SDNN (g = −0.87), ↓ RMSSD, ↓ HF | Wu et al. (2023), meta-analysis of 43 studies |
| **Anxiety Disorders** | ↓ RMSSD, ↓ HF | Translational Psychiatry (2025), umbrella review of 442 studies |
| **PTSD** | ↓ Overall HRV | Suggestive evidence (Class III) |
| **Bipolar Disorder** | ↓ Overall HRV | Weak evidence (Class IV) |
| **Schizophrenia** | ↓↓ RMSSD, ↓↓ HF | Suggestive evidence (Class III) |

*References: Wu et al. (2023) Frontiers in Public Health; Translational Psychiatry (2025) Nature.*

## Development

```bash
npm install
npm run dev     # Start dev server
npm run build   # Production build → dist/
npm run preview # Preview production build
```

## Disclaimer

**MentalTap is an experimental screening tool, not a clinical diagnostic device.**
It has not been evaluated by the FDA or any regulatory body. The patterns it detects are based on published research on heart rate variability and mental health — these are statistical associations, not deterministic diagnoses. Always consult a qualified healthcare professional for mental health evaluation and treatment.

## Privacy

All processing happens locally on your device. No video, PPG data, HRV metrics, or screening results are ever transmitted to any server. The app works entirely offline after the initial page load.

## License

MIT
