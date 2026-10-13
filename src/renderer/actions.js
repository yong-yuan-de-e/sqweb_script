'use strict';

(() => {
  const $ = id => document.getElementById(id), dialog = $('action-confirm'); let draft = null, pending = false, stageSignature, positionsSignature, spotReason;
  const messageId = kind => ['sweep', 'stamina'].includes(kind) ? 'sweep-message' : ['futures', 'close', 'add'].includes(kind) ? 'futures-action-message' : 'spot-action-message';
  async function prepare(options) {
    if (pending) return;
    pending = true;
    try { const result = await window.assistant.command('prepare-action', options); draft = { ...result, kind: options.kind }; $('action-confirm-text').textContent = result.description; dialog.showModal(); }
    catch (error) { $(messageId(options.kind)).textContent = error.message; }
    finally { pending = false; }
  }
  for (const side of ['buy', 'sell']) $(`spot-${side}`).addEventListener('click', () => prepare({ kind: 'spot', side, qty: Number($('spot-qty').value) }));
  $('spot-withdraw').addEventListener('click', () => prepare({ kind: 'withdraw' }));
  for (const side of ['long', 'short']) $(`futures-${side}`).addEventListener('click', () => prepare({ kind: 'futures', side, margin: Number($('futures-margin').value), leverage: Number($('futures-leverage').value) }));
  $('futures-close').addEventListener('click', () => prepare({ kind: 'close', positionId: $('futures-position').value }));
  $('futures-add').addEventListener('click', () => prepare({ kind: 'add', positionId: $('futures-position').value, amount: Number($('futures-add-amount').value) }));
  $('sweep-prepare').addEventListener('click', () => prepare({ kind: 'sweep', selection: window.combatView.selection(), stageId: $('sweep-stage').value, count: Number($('sweep-count').value) }));
  $('buy-stamina').addEventListener('click', () => prepare({ kind: 'stamina' }));
  $('action-confirm-cancel').addEventListener('click', () => { draft = null; dialog.close(); });
  dialog.addEventListener('cancel', () => { draft = null; });
  $('action-confirm-submit').addEventListener('click', async () => {
    if (!draft || pending) return;
    const current = draft; draft = null; pending = true; dialog.close();
    try { const result = await window.assistant.command('commit-action', { id: current.id }); $(messageId(current.kind)).textContent = result.message; }
    catch (error) { $(messageId(current.kind)).textContent = error.message; }
    finally { pending = false; }
  });
  for (const id of ['refresh-account', 'refresh-stages']) $(id).addEventListener('click', async () => {
    try { await window.assistant.command('refresh-game-stats', id === 'refresh-stages' ? { selection: window.combatView.selection() } : undefined); }
    catch (error) { $('sweep-message').textContent = error.message; $('game-account').textContent = error.message; }
  });
  $('battle-route').addEventListener('change', () => { stageSignature = undefined; $('sweep-stage').replaceChildren(); $('run-battle').disabled = true; $('sweep-prepare').disabled = true; $('sweep-message').textContent = '地图已切换，请读取此地图的实时关卡。'; });
  $('sweep-stage').addEventListener('change', () => window.assistant.command('sync-status').catch(() => {}));

  window.actionView = { update(snapshot) {
    const actions = snapshot.actions, account = actions?.account, busy = actions?.busy || [], unknown = actions?.unknown || [], foreground = snapshot.battle.active || snapshot.battle.restarting;
    $('game-account').textContent = account ? `体力 ${account.stamina} / ${account.maximum} · 持有上限 ${account.limit} · 艾莉丝 ${account.money.toLocaleString()} · 跳过券 ${account.tickets.toLocaleString()}${account.nextSeconds ? ` · 下次恢复 ${account.nextSeconds} 秒` : ''}` : '等待账号与体力信息…';
    if ($('maps-resources')) $('maps-resources').textContent = account ? `体力 ${account.stamina} / ${account.maximum} · 跳过券 ${account.tickets.toLocaleString()}` : '等待体力与跳过券信息';
    $('buy-stamina').title = account?.recovery ? `一次花费 ${account.recovery.cost.toLocaleString()} 艾莉丝，回复 ${account.recovery.gain} 体力，今日剩余 ${account.recovery.remaining ?? '不限'} 次` : '先读取原站体力回复费用';
    for (const [domain, ids] of Object.entries({ spot: ['spot-buy', 'spot-sell', 'spot-withdraw'], futures: ['futures-long', 'futures-short', 'futures-close', 'futures-add'], sweep: ['sweep-prepare', 'buy-stamina'] })) for (const id of ids) $(id).disabled = Boolean(foreground || busy.includes(domain) || unknown.includes(domain) || !account);
    $('buy-stamina').disabled ||= Boolean(snapshot.sweep?.active || !account?.recovery || account.recovery.remaining===0 || account.recovery.cost>account.money || account.stamina+account.recovery.gain>account.limit);
    const reason = snapshot.exchange?.spot?.reason || (!account ? '等待登录与实时行情。' : '');
    for (const id of ['spot-buy', 'spot-sell']) { if (snapshot.exchange?.spot?.reason) $(id).disabled = true; $(id).title = reason; }
    if (reason !== spotReason) { spotReason = reason; $('spot-action-message').textContent = reason || '按原站积分报价与手续费，保留2%价格限制。'; }
    const live = account?.routeId === $('battle-route').value ? account?.stages || [] : [];
    const available = window.combatView?.available || [];
    const stages = available.map((s,i) => live.find(l => l.id === s.id) || {...s,id:s.id || `unmapped-${i}`,pending:true,skip:false});
    const signature = $('battle-route').value + JSON.stringify(stages);
    if (signature !== stageSignature) {
      const select = $('sweep-stage'), selected = select.value; select.replaceChildren();
      for (const stage of stages) { const option = document.createElement('option'); option.value = stage.id; option.textContent = `${stage.label}${stage.kind==='worldboss'?` · 今日剩余${stage.challengeLeft}次 · 原站挑战`:` · 体力 ${stage.stamina ?? '待核对'}${stage.pending ? ' · 未核对状态' : stage.locked ? ' · 未解锁' : stage.skip ? ' · 可扫荡' : ' · 可挑战'}`}`; select.append(option); }
      if (stages.some(stage => stage.id === selected)) select.value = selected; stageSignature = signature;
    }
    const selectedStage = stages.find(s => s.id === $('sweep-stage').value);
    $('run-battle').disabled = Boolean(foreground || snapshot.sweep?.active || busy.length || !selectedStage || selectedStage.pending || selectedStage.manualBattle || selectedStage.locked || selectedStage.challengeLeft === 0);
    $('open-selected-entry').disabled=Boolean(foreground||snapshot.sweep?.active||busy.length);
    $('sweep-prepare').disabled ||= Boolean(snapshot.sweep?.active || !selectedStage || !selectedStage.skip || selectedStage.locked);
    const positions = snapshot.exchange?.futures?.positions?.filter(position => position.status === 'open') || [], posSignature = JSON.stringify(positions);
    if (posSignature !== positionsSignature) { const select = $('futures-position'), chosen = select.value; select.replaceChildren(); for (const position of positions) { const option = document.createElement('option'); option.value = position.id; option.textContent = `${position.id} · ${position.side === 'long' ? '多头' : '空头'} · 保证金 ${position.margin}`; select.append(option); } if (positions.some(position => position.id === chosen)) select.value = chosen; positionsSignature = posSignature; }
    $('action-status').textContent = (actions?.message || '').split('\n')[0];
    const acknowledgements = $('unknown-actions');
    if (acknowledgements.dataset.value !== unknown.join(',')) { acknowledgements.replaceChildren(); for (const domain of unknown) { const button = document.createElement('button'); button.textContent = `已手动核对${domain}结果，解除暂停`; button.addEventListener('click', () => window.assistant.command('acknowledge-action', { domain }).catch(error => { $('action-status').textContent = error.message; })); acknowledgements.append(button); } acknowledgements.dataset.value = unknown.join(','); }
    if (!account && draft) { draft = null; dialog.close(); }
  } };
})();
