'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const fmt = value => value === null || value === undefined ? '—' : String(value).replace(/^(\-?\d+)(.*)$/, (_all, whole, rest) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest);
  const time = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
  const quoteDefs = {
    spot: [['price', '巴尼尔现价'], ['fair_price', '基本面价'], ['stock', '全服存量'], ['turnover_24h', '24小时换手'], ['price_index', '物价指数'], ['change_24h_pct', '24小时涨跌', '%']],
    futures: [['price', '当前价'], ['period_change_pct', '本期涨幅', '%'], ['long_people', '多头人数'], ['long_funds', '多头保证金'], ['short_people', '空头人数'], ['short_funds', '空头保证金']],
  };
  const quoteNodes = {};
  for (const kind of ['spot', 'futures']) for (const [field, label, suffix = ''] of quoteDefs[kind]) {
    const card = document.createElement('div'), caption = document.createElement('span'), value = document.createElement('strong');
    card.className = 'quote'; caption.textContent = label; value.textContent = '—'; card.append(caption, value); $(`${kind}-quotes`).append(card);
    quoteNodes[kind + field] = { node: value, suffix };
  }
  const charts = Object.fromEntries(['spot', 'futures'].map(kind => [kind, new window.PriceChart($(`${kind}-chart`), $(`${kind}-chart-summary`), $(`${kind}-chart-pick`))]));
  const statusLabels = { running: '采集中', waiting_login: '等待登录', waiting_update: '服务器更新中', waiting_network: '等待网络恢复', waiting_data: '等待有效字段', waiting_battle: '等待战斗结束', waiting_storage: '等待CSV恢复', stopped: '采集已停止', error: '采集需要处理', idle: '待采集' };
  const positionStatus = { open: '持仓', closed: '已平仓', liquidated: '已爆仓', settled: '已结算' };
  let selected = 'spot', state = null, versions = { spot: undefined, futures: undefined };

  function table(id, records, columns, empty) {
    const body = $(id); body.replaceChildren();
    if (!records?.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.className = 'empty'; cell.colSpan = columns.length; cell.textContent = records === null || records === undefined ? '接口尚未返回这类数据' : empty; row.append(cell); body.append(row); return; }
    for (const record of records) { const row = document.createElement('tr'); for (const column of columns) { const cell = document.createElement('td'); cell.textContent = column(record); row.append(cell); } body.append(row); }
  }

  function render(force = false) {
    if (force !== true && (window.assistantView.current() !== 'trading' || document.hidden)) return;
    const exchange = state?.exchange || {}, task = state?.market;
    const current = exchange[selected], stamp = current?.capturedAt ? Date.parse(current.capturedAt) : 0, stale = stamp && Date.now() - stamp > 25000;
    $('trading-status').textContent = `${statusLabels[task?.phase] || '等待行情'} · ${stamp ? `最近成功 ${time(stamp)}${stale ? ' · 当前显示上次有效数据' : ''}` : '等待有效行情'}`;
    for (const kind of ['spot', 'futures']) {
      const data = exchange[kind], version = data?.capturedAt ?? null;
      if (versions[kind] !== version) {
        versions[kind] = version;
        for (const [field] of quoteDefs[kind]) {
          const { node, suffix } = quoteNodes[kind + field], value = data?.values?.[field];
          node.textContent = fmt(value) + (value === null || value === undefined ? '' : suffix); node.title = value ?? '';
          node.className = field.endsWith('_pct') && value ? (Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : '') : '';
        }
        charts[kind].update(data?.chart, kind === 'futures' ? data?.openPrice ?? null : null);
        if (kind === 'spot') {
          $('wallet-money').textContent = fmt(data?.wallet?.money); $('wallet-tickets').textContent = fmt(data?.wallet?.tickets);
          $('wallet-time').textContent = data?.wallet ? `钱包更新时间 ${time(Date.parse(data.capturedAt))} · 待提取余额，区别于账号存档余额。` : '接口尚未返回交易所钱包，不能推断余额为零。';
          table('spot-orders', data?.orders, [r => time(r.at), r => r.side === 'buy' ? '买入' : r.side === 'sell' ? '卖出' : '未知', r => fmt(r.qty), r => fmt(r.money), r => fmt(r.avg)], '暂无成交记录');
        } else {
          const round = data?.round;
          $('futures-round').textContent = round ? `第 ${fmt(round.id)} 期 · ${round.status === 'open' ? '本期开放' : round.status || '状态未知'} · 停止开仓 ${time(round.cutoffAt)} · 结算 ${time(round.settleAt)}` : '接口尚未返回期号与结算时间。';
          table('futures-positions', data?.positions, [r => time(r.createdAt), r => `${r.side === 'long' ? '多头' : r.side === 'short' ? '空头' : '未知'} · ${positionStatus[r.status] || r.status || '未知'}`, r => fmt(r.margin), r => fmt(r.leverage) + '×', r => fmt(r.entry), r => fmt(r.liqPrice), r => fmt(r.pnl), r => fmt(r.lockedPnl), r => fmt(r.debt)], '暂无期货仓位');
          table('futures-settlements', data?.settlements, [r => fmt(r.id), r => time(r.settleAt), r => fmt(r.settlePrice), r => fmt(r.myPnl)], '暂无历史结算');
        }
      }
    }
    $('exchange-note').textContent = `展示数据仅在内存保存，会话失效时清空；CSV字段保持原样。${current?.reason ? ` 游戏状态：${current.reason}` : ''}${current?.omitted ? ` 有 ${current.omitted} 项无效或超量字段未展示。` : ''}`;
    charts[selected].draw(force === true);
  }

  function select(kind) {
    selected = kind;
    for (const item of ['spot', 'futures']) { $(`trade-${item}`).setAttribute('aria-selected', String(item === kind)); $(`trade-${item}-panel`).hidden = item !== kind; }
    render(true);
  }
  for (const kind of ['spot', 'futures']) $(`trade-${kind}`).addEventListener('click', () => select(kind));
  window.exchangeView = { update: snapshot => { state = snapshot; render(!snapshot.exchange?.spot && !snapshot.exchange?.futures); } };
  window.addEventListener('assistant-view-changed', () => render(true));
  document.addEventListener('visibilitychange', render);
  setInterval(() => { if (window.assistantView.current() === 'trading' && !document.hidden) render(); }, 10000);
})();
