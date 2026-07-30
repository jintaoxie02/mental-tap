/**
 * UI Controller — manages step transitions, DOM updates, and user interactions.
 */

import { getMetricStatus } from './zero-shot.js';

const STEPS = ['step-welcome', 'step-setup', 'step-recording', 'step-results', 'step-error'];

let currentStep = null;

export function showStep(name) {
  for (const id of STEPS) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  }
  const target = document.getElementById(name);
  if (target) {
    target.classList.add('active');
    currentStep = name;
  }
}

export function getCurrentStep() {
  return currentStep;
}

export function updateTimer(secondsRemaining) {
  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const minEl = document.getElementById('timer-minutes');
  const secEl = document.getElementById('timer-seconds');
  if (minEl) minEl.textContent = String(mins);
  if (secEl) secEl.textContent = String(secs).padStart(2, '0');
}

export function updateBPM(bpm) {
  const el = document.getElementById('bpm-value');
  if (el) el.textContent = bpm > 0 ? String(bpm) : '--';
}

export function updateProgress(percent) {
  const el = document.getElementById('progress-fill');
  if (el) el.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

export function renderResults(hrv, screening, age, sex) {
  // HRV metrics
  const metrics = [
    { id: 'sdnn', value: hrv.sdnn, unit: 'ms' },
    { id: 'rmssd', value: hrv.rmssd, unit: 'ms' },
    { id: 'pnn50', value: hrv.pnn50, unit: '%' },
    { id: 'lfhfRatio', value: hrv.lfhfRatio, unit: 'ratio' },
  ];

  for (const m of metrics) {
    const valEl = document.getElementById(`res-${m.id}`);
    const statusEl = document.getElementById(`res-${m.id}-status`);

    if (valEl) valEl.textContent = m.value.toFixed(1);
    if (statusEl) {
      const status = getMetricStatus(m.id, m.value, age, sex);
      statusEl.textContent = status.toUpperCase();
      statusEl.className = `metric-status ${status}`;
    }
  }

  // Screening results
  const listEl = document.getElementById('screening-results');
  if (!listEl) return;

  listEl.innerHTML = '';

  const flaggedCount = screening.results.filter(r => r.level !== 'low').length;

  if (flaggedCount === 0) {
    listEl.innerHTML = `
      <div class="screening-item">
        <span class="screening-name">No significant autonomic deviations detected</span>
        <span class="screening-confidence low">Normal</span>
      </div>
      <p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; margin-top: 8px;">
        Your HRV pattern is within normal range for your age and sex.
        This does not rule out mental health conditions — HRV is just one biomarker.
      </p>
    `;
  } else {
    for (const r of screening.results) {
      const item = document.createElement('div');
      item.className = 'screening-item';
      item.innerHTML = `
        <div>
          <span class="screening-name">${r.name}</span>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${r.description}</div>
        </div>
        <span class="screening-confidence ${r.level}">${r.level === 'high' ? '⚠ ' : ''}${r.confidence}%</span>
      `;
      listEl.appendChild(item);
    }
  }
}

export function showError(message) {
  const el = document.getElementById('error-message');
  if (el) el.textContent = message;
  showStep('step-error');
}

export function showSetupError(message) {
  const el = document.getElementById('setup-error');
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

export function setButtonEnabled(id, enabled) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = !enabled;
}

export function getAgeSex() {
  const ageEl = document.getElementById('input-age');
  const sexEl = document.getElementById('input-sex');
  return {
    age: parseInt(ageEl?.value || '30', 10),
    sex: sexEl?.value || 'female',
  };
}
