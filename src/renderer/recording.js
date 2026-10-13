'use strict';

(() => {
  const $ = id => document.getElementById(id); let version;
  $('combat-adapters').addEventListener('click',()=>window.assistant.command('combat-adapters').catch(e=>{$('map-message').textContent=e.message;}));
  for (const kind of ['maps', 'pools']) $(`record-${kind}`).addEventListener('click', () => {
    for (const item of ['maps', 'pools']) { $(`record-${item}`).setAttribute('aria-selected', String(item === kind)); $(item === 'maps' ? 'record-map-panel' : 'record-pool-panel').hidden = item !== kind; }
  });
  for (const command of ['scan-pools', 'stop-pool-scan', 'reload-pools', 'pool-data']) $(command).addEventListener('click', () => window.assistant.command(command).catch(e => { $('pool-message').textContent = e.message; }));
  window.recordingView = { update(status) {
    const busy = Boolean(status.battle.active || status.battle.restarting || status.sweep?.active || status.actions?.busy?.length);
    $('scan-pools').disabled = busy; $('stop-pool-scan').disabled = !status.battle.active || status.battle.operation !== 'pool-scan';
    const data = status.pools;
    if (status.battle.operation === 'pool-scan') $('pool-message').textContent = status.battle.message;
    else $('pool-message').textContent = data?.error || (data?.scannedAt ? `录入时间 ${new Date(data.scannedAt).toLocaleString()} · ${data.pools.length} 个卡池` : '尚未录入，扫描时不会抽卡。');
    const signature = JSON.stringify(data);
    if (version === signature) return; version = signature;
    const table = $('pool-records'); table.replaceChildren();
    for (const pool of data?.pools || []) {
      const row = document.createElement('tr');
      const fee = count => { const b = pool.buttons.find(b => b.count === count); return b ? `${b.cost.toLocaleString()} ${b.currency}` : '未提供'; };
      for (const value of [pool.name, `${pool.kind || '召唤'} · ${pool.schedule || '未提供'}`, fee(1), fee(10), pool.automatic ? '可用' : '仅录入']) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
      table.append(row);
    }
    const selectable = (data?.pools || []).filter(p => p.automatic);
    if (!selectable.some(p => p.id === '100001')) selectable.unshift({ id: '100001', name: '高级召唤', modes: ['single', 'ten'] });
    for (const id of ['gacha-pool', 'plan-pool']) { const select = $(id), selected = select.value; select.replaceChildren(); for (const p of selectable) { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; select.append(option); } if (selectable.some(p => p.id === selected)) select.value = selected; }
  } };
})();
