/**
 * Walks the DOM and applies translations to elements with data-i18n attributes.
 * Called on page load and on language switch.
 */

import { t } from './i18n.js';

export function translatePage() {
  // Text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    // Preserve <br> tags in footnote
    if (key === 'hero.footnote') {
      el.innerHTML = t(key).replace(/\n/g, '<br>');
      return;
    }
    el.textContent = t(key);
  });

  // HTML content (explainers, references)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    el.innerHTML = t(key);
  });

  // Tooltips
  document.querySelectorAll('[data-i18n-tip]').forEach(el => {
    const key = el.getAttribute('data-i18n-tip');
    el.setAttribute('data-tip', t(key));
  });

  // Disclaimer uses innerHTML — translations carry their own formatting
  const disc = document.querySelector('.disclaimer');
  if (disc) disc.innerHTML = t('results.disclaimer');
}
