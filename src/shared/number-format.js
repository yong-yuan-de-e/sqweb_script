'use strict';

// 只格式化展示文本，不修改API、CSV、ID或数值输入框。
function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return String(value).replace(/^(-?\d+)(\.\d+)?$/, (_all, whole, fraction = '') => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fraction);
}
if (typeof module !== 'undefined' && module.exports) module.exports = { formatNumber };
else window.formatNumber = formatNumber;
