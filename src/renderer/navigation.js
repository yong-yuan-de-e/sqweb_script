'use strict';

(() => {
  const titles = { market: '行情采集', battle: '作战', gacha: '自动召唤', maps: '录入', plans: '计划', trading: '炒股看板' };
  let current = 'market';
  const show = page => {
    if (!Object.hasOwn(titles, page)) page = 'market';
    current = page;
    for (const panel of document.querySelectorAll('[data-page]')) panel.hidden = panel.dataset.page !== page;
    for (const button of document.querySelectorAll('[data-view]')) {
      if (button.dataset.view === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    document.getElementById('page-title').textContent = titles[page];
    try { sessionStorage.setItem('sqweb-page', page); } catch {}
    window.dispatchEvent(new Event('assistant-view-changed'));
  };
  window.assistantView = { current: () => current, show };
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => show(button.dataset.view));
  let saved;
  try { saved = sessionStorage.getItem('sqweb-page'); } catch {}
  show(saved || new URLSearchParams(location.search).get('page') || 'market');
})();
