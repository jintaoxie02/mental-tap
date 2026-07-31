/**
 * Pulse waveform morphological features.
 * Extracted from averaged beat template for arterial stiffness
 * and vascular health indicators linked to autonomic function.
 */

/**
 * Compute pulse waveform features from the PPG signal and detected beats.
 */
export function computeWaveformFeatures(signal, timestamps, beats) {
  if (beats.length < 5) {
    return {
      crestTime: 0, reflectionIndex: 0, augmentationIndex: 0,
      pulseAmp: 0, error: 'Insufficient beats for waveform analysis',
    };
  }

  // Build beat templates: extract signal segments around each beat
  const templates = [];
  const avgBeatLen = beats.length > 1
    ? (beats[beats.length - 1].timestamp - beats[0].timestamp) / (beats.length - 1) // avg IBI in ms
    : 60000 / 70; // assume 70 BPM → ~857ms
  const halfWindow = Math.floor((avgBeatLen / 1000) * 30 / 2); // half beat at 30fps

  for (const beat of beats) {
    const centerIdx = Math.round(beat.index);
    const start = Math.max(0, centerIdx - halfWindow);
    const end = Math.min(signal.length, centerIdx + halfWindow);
    if (end - start < halfWindow) continue;

    const segment = signal.slice(start, end);
    // Align by peak
    const peakInSeg = segment.indexOf(Math.max(...segment));
    templates.push({ segment, peakIdx: peakInSeg });
  }

  if (templates.length < 3) {
    return {
      crestTime: 0, reflectionIndex: 0, augmentationIndex: 0,
      pulseAmp: 0, error: 'Could not extract beat templates',
    };
  }

  // Average template
  const templateLen = Math.min(...templates.map(t => t.segment.length));
  const avgTemplate = new Float64Array(templateLen);
  for (let i = 0; i < templateLen; i++) {
    let sum = 0;
    for (const t of templates) {
      sum += t.segment[i];
    }
    avgTemplate[i] = sum / templates.length;
  }

  // Normalize template to [0, 1]
  const tMin = Math.min(...avgTemplate);
  const tMax = Math.max(...avgTemplate);
  const tRange = tMax - tMin;
  const normTemplate = avgTemplate.map(v => (v - tMin) / tRange);

  // Find key points
  const peakIdx = normTemplate.indexOf(Math.max(...normTemplate));
  const footIdx = findFoot(normTemplate, peakIdx);
  const dicroticIdx = findDicroticNotch(normTemplate, peakIdx);

  // Crest time: time from foot to peak (normalized by beat duration)
  const crestTime = peakIdx > footIdx ? (peakIdx - footIdx) / templateLen : 0;

  // Reflection index: amplitude at dicrotic notch / pulse amplitude
  const pulseAmp = normTemplate[peakIdx] - normTemplate[footIdx];
  const reflectionIdx = dicroticIdx > 0
    ? normTemplate[dicroticIdx] / (pulseAmp || 1)
    : 0;

  // Augmentation index: pressure augmentation relative to pulse pressure
  // (First systolic peak vs second systolic peak)
  const ai = computeAugmentationIndex(normTemplate, footIdx, peakIdx);

  return {
    crestTime: Math.round(crestTime * 1000) / 1000,
    reflectionIndex: Math.round(reflectionIdx * 1000) / 1000,
    augmentationIndex: Math.round(ai * 100) / 100,
    pulseAmp: Math.round(pulseAmp * 1000) / 1000,
    error: null,
  };
}

function findFoot(template, peakIdx) {
  // Foot is the minimum before the systolic upstroke
  let minIdx = peakIdx;
  let minVal = template[peakIdx];
  const searchStart = Math.max(0, peakIdx - Math.floor(template.length * 0.3));
  for (let i = searchStart; i < peakIdx; i++) {
    if (template[i] < minVal) {
      minVal = template[i];
      minIdx = i;
    }
  }
  return minIdx;
}

function findDicroticNotch(template, peakIdx) {
  // Dicrotic notch appears after the systolic peak, ~30-50% through the beat
  const searchStart = peakIdx + Math.floor(template.length * 0.15);
  const searchEnd = Math.min(template.length - 1, peakIdx + Math.floor(template.length * 0.55));
  if (searchStart >= searchEnd) return -1;

  // Find local minimum in the search window
  let minVal = Infinity;
  let minIdx = -1;
  for (let i = searchStart; i < searchEnd; i++) {
    if (template[i] < minVal) {
      minVal = template[i];
      minIdx = i;
    }
  }
  return minIdx;
}

function computeAugmentationIndex(template, footIdx, peakIdx) {
  // Crude AI: ratio of late systolic to early systolic amplitude
  if (peakIdx <= footIdx) return 0;

  const pulsePressure = template[peakIdx] - template[footIdx];
  if (pulsePressure <= 0) return 0;

  // Find shoulder / inflection point (second derivative zero crossing)
  const mid = Math.floor((footIdx + peakIdx) / 2);
  let shoulderIdx = mid;
  let maxCurvature = 0;
  for (let i = footIdx + 1; i < peakIdx - 1; i++) {
    const curvature = Math.abs(
      template[i + 1] - 2 * template[i] + template[i - 1]
    );
    if (curvature > maxCurvature) {
      maxCurvature = curvature;
      shoulderIdx = i;
    }
  }

  const augmentedPressure = template[shoulderIdx] - template[footIdx];
  return augmentedPressure / pulsePressure;
}
