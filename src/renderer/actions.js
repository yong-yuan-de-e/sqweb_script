'use strict';

(() => {
  const $ = id => document.getElementById(id), dialog = $('action-confirm'); let draft = null, pending = false, stageSignature, positionsSignature, spotReason;
  const messageId = kind => ['sweep', 'stamina', 'stamina-item'].includes(kind) ? 'sweep-message' : ['futures', 'close', 'add'].includes(kind) ? 'futures-action-message' : 'spot-action-message';
  async function prepare(options) {
    if (pending) return;
    pending = true;
    try { const market=options.kind==='spot'?'spot':['futures','close'].includes(options.kind)?'futures':null;if(market)options={...options,tolerance:window.tradeSettings.read(market)};const result = await window.assistant.command('prepare-action', options); draft = { ...result, kind: options.kind }; $('action-confirm-text').textContent = result.description; dialog.showModal(); }
    catch (error) { $(messageId(options.kind)).textContent = error.message; }
    finally { pending = false; }
  }
  for (const side of ['buy', 'sell']) $(`spot-${side}`).addEventListener('click', () => prepare({ kind: 'spot', side, qty: Number($('spot-qty').value) }));
  $('spot-withdraw').addEventListener('click', () => prepare({ kind: 'withdraw' }));
  for (const side of ['long', 'short']) $(`futures-${side}`).addEventListener('click', () => prepare({ kind: 'futures', side, margin: Number($('futures-margin').value), leverage: Number($('futures-leverage').value) }));
  $('futures-close').addEventListener('click', () => prepare({ kind: 'close', positionId: $('futures-position').value }));
  $('futures-add').addEventListener('click', () => prepare({ kind: 'add', positionId: $('futures-position').value, amount: Number($('futures-add-amount').value) }));
  $('sweep-prepare').addEventListener('click', async () => {
    if(pending)return;pending=true;
    try{const options={...window.sweepView.options('sweep'),selection:window.combatView.selection(),stageId:$('sweep-stage').value},q=await window.assistant.command('preview-sweep-plan',options);
      draft={kind:'sweep',sweepOptions:options,expiresAt:Date.now()+60000};$('action-confirm-text').textContent=`${q.route} / ${q.stage}\n${window.sweepView.summary(q)}\n${options.buyStamina?window.sweepView.refill(q):'体力不足时停止，不购买体力。'}\n执行中逐批核价；券预算不足下一场时停止，不超预算。`;dialog.showModal();
    }catch(e){$('sweep-message').textContent=e.message;}finally{pending=false;}
  });
  $('buy-stamina').addEventListener('click', () => window.staminaView.open());
  $('action-confirm-cancel').addEventListener('click', () => { draft = null; dialog.close(); });
  dialog.addEventListener('cancel', () => { draft = null; });
  $('action-confirm-submit').addEventListener('click', async () => {
    if (!draft || pending) return;
    const current = draft; draft = null; pending = true; dialog.close();
    try { if(current.sweepOptions&&current.expiresAt<Date.now())throw Error('扫荡预览已过期，请重新确认。');const result = await window.assistant.command(current.sweepOptions?'run-sweep':'commit-action', current.sweepOptions||{ id: current.id }); $(messageId(current.kind)).textContent = result.message; }
    catch (error) { $(messageId(current.kind)).textContent = error.message; }
    finally { pending = false; }
  });
  for (const id of ['refresh-account']) $(id).addEventListener('click', async () => {
    try { await window.assistant.command('refresh-game-stats'); }
    catch (error) { $('sweep-message').textContent = error.message; $('game-account').textContent = error.message; }
  });
  $('battle-route').addEventListener('change', () => { stageSignature = undefined; $('sweep-stage').replaceChildren(); $('run-battle').disabled = true; $('sweep-prepare').disabled = true; });
  $('sweep-stage').addEventListener('change', () => window.assistant.command('sync-status').catch(() => {}));

  window.actionView = { prepare, update(snapshot) {
    window.tradeSettings.update(snapshot);
    window.staminaView.update(snapshot);
    const actions = snapshot.actions, account = actions?.account, busy = actions?.busy || [], unknown = actions?.unknown || [], foreground = snapshot.battle.active || snapshot.battle.restarting;
    $('game-account').textContent = account ? `体力 ${account.stamina} / ${account.maximum} · 持有上限 ${account.limit} · 艾莉丝 ${account.money.toLocaleString()} · 跳过券 ${account.tickets.toLocaleString()}${account.nextSeconds ? ` · 下次恢复 ${account.nextSeconds} 秒` : ''}` : '等待账号与体力信息…';
    if ($('maps-resources')) $('maps-resources').textContent = account ? `体力 ${account.stamina} / ${account.maximum} · 跳过券 ${account.tickets.toLocaleString()}` : '等待体力与跳过券信息';
    $('buy-stamina').title = '选择艾莉丝或体力道具，读取实际库存与可回复数量';
    for (const [domain, ids] of Object.entries({ spot: ['spot-buy', 'spot-sell', 'spot-withdraw'], futures: ['futures-long', 'futures-short', 'futures-close', 'futures-add'], sweep: ['sweep-prepare', 'buy-stamina'] })) for (const id of ids) $(id).disabled = Boolean(foreground || busy.includes(domain) || unknown.includes(domain) || !account);
    $('buy-stamina').disabled ||= Boolean(snapshot.sweep?.active || (!account?.recovery && !account?.staminaItems?.length));
    const reason = snapshot.exchange?.spot?.reason || (!account ? '等待登录与实时行情。' : '');
    for (const id of ['spot-buy', 'spot-sell']) { if (snapshot.exchange?.spot?.reason) $(id).disabled = true; $(id).title = reason; }
    if (reason !== spotReason) { spotReason = reason; $('spot-action-message').textContent = reason || '按含费均价核对涨跌接受度；明确价格确认拒绝时最多重报1次。'; }
    const routeState = actions?.routeStates?.[$('battle-route').value];
    const live = routeState?.stages || (account?.routeId === $('battle-route').value ? account?.stages || [] : []);
    const available = window.combatView?.available || [];
    const stages = available.map((s,i) => live.find(l => l.id === s.id) || {...s,id:s.id || `unmapped-${i}`,pending:true,skip:false});
    const signature = $('battle-route').value + JSON.stringify([stages,routeState?.error]);
    if (signature !== stageSignature) {
      const select = $('sweep-stage'), selected = select.value; select.replaceChildren();
      for (const stage of stages) { const option = document.createElement('option'); option.value = stage.id; option.textContent = `${stage.label}${stage.kind==='worldboss'?` · 今日剩余${stage.challengeLeft}次 · ${stage.closed?'已结束':stage.pendingBattle?'有待结算战斗':'原站挑战'}`:` · 体力 ${stage.stamina ?? '待核对'}${stage.pending ? stage.id.startsWith('unmapped-')?' · 未关联ID':routeState?.error?' · 核对失败':' · 待自动核对' : stage.locked ? ' · 未解锁' : stage.skip ? ' · 可扫荡' : ' · 可挑战'}${Number.isFinite(stage.challengeLeft)?` · 今日剩余 ${stage.challengeLeft} 次`:''}`}`; if(stage.pending)option.title=routeState?.error||'等待自动读取原站状态；未关联ID的入口需先适配。'; select.append(option); }
      if (stages.some(stage => stage.id === selected)) select.value = selected; stageSignature = signature;
    }
    const selectedStage = stages.find(s => s.id === $('sweep-stage').value);
    $('run-battle').disabled = Boolean(foreground || window.combatView.verifying || snapshot.sweep?.active || busy.length || !selectedStage || selectedStage.pending || selectedStage.manualBattle || selectedStage.locked || selectedStage.challengeLeft === 0);
    $('open-selected-entry').disabled=Boolean(foreground||snapshot.sweep?.active||busy.length);
    $('sweep-prepare').disabled ||= Boolean(window.combatView.verifying || snapshot.sweep?.active || !selectedStage || !selectedStage.skip || selectedStage.locked || selectedStage.challengeLeft===0);
    const positions = snapshot.exchange?.futures?.positions?.filter(position => position.status === 'open') || [], posSignature = JSON.stringify(positions);
    if (posSignature !== positionsSignature) { const select = $('futures-position'), chosen = select.value; select.replaceChildren(); for (const position of positions) { const option = document.createElement('option'); option.value = position.id; option.textContent = `${position.id} · ${position.side === 'long' ? '多头' : '空头'} · 开仓 ${window.formatNumber(position.entry)} · 保证金 ${window.formatNumber(position.margin)}`; select.append(option); } if (positions.some(position => position.id === chosen)) select.value = chosen; positionsSignature = posSignature; }
    $('action-status').textContent = (actions?.message || '').split('\n')[0];
    const acknowledgements = $('unknown-actions');
    if (acknowledgements.dataset.value !== unknown.join(',')) { acknowledgements.replaceChildren(); for (const domain of unknown) { const button = document.createElement('button'); button.textContent = `已手动核对${domain}结果，解除暂停`; button.addEventListener('click', () => window.assistant.command('acknowledge-action', { domain }).catch(error => { $('action-status').textContent = error.message; })); acknowledgements.append(button); } acknowledgements.dataset.value = unknown.join(','); }
    if (!account && draft) { draft = null; dialog.close(); }
  } };
})();
