'use strict';

// 移动原有控件节点，保留其ID、事件和状态；一屏优先展示报价与操作。
(() => {
  if (document.body.dataset.compact === 'true') { tablePanels(); return; }
  document.body.dataset.compact = 'true';
  const $ = id => document.getElementById(id);
  const group = (className, nodes, parent, before = null) => {
    const box = document.createElement('div'); box.className = className;
    parent.insertBefore(box, before); nodes.forEach(node => { if (node) box.append(node); }); return box;
  };
  const fold = (title, nodes, parent) => {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = title;
    details.append(summary); nodes.forEach(node => { if (node) details.append(node); }); parent.append(details); return details;
  };
  const footer = document.querySelector('.main-footer');
  footer.prepend(document.querySelector('.account-strip'));
  footer.insertBefore($('action-status'), footer.querySelector('details'));
  footer.insertBefore($('unknown-actions'), footer.querySelector('details'));
  const help = footer.querySelector('details'); help.querySelector('summary').textContent = '运行记录 / 网络 / 说明';
  help.append($('network-mode'), footer.querySelector(':scope > p.hint:not(#action-status)'));

  const trading = $('page-trading');
  trading.append(document.querySelector('.wallet-card'));
  const withdraw = $('spot-withdraw'); document.querySelector('.wallet-card').append(withdraw); withdraw.textContent = '提取';
  const exchangeNote = $('exchange-note'); fold('展示范围与游戏限制', [exchangeNote], trading);
  for (const kind of ['spot', 'futures']) {
    const panel = $(`trade-${kind}-panel`), chart = $(`${kind}-chart`).closest('.chart-card');
    const operation = $(kind === 'spot' ? 'spot-qty' : 'futures-margin').closest('.operation-card');
    const work = group('trading-workspace', [chart, operation], panel, chart);
    panel.insertBefore($(`${kind}-quotes`), work);
    chart.classList.add('compact-chart');
    const tables = [...panel.querySelectorAll(':scope > .route')];
    group('trading-tables', tables, panel);
    for (const table of tables) table.classList.add('compact-table');
  }
  const spotForm = $('spot-qty').closest('.operation-card');
  const spotLabel = spotForm.querySelector('label');
  group('form-row', [spotLabel, $('spot-qty')], spotForm, spotLabel);
  const futuresForm = $('futures-margin').closest('.operation-card');
  const labels = [...futuresForm.querySelectorAll(':scope > label')];
  group('form-row futures-inputs', [labels[0], $('futures-margin'), labels[1], $('futures-leverage')], futuresForm, labels[0]);
  futuresForm.querySelector('strong').textContent = '期货交易';
  $('futures-close').textContent = '平仓';
  const extra = $('futures-add').closest('.market-actions'); extra.classList.add('position-actions');
  extra.querySelector('label').textContent = '追加';

  const route = $('map-route').closest('.route');
  route.classList.add('map-navigation');
  route.querySelector('strong').textContent = '入口与关卡扫描';
  fold('配置与流程文件路径', [$('map-file'), $('map-workflow-file')], route);
  tablePanels();

  function tablePanels() {
    for (const kind of ['spot', 'futures']) {
      const panel = document.getElementById(`trade-${kind}-panel`), box = panel.querySelector('.trading-tables');
      if (!box || box.parentElement.tagName === 'DETAILS') continue;
      const details = document.createElement('details'), summary = document.createElement('summary');
      details.className = 'table-details'; summary.textContent = kind === 'spot' ? '订单与成交记录' : '我的仓位 / 历史结算';
      details.open = innerHeight >= 650; panel.insertBefore(details, box); details.append(summary, box);
    }
    if (document.body.dataset.compactTables === 'true') return;
    document.body.dataset.compactTables = 'true'; let short = innerHeight < 650;
    const responsive = () => { const next = innerHeight < 650; if (next === short) return; short = next; for (const details of document.querySelectorAll('.table-details')) details.open = !short; };
    window.addEventListener('resize', responsive); window.addEventListener('assistant-view-changed', responsive);
  }
})();
