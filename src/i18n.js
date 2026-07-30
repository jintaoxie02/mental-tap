/**
 * Simple i18n — English + 廣東話
 * Detects browser language, persists choice in localStorage.
 */

const STRINGS = {
  en: {
    // Welcome
    'hero.title': 'MentalTap',
    'hero.subtitle': 'Screen your autonomic health through your fingertip.',
    'hero.desc': 'Your heart rate variability reveals how your nervous system responds to the world. Place your finger on the camera for 2 minutes. No data leaves your device.',
    'hero.start': 'Start Measurement',
    'hero.footnote': 'No account needed. All processing happens on-device.\nThis is a screening tool, not a diagnosis.',

    // Setup
    'setup.title': 'Cover your rear camera',
    'setup.desc': 'Press your fingertip firmly against the rear camera and flash. The amber light you see is your pulse.',
    'setup.step1': 'Switch to rear camera',
    'setup.step2': 'Cover camera + flash with fingertip',
    'setup.step3': 'Stay still for 2 minutes',
    'setup.age': 'Age',
    'setup.sex': 'Sex',
    'setup.male': 'Male',
    'setup.female': 'Female',
    'setup.ready': "I'm Ready",

    // Recording
    'record.tap': 'Place fingertip on camera, then tap here to start',
    'record.hint': 'Keep your fingertip steady. Breathe normally.',
    'record.cancel': 'Cancel',

    // Results
    'results.title': 'Your Autonomic Profile',
    'results.subtitle': 'Based on a 2-minute fingertip PPG recording',
    'results.screening_title': 'Screening Results',
    'results.screening_subtitle': 'Bayesian posterior probabilities compared against published disorder signatures from 34,000+ participants:',
    'results.sdnn_tip': 'Standard deviation of all heartbeat intervals. Measures total autonomic flexibility — how much your heart rate varies overall. Higher is generally better. The strongest HRV marker for depression (g = −0.87 in meta-analyses).',
    'results.rmssd_tip': 'Root Mean Square of Successive Differences. Reflects beat-to-beat changes driven by the vagus nerve (parasympathetic / rest-and-digest system). Higher RMSSD = stronger vagal tone = better stress recovery.',
    'results.pnn50_tip': 'Percentage of consecutive heartbeats that differ by more than 50 milliseconds. Another vagal/parasympathetic measure. Lower pNN50 indicates less moment-to-moment heart rate flexibility, often seen in anxiety and depression.',
    'results.lfhf_tip': 'Ratio of Low-Frequency (0.04–0.15 Hz) to High-Frequency (0.15–0.40 Hz) heart rate power. Roughly reflects sympathetic (fight/flight) vs parasympathetic (rest/digest) balance. ~1.5 is normal; >2.5 suggests sympathetic dominance (stress/anxiety); <1.0 may indicate parasympathetic withdrawal (depression). This ratio is debated in research — interpret with caution.',
    'results.glucose_tip': 'Estimated fasting blood glucose from PPG waveform features. Based on published PPG-glucose regression models (R² up to 0.96 in research). Uses heart rate, HRV, and arterial stiffness features. This is a screening estimate — not equivalent to a finger-prick or lab test. Normal fasting: <5.6 mmol/L (<100 mg/dL).',
    'results.metrics_explain': 'What do these metrics mean?',
    'results.calc_explain': 'How are these calculated?',
    'results.refs': 'Academic references',
    'results.disclaimer': 'This is an experimental screening tool, not a clinical diagnosis. These patterns are based on published research on heart rate variability and mental health. Consult a healthcare professional for proper evaluation.',
    'results.retake': 'Take Another Reading',
    'results.all_low': 'All posterior probabilities are at or near population baseline — your autonomic profile does not suggest elevated risk for any screened condition. This does not rule out mental health conditions.',

    // Explainers
    'explain.metrics': `
      <p><strong>SDNN</strong> — Total heart rate variability. Think of it as your heart's overall adaptability. Athletes and healthy young adults often have SDNN > 50ms. Values below 30ms warrant attention. This is the strongest HRV marker for depression in research literature.</p>
      <p><strong>RMSSD</strong> — Short-term, beat-to-beat variability controlled by your vagus nerve. This nerve is the main highway of your parasympathetic nervous system — it slows your heart, calms your body, and helps you recover from stress. RMSSD naturally declines with age.</p>
      <p><strong>pNN50</strong> — How often your heart makes meaningful beat-to-beat adjustments (>50ms). A complementary measure to RMSSD. If pNN50 is low, your heart isn't making many moment-to-moment adjustments, which can indicate chronic stress or autonomic rigidity.</p>
      <p><strong>LF/HF</strong> — The balance between your sympathetic ("go") and parasympathetic ("slow") systems. This ratio is most useful for detecting sympathetic overdrive (anxiety, PTSD). It is <em>not</em> a reliable depression marker — many depressed individuals have normal LF/HF ratios. The absolute power in each band (LF power, HF power) is often more informative than the ratio.</p>
      <p><strong>Glucose (est.)</strong> — Estimated fasting blood glucose derived from PPG waveform features (heart rate, HRV, arterial stiffness indices). Uses a multi-feature linear model calibrated against published PPG-glucose studies (R² up to 0.96 in research settings). Normal fasting: &lt;5.6 mmol/L (&lt;100 mg/dL); pre-diabetic: 5.6–6.9; diabetic: ≥7.0. <em>This is a screening estimate, not a replacement for a blood test.</em></p>
      <p><strong>Status labels</strong> (LOW / NORMAL / HIGH) compare your value against age- and sex-matched population norms from studies of 13,000+ healthy participants. "Low" means more than 1.5 standard deviations below the norm for your demographic.</p>
    `,
    'explain.calc': `
      <p><strong>Bayesian probability estimation</strong> — Uses a Naive Bayes model. The <em>prior</em> is the population prevalence (e.g., ~5% for depression). Each HRV and glucose feature contributes a <em>Bayes Factor</em>: how much more likely your value is under the disorder distribution vs the healthy distribution, using effect sizes (Hedges' g) from meta-analyses to shift the disorder distribution. Bayes' theorem combines the prior with all feature likelihoods to produce a <em>posterior probability</em> — P(disorder | your data). Published multimodal studies confirm combining HRV with metabolic markers improves accuracy from ~64% to ~80% (Jin et al., 2017).</p>
      <p>Each condition has a known "autonomic signature" — a pattern of which HRV metrics are typically reduced or elevated, based on published meta-analyses:</p>
      <p><strong>Depression</strong> — Broad HRV reduction. SDNN is typically most affected (g = −0.87). RMSSD and HF power moderately reduced (g ≈ −0.51). LF/HF ratio usually normal. Source: Wu et al. (2023), meta-analysis of 43 studies.</p>
      <p><strong>Anxiety (GAD)</strong> — Mild to moderate HRV reduction, particularly in parasympathetic indices (RMSSD, HF). Some sympathetic dominance (↑ LF/HF). Less pronounced than depression.</p>
      <p><strong>PTSD</strong> — Broad HRV reduction with possible sympathetic dominance. One of the stronger HRV-psychiatric associations in the 2025 umbrella review (Translational Psychiatry, Nature).</p>
      <p><strong>Bipolar Disorder</strong> — Mild HRV reduction. May normalize during stable (euthymic) periods. Weaker and less consistent than unipolar depression.</p>
      <p><strong>Schizophrenia</strong> — Strong parasympathetic reduction (↓↓ RMSSD, ↓↓ HF). The most robust HRV finding across all psychiatric conditions in the umbrella review.</p>
      <p><strong>Combined HRV + Glucose approach</strong> — The screening uses both autonomic (HRV) and metabolic (estimated glucose) biomarkers. Published multimodal studies show combining modalities improves diagnostic accuracy significantly: HRV alone achieves ~64% accuracy for MDD classification, but combining HRV with metabolic markers reaches ~80% (Jin et al., 2017, <em>Progress in Neuro-Psychopharmacology & Biological Psychiatry</em>).</p>
      <p>The percentage shown is the Bayesian posterior probability. For context, the population baseline is shown alongside. <strong>This is a screening estimate, not a clinical diagnosis.</strong></p>
    `,

    // References
    'ref.hrv_norms_berg': '<strong>van den Berg et al. (2018)</strong> — Normal values of corrected heart-rate variability in 10-second electrocardiograms for all ages. <em>Frontiers in Physiology</em>. 13,943 healthy participants, ages 11 days to 91 years. First comprehensive lifespan HRV reference ranges. Used for age/sex normalization of SDNN and RMSSD.',
    'ref.hrv_norms_ortega': '<strong>Ortega et al. (2024)</strong> — "The Pulse of Singapore." <em>Applied Psychophysiology & Biofeedback</em>. 2,143 healthy participants, ages 10–89. Population norms: RMSSD ≈ 42 ms, SDNN ≈ 52 ms (5-min recordings). Used for pNN50 normative ranges.',
    'ref.depression_wu': '<strong>Wu et al. (2023)</strong> — Heart rate variability status at rest in adult depressed patients: a systematic review and meta-analysis. <em>Frontiers in Public Health</em>. 43 case-control studies, 2,359 depressed vs 3,547 controls. SDNN Hedge\'s g = −0.87 (largest effect). Used for depression autonomic signature weights.',
    'ref.all_transpsych': '<strong>Translational Psychiatry (2025)</strong> — Heart rate variability in mental disorders: an umbrella review of meta-analyses. <em>Nature</em>. 21 systematic reviews, 442 primary studies, 34,625 participants across 19 mental disorders. Classifies evidence as convincing/suggestive/weak. Used for disorder signatures and confidence thresholds.',
    'ref.ppg_cajal': '<strong>Cajal et al. (2025)</strong> — Evaluation of Stress Response Using Smartphone PPG for Anxiety and Depression Monitoring. <em>IEEE</em>. 79 participants (22 patients, 57 controls). Validated smartphone PPG against medical-grade device: r ≥ 0.96. First SCPPG study with clinical anxiety/depression populations.',
    'ref.ppg_liu': '<strong>Liu et al. (2020)</strong> — Happiness at Your Fingertips: Assessing Mental Health with Smartphone Photoplethysmogram-Based Heart Rate Variability Analysis. <em>Telemedicine and e-Health</em>. 93 participants. 4-minute fingertip video. Higher HRV = higher well-being; lower HRV = depression and anxiety.',
    'ref.waveform_kaizu': '<strong>Kaizu et al. (2026)</strong> — Assessing Mental Health and Emotional States by Using Smartphone Photoplethysmography–Based Digital Pulse Waveform Analysis. <em>JMIR mHealth and uHealth</em>. 127 participants. 7 pulse waveform features (F/A, V0, reflection index, crest time) associated with depression and anxiety.',
    'ref.suicide_khandoker': '<strong>Khandoker et al. (2017)</strong> — Suicidal Ideation Is Associated with Altered Variability of Fingertip Photo-Plethysmogram Signal in Depressed Patients. <em>Frontiers in Physiology</em>. 61 participants. Tone-entropy analysis of fingertip PPG achieved 93.33% accuracy for suicidal ideation classification.',
    'ref.bipolar_lyu': '<strong>Lyu et al. (2025)</strong> — Wearable Photoplethysmography-based Bipolar Disorder Detection. <em>CSAI 2024 (ACM)</em>. Wavelet transform + SVM on PPG from smartwatch. 86.5% accuracy distinguishing mania, bipolar depression, and healthy states.',
    'ref.multi_gpsychsw': '<strong>G-PsychSW (2025)</strong> — Generalizable Psychiatric Screening from Wearable: Causal Disentanglement of Multi-Channel Biosignals. <em>IEEE BIBM</em>. PPG + GSR + skin temperature. 80.16% accuracy for 4-class screening (depression, anxiety, bipolar, healthy). Leave-one-subject-out validation.',
    'ref.signal_cho': '<strong>Cho et al. (2018)</strong> — Instant Automated Inference of Perceived Mental Stress through Smartphone PPG and Thermal Imaging. <em>JMIR Mental Health</em>. Combined smartphone camera PPG with low-cost thermal camera for stress detection in 17 participants over 20-second measurements.',
    'ref.glucose_chinchanikar': '<strong>Chinchanikar & Dale (2025)</strong> — Multimodal Approach for Non-Invasive Blood Glucose Estimation Using Fingertip Video. <em>MMEP</em>. 243 subjects. Hybrid ResNet + handcrafted PPG features. R² = 0.88, MAE = 14.50 mg/dL. Bland-Altman >90% agreement with reference.',
    'ref.glucose_raju': '<strong>Raju et al. (2022)</strong> — SmartPPG-Glucose: non-invasive glucose from smartphone PPG. 93 subjects. DNN with MIC feature selection on 34 PPG features. R² = 0.96. Foundation for the PPG-to-glucose feature mapping used in MentalTap.',
    'ref.glucose_sridevi': '<strong>Sridevi et al. (2025)</strong> — Noninvasive estimation of blood glucose and HbA1c using Quantum Machine Learning. <em>Elsevier</em>. 136 subjects. Quantum SVM on 45 PPG features. 89.3% accuracy for glucose, 96.3% for HbA1c.',
    'ref.metabolic_wong': '<strong>Wong et al. (2026)</strong> — Depressive symptom severity and metabolic disturbances in MDD and bipolar disorders: a systematic review and meta-analysis. <em>Journal of Affective Disorders</em>. 28 studies, 22,897 participants. Fasting glucose SMD = 0.30 in depression. Insulin resistance associated with anhedonia, sleep disturbances, and suicidal ideation.',
    'ref.multimodal_jin': '<strong>Jin et al. (2017)</strong> — Diagnosis of MDD by combining multimodal information from heart rate dynamics and serum proteomics using machine-learning. <em>Progress in Neuro-Psychopharmacology & Biological Psychiatry</em>. HRV alone: 64% accuracy; HRV + metabolic proteomics: 80.1%. Demonstrates value of combining autonomic + metabolic biomarkers.',

    // Reference tags
    'tag.hrv_norms': 'HRV norms',
    'tag.all_disorders': 'All disorders',
    'tag.depression': 'Depression',
    'tag.smartphone_ppg': 'Smartphone PPG',
    'tag.pulse_waveform': 'Pulse waveform',
    'tag.suicidal_ideation': 'Suicidal ideation',
    'tag.wearable_ppg': 'Wearable PPG',
    'tag.multi_disorder': 'Multi-disorder',
    'tag.signal_processing': 'Signal processing',
    'tag.ppg_glucose': 'PPG-glucose',
    'tag.metabolic': 'Metabolic',
    'tag.multimodal': 'Multimodal',

    // Errors
    'error.title': 'Something went wrong',
    'error.retry': 'Try Again',
    'error.no_data': 'Not enough data. Keep your fingertip steady for the full duration.',
    'error.analysis_failed': 'Analysis failed. Try again with a steady fingertip.',
    'error.camera_denied': 'Camera permission denied. Please allow camera access and try again.',
    'error.camera_not_found': 'No camera found. This app requires a rear camera.',
    'error.camera_in_use': 'Camera is in use by another app. Close other apps and try again.',
    'error.camera_unavailable': 'Camera not available',
    'error.signal_failed': 'Signal processing error. Please ensure your fingertip covers the camera and flash completely, then try again.',

    // Disorder descriptions
    'disorder.depression': 'Reduced HRV across all domains (especially SDNN, g = −0.87). Often with elevated fasting glucose (SMD = 0.30).',
    'disorder.anxiety': 'Mild to moderate HRV reduction, particularly parasympathetic (RMSSD, HF).',
    'disorder.ptsd': 'Broad HRV reduction. One of the strongest HRV-psychiatric associations in umbrella review.',
    'disorder.bipolar': 'Mild HRV reduction. May normalize during euthymic states. Metabolic disturbances (↑ glucose, ↑ triglycerides) common.',
    'disorder.schizophrenia': 'Strong parasympathetic (RMSSD, HF) reduction. Strongest evidence in umbrella review.',

    // Language switcher
    'lang.switch': '中文',
  },

  'zh-HK': {
    // Welcome
    'hero.title': 'MentalTap',
    'hero.subtitle': '指尖兩分鐘，睇下你嘅身體訊號',
    'hero.desc': '你嘅心跳變化反映出身體點樣應對壓力同情緒。將手指放上鏡頭兩分鐘，所有數據唔會離開你部電話。',
    'hero.start': '開始測量',
    'hero.footnote': '唔使開account，所有運算喺裝置內完成\n呢個係篩查工具，唔係診斷',

    // Setup
    'setup.title': '遮蓋後置鏡頭',
    'setup.desc': '將指尖緊貼後置鏡頭同閃光燈。你見到嘅琥珀色光就係你嘅脈搏。',
    'setup.step1': '切換到後置鏡頭',
    'setup.step2': '用指尖遮蓋鏡頭同閃光燈',
    'setup.step3': '保持靜止2分鐘',
    'setup.age': '年齡',
    'setup.sex': '性別',
    'setup.male': '男',
    'setup.female': '女',
    'setup.ready': '準備好',

    // Recording
    'record.tap': '放手指上鏡頭，然後點擊開始',
    'record.hint': '保持指尖穩定，正常呼吸',
    'record.cancel': '取消',

    // Results
    'results.title': '你嘅檢測結果',
    'results.subtitle': '基於2分鐘指尖記錄',
    'results.screening_title': '篩查結果',
    'results.screening_subtitle': '貝葉斯後驗概率，對比34,000+參與者嘅研究數據：',
    'results.sdnn_tip': '所有心跳間隔嘅標準差。反映心臟整體嘅適應能力，數值愈高愈好。係咁多個HRV指標入面，同抑鬱症關聯最強嗰個（meta-analysis g = −0.87）。',
    'results.rmssd_tip': '逐次心跳之間嘅變化幅度，由迷走神經控制。簡單嚟講：RMSSD愈高，你嘅身體恢復得愈快，壓力管理愈好。會隨年齡自然下降。',
    'results.pnn50_tip': '相鄰心跳差距超過50毫秒嘅比例。又係一個睇迷走神經嘅指標。偏低代表心臟跳得比較「死板」，常見於長期壓力大或者情緒低落嘅人。',
    'results.lfhf_tip': '交感神經（緊張mode）同副交感神經（放鬆mode）嘅比例。~1.5係正常；高過2.5代表身體偏緊張（壓力大/焦慮）；低過1.0可能係放鬆系統唔夠力（抑鬱）。學術界對呢個ratio有爭議，參考下就好。',
    'results.glucose_tip': '從脈搏波形估算嘅空腹血糖。用咗心跳、HRV同血管硬度等特徵，參考已發表嘅PPG血糖研究（R²最高0.96）。正常空腹：<5.6 mmol/L（<100 mg/dL）；前期：5.6–6.9；偏高：≥7.0。呢個係估算，唔係驗血。',
    'results.metrics_explain': '呢啲指標代表咩意思？',
    'results.calc_explain': '點樣計算出嚟？',
    'results.refs': '學術參考文獻',
    'results.disclaimer': '<strong>注意：</strong>呢個係實驗性篩查工具，唔係臨床診斷。數據基於已發表嘅心率變異同心理健康研究。請諮詢醫護人員作正式評估。',
    'results.retake': '重新測量',
    'results.all_low': '所有後驗概率都接近或低於人口基線 — 你嘅數據同一般人差唔多，未見任何已篩查狀況嘅風險升高。當然，呢個唔代表一定冇問題。',

    // Explainers
    'explain.metrics': `
      <p><strong>SDNN</strong> — 心臟整體變化幅度。想像下你嘅心臟有幾「識變通」：運動員同健康年輕人通常>50ms，低過30ms就要留意。係研究入面同抑鬱症關聯最強嘅HRV指標。</p>
      <p><strong>RMSSD</strong> — 逐次心跳之间嘅微調，由迷走神经控制。呢條神经幫你放鬆、減慢心跳、喺壓力之後恢復。RMSSD愈高 = 恢復得愈快。會隨年齡自然跌。</p>
      <p><strong>pNN50</strong> — 心臟有幾經常作出大過50ms嘅即時調整。RMSSD嘅另一個角度。偏低代表心跳比較「死板」，可能係長期壓力大或者情緒緊張嘅表現。</p>
      <p><strong>LF/HF</strong> — 緊張mode（交感）同放鬆mode（副交感）嘅比例。最有用的係睇吓係咪長期偏緊張（焦慮、PTSD）。<em>唔好</em>用嚟判斷抑鬱 — 好多抑鬱嘅人LF/HF都正常。分開睇LF同HF各自嘅數值通常更有用。</p>
      <p><strong>血糖（估算）</strong> — 從脈搏波形推算嘅空腹血糖，參考咗心跳、HRV同血管硬度。基於已發表嘅PPG血糖研究（R²最高0.96）。正常：&lt;5.6 mmol/L（&lt;100 mg/dL）；前期：5.6–6.9；偏高：≥7.0。<em>係估算，唔可以代替篤手指或者抽血。</em></p>
      <p><strong>狀態標籤</strong>（偏低 / 正常 / 偏高）係將你嘅數值對比同年齡同性別嘅general population（13,000+人嘅研究數據）。「偏低」即係低過你嗰個年齡性別組別嘅平均值1.5個標準差。</p>
    `,
    'explain.calc': `
      <p><strong>貝葉斯概率</strong> — 用咗Naive Bayes模型。出發點係<em>人口患病率</em>（例如抑鬱症大約5%嘅人有）。然後你嘅每個HRV同血糖數據會貢獻一個<em>似然比</em>：你呢個數值，喺「有呢個病」嘅人入面常見啲，定係「冇病」嘅人入面常見啲？用meta-analysis嘅效應量（Hedges' g）嚟推算。最後用貝葉斯定理將所有證據加埋，得出<em>後驗概率</em>。已發表研究顯示，HRV加埋代謝指標一齊睇，準確度可以由~64%跳到~80%（Jin et al., 2017）。</p>
      <p>每種狀況都有佢嘅「心跳特徵」— 即係邊啲HRV指標通常會高咗定低咗，數據嚟自meta-analyses：</p>
      <p><strong>抑鬱症</strong> — 大部分HRV指標都偏低。SDNN跌得最明顯（g = −0.87）。RMSSD同HF都中度偏低（g ≈ −0.51）。LF/HF通常正常。來源：Wu et al.（2023），綜合43項研究。</p>
      <p><strong>焦慮症（GAD）</strong> — 輕度至中度HRV偏低，尤其係放鬆相關嘅指標（RMSSD、HF）。有少少緊張mode主導（↑ LF/HF）。整體嚟講比抑鬱症輕微。</p>
      <p><strong>PTSD</strong> — 大部分HRV指標都偏低，通常伴隨緊張mode主導。係2025年umbrella review（Translational Psychiatry, Nature）入面最強嘅HRV-精神科關聯之一。</p>
      <p><strong>躁鬱症</strong> — 輕度HRV偏低。情緒穩定嗰排可能恢復正常。比單相抑鬱更弱、更唔一致。</p>
      <p><strong>思覺失調</strong> — 放鬆系統跌得好明顯（↓↓ RMSSD、↓↓ HF）。係umbrella review入面咁多個精神科狀況之中，HRV變化最強嗰個。</p>
      <p><strong>HRV + 血糖點解要一齊睇？</strong> — HRV反映神經系統，血糖反映代謝系統，兩個系統其實互相影響。已發表研究顯示分開睇嘅話，HRV自己得~64%準確度，加埋代謝指標上到~80%（Jin et al., 2017）。</p>
      <p>顯示嘅%係貝葉斯後驗概率，隔離有人口基線俾你對比。<strong>係篩查估算，唔係臨床診斷。</strong></p>
    `,

    // References (same as English — academic citations stay in English)
    'ref.hrv_norms_berg': '<strong>van den Berg et al. (2018)</strong> — Normal values of corrected heart-rate variability in 10-second electrocardiograms for all ages. <em>Frontiers in Physiology</em>. 13,943 healthy participants, ages 11 days to 91 years. First comprehensive lifespan HRV reference ranges.',
    'ref.hrv_norms_ortega': '<strong>Ortega et al. (2024)</strong> — "The Pulse of Singapore." <em>Applied Psychophysiology & Biofeedback</em>. 2,143 healthy participants, ages 10–89. Population norms: RMSSD ≈ 42 ms, SDNN ≈ 52 ms.',
    'ref.depression_wu': '<strong>Wu et al. (2023)</strong> — Heart rate variability status at rest in adult depressed patients: a systematic review and meta-analysis. <em>Frontiers in Public Health</em>. 43 studies, 5,906 participants. SDNN g = −0.87.',
    'ref.all_transpsych': '<strong>Translational Psychiatry (2025)</strong> — Heart rate variability in mental disorders: an umbrella review. <em>Nature</em>. 21 reviews, 442 studies, 34,625 participants.',
    'ref.ppg_cajal': '<strong>Cajal et al. (2025)</strong> — Stress Response Evaluation Using Smartphone PPG for Anxiety and Depression Monitoring. <em>IEEE</em>. 79 participants. r ≥ 0.96 vs medical device.',
    'ref.ppg_liu': '<strong>Liu et al. (2020)</strong> — Happiness at Your Fingertips. <em>Telemedicine and e-Health</em>. 93 participants.',
    'ref.waveform_kaizu': '<strong>Kaizu et al. (2026)</strong> — Assessing Mental Health by Smartphone PPG-Based Digital Pulse Waveform Analysis. <em>JMIR mHealth and uHealth</em>. 127 participants.',
    'ref.suicide_khandoker': '<strong>Khandoker et al. (2017)</strong> — Suicidal Ideation and Fingertip PPG Variability. <em>Frontiers in Physiology</em>. 61 participants. 93.33% accuracy.',
    'ref.bipolar_lyu': '<strong>Lyu et al. (2025)</strong> — Wearable PPG-based Bipolar Disorder Detection. <em>CSAI 2024 (ACM)</em>. 86.5% accuracy.',
    'ref.multi_gpsychsw': '<strong>G-PsychSW (2025)</strong> — Generalizable Psychiatric Screening from Wearable. <em>IEEE BIBM</em>. 80.16% accuracy, 4-class.',
    'ref.signal_cho': '<strong>Cho et al. (2018)</strong> — Instant Automated Inference of Perceived Mental Stress through Smartphone PPG and Thermal Imaging. <em>JMIR Mental Health</em>.',
    'ref.glucose_chinchanikar': '<strong>Chinchanikar & Dale (2025)</strong> — Multimodal Non-Invasive Blood Glucose Estimation Using Fingertip Video. <em>MMEP</em>. 243 subjects. R² = 0.88.',
    'ref.glucose_raju': '<strong>Raju et al. (2022)</strong> — SmartPPG-Glucose. 93 subjects. DNN + MIC feature selection. R² = 0.96.',
    'ref.glucose_sridevi': '<strong>Sridevi et al. (2025)</strong> — Noninvasive estimation of blood glucose and HbA1c using Quantum ML. <em>Elsevier</em>. 136 subjects.',
    'ref.metabolic_wong': '<strong>Wong et al. (2026)</strong> — Depressive symptom severity and metabolic disturbances in MDD and BD. <em>Journal of Affective Disorders</em>. 28 studies, 22,897 participants.',
    'ref.multimodal_jin': '<strong>Jin et al. (2017)</strong> — Diagnosis of MDD combining HRV and serum proteomics. <em>Prog Neuro-Psychopharm Biol Psych</em>. 64%→80.1% accuracy.',

    // Reference tags (Cantonese)
    'tag.hrv_norms': 'HRV基準',
    'tag.all_disorders': '綜合回顧',
    'tag.depression': '抑鬱症',
    'tag.smartphone_ppg': '手機PPG',
    'tag.pulse_waveform': '脈搏波形',
    'tag.suicidal_ideation': '自殺風險',
    'tag.wearable_ppg': '穿戴式PPG',
    'tag.multi_disorder': '多疾病分類',
    'tag.signal_processing': '訊號處理',
    'tag.ppg_glucose': 'PPG血糖',
    'tag.metabolic': '代謝',
    'tag.multimodal': '多模態',

    // Errors
    'error.title': '出現問題',
    'error.retry': '再試一次',
    'error.no_data': '數據唔夠。請保持指尖穩定，完成全程。',
    'error.analysis_failed': '分析失敗。請保持指尖穩定，再試一次。',
    'error.camera_denied': '鏡頭權限被拒絕。請允許鏡頭存取，再試一次。',
    'error.camera_not_found': '搵唔到鏡頭。呢個app需要後置鏡頭。',
    'error.camera_in_use': '鏡頭正被其他app使用。請關閉其他app再試。',
    'error.camera_unavailable': '鏡頭無法使用',
    'error.signal_failed': '訊號處理出錯。請確保指尖完全遮蓋鏡頭同閃光燈，然後再試。',

    // Disorder descriptions
    'disorder.depression': '心跳變化大幅減少（尤其SDNN, g = −0.87），常伴隨空腹血糖偏高（SMD = 0.30）',
    'disorder.anxiety': '心跳變化輕度至中度減少，尤其放鬆相關指標（RMSSD、HF）',
    'disorder.ptsd': '心跳變化全面減少，係umbrella review入面最強嘅HRV-精神科關聯之一',
    'disorder.bipolar': '心跳變化輕度減少，情緒穩定時可能恢復正常。代謝異常（血糖同三酸甘油酯偏高）常見',
    'disorder.schizophrenia': '放鬆系統明顯減弱（↓↓ RMSSD、↓↓ HF），係umbrella review入面最強嘅發現',

    // Language switcher
    'lang.switch': 'English',
  },
};

let currentLang = 'en';

/** Detect best initial language */
function detectLang() {
  try {
    const stored = localStorage.getItem('mentaltap-lang');
    if (stored === 'en' || stored === 'zh-HK') return stored;
  } catch {}
  const browserLang = navigator.language || '';
  if (browserLang.startsWith('zh')) return 'zh-HK';
  return 'en';
}

/** Get translated string */
export function t(key) {
  return STRINGS[currentLang]?.[key] ?? STRINGS.en[key] ?? `[${key}]`;
}

/** Switch language and reload UI */
export function setLang(lang) {
  currentLang = lang;
  try { localStorage.setItem('mentaltap-lang', lang); } catch {}
}

export function getLang() {
  return currentLang;
}

/** Initialize language on load */
export function initLang() {
  currentLang = detectLang();
}
