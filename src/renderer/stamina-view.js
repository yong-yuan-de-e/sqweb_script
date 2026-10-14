'use strict';

(() => {
  const $ = id => document.getElementById(id), dialog = $('stamina-dialog'), fmt = window.formatNumber;
  let snapshot, signature;
  function render() {
    const account = snapshot?.actions?.account, select = $('stamina-source');
    if (!account) { if (dialog.open) dialog.close(); return; }
    const next = JSON.stringify([account.recovery, account.staminaItems]);
    if (signature !== next) {
      signature = next; const selected = select.value; select.replaceChildren();
      if (account.recovery) { const option = document.createElement('option'); option.value = 'money'; option.textContent = `艾莉丝 · +${fmt(account.recovery.gain)} · ${fmt(account.recovery.cost)} / 次`; select.append(option); }
      for (const item of account.staminaItems || []) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} · +${fmt(item.gain)} · 持有 ${fmt(item.count)}`; select.append(option); }
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }
    const money = select.value === 'money', item = account.staminaItems?.find(item => item.id === select.value), gain = money ? account.recovery?.gain : item?.gain;
    const maximum = gain > 0 ? Math.max(0, Math.min(Math.floor((account.limit - account.stamina) / gain), money ? Math.min(account.recovery.remaining ?? Infinity, Math.floor(account.money / account.recovery.cost), 1) : item?.count || 0)) : 0;
    const input = $('stamina-count'); input.disabled = money; input.max = Math.max(1, maximum); if (money) input.value = 1;
    const count = Number(input.value), valid = Number.isSafeInteger(count) && count >= 1 && count <= maximum;
    $('stamina-account').textContent = `体力 ${fmt(account.stamina)} / ${fmt(account.maximum)} · 持有上限 ${fmt(account.limit)} · 艾莉丝 ${fmt(account.money)}`;
    $('stamina-preview').textContent = valid ? `体力 ${fmt(account.stamina)} → ${fmt(account.stamina + gain * count)}；${money ? `消耗 ${fmt(account.recovery.cost)} 艾莉丝，今日剩余 ${account.recovery.remaining ?? '不限'} 次。` : `使用${item.name} × ${fmt(count)}，剩余 ${fmt(item.count - count)} 个。`}` : `当前最多可使用 ${fmt(maximum)} ${money ? '次' : '个'}，请核对库存、余额与体力上限。`;
    $('stamina-read').disabled = !valid || snapshot.battle.active || snapshot.battle.restarting || snapshot.sweep?.active || snapshot.actions.busy.includes('sweep') || snapshot.actions.unknown.includes('sweep');
  }
  $('stamina-source').addEventListener('change', () => { $('stamina-count').value = 1; render(); });
  $('stamina-count').addEventListener('input', render);
  $('stamina-max').addEventListener('click', () => { $('stamina-count').value = $('stamina-count').max; render(); });
  $('stamina-cancel').addEventListener('click', () => dialog.close());
  $('stamina-read').addEventListener('click', () => {
    if ($('stamina-read').disabled) return;
    const source = $('stamina-source').value, count = Number($('stamina-count').value); dialog.close();
    window.actionView.prepare(source === 'money' ? { kind: 'stamina' } : { kind: 'stamina-item', itemId: source, count });
  });
  window.staminaView = { open() { render(); if (snapshot?.actions?.account) dialog.showModal(); }, update(state) { snapshot = state; render(); } };
})();
