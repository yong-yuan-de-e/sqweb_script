'use strict';

const labels = { idle: '待执行', loading: '加载中', running: '运行中', completed: '已完成', stopped: '已停止', error: '需要处理', waiting_update: '等待服务器更新', waiting_login: '等待登录会话', waiting_network: '等待网络恢复', waiting_battle: '等待战斗结束', waiting_data: '等待有效字段', waiting_storage: '等待保存恢复' };
const lastMessage = { market: '', battle: '', gacha: '' };
document.getElementById('new-controller').addEventListener('click', () => window.assistant.command('new-controller', { page: window.assistantView.current() }).catch(error => { document.getElementById('network-mode').textContent = error.message; }));
document.getElementById('exit-assistant').addEventListener('click', () => window.assistant.command('exit-assistant'));
document.getElementById('map-workflow').addEventListener('click', async () => {
  try { await window.assistant.command('map-workflow', { routeId: document.getElementById('map-route').value }); }
  catch (error) { document.getElementById('map-message').textContent = error.message; }
});
for (const action of ['open-battle', 'restart-game', 'collect-market', 'stop-market', 'stop-battle', 'stop-gacha', 'choose-directory', 'data', 'logs', 'stop-map-scan', 'map-config', 'map-data', 'reload-map-routes', 'inspect-map-buttons']) {
  document.getElementById(action).addEventListener('click', async () => {
    try { await window.assistant.command(action); }
    catch (error) { document.getElementById(action.includes('map') ? 'map-message' : ['run-battle', 'open-battle', 'restart-game', 'stop-battle'].includes(action) ? 'battle-message' : action === 'stop-gacha' ? 'gacha-message' : 'market-message').textContent = error.message; }
  });
}
document.getElementById('run-battle').addEventListener('click', () => window.assistant.command('run-battle', { selection: window.combatView.selection(), stageId: document.getElementById('sweep-stage').value, autoNext:document.getElementById('auto-next').checked, limit:Number(document.getElementById('campaign-limit').value) }).catch(e => { document.getElementById('battle-message').textContent = e.message; }));
for (const action of ['scan-map', 'scan-current']) {
  document.getElementById(action).addEventListener('click', async () => {
    try { await window.assistant.command('scan-map', { routeId: document.getElementById('map-route').value, currentOnly: action === 'scan-current' }); }
    catch (error) { document.getElementById('map-message').textContent = error.message; }
  });
}
let mapHash, renderedResult, renderedButtons, campaignSignature;
for (const mode of ['single', 'ten']) {
  document.getElementById(`gacha-${mode}`).addEventListener('click', async () => {
    try { await window.assistant.command('run-gacha', { mode, batches: Number(document.getElementById('gacha-batches').value), poolId: document.getElementById('gacha-pool').value, tolerance:window.tradeSettings.read('gacha') }); }
    catch (error) { document.getElementById('gacha-message').textContent = error.message; }
  });
}
window.assistant.onStatus(status => {
  window.exchangeView.update(status);
  window.recordingView.update(status);
  window.plansView.update(status);
  window.gachaRecordsView.update(status);
  window.combatView.update(status);
  const campaign= status.battle.campaignState;if(campaign&&JSON.stringify(campaign)!==campaignSignature){window.combatView.showSelection(campaign.selection);campaignSignature=JSON.stringify(campaign);}
  document.getElementById('network-mode').textContent = status.network?.proxy === 'DIRECT'
    ? '网络：程序直连，已绕过系统代理。开启 FlClash TUN 时还需为助手设置 DIRECT 规则。'
    : '游戏直连尚未确认。';
  for (const kind of ['market', 'battle']) {
    const task = status[kind];
    const otherOperation = kind === 'battle' && ['gacha', 'map-scan', 'map-inspect', 'pool-scan'].includes(task.operation);
    document.getElementById(`${kind}-phase`).textContent = otherOperation ? (task.active ? '等待前台操作结束' : '待执行') : labels[task.phase] || task.phase;
    document.getElementById(`${kind}-message`).textContent = otherOperation ? (task.active ? '当前游戏窗口正在进行召唤或录入。' : '选择地图及关卡，可作战或扫荡。') : task.message;
    document.getElementById(kind === 'market' ? 'collect-market' : 'run-battle').disabled = Boolean(task.active);
    document.getElementById(`stop-${kind}`).disabled = !task.active || (kind === 'battle' && !['battle','battle-entry'].includes(task.operation));
    if (task.message !== lastMessage[kind]) {
      const item = document.createElement('li');
      item.textContent = `${new Date().toLocaleTimeString()} [${kind === 'market' ? '行情' : task.operation === 'gacha' ? '召唤' : task.operation?.startsWith('map-') ? '地图' : '游戏'}] ${task.message}`;
      const history = document.getElementById('history');
      history.append(item);
      if (history.children.length > 80) history.firstElementChild.remove();
      history.scrollTop = history.scrollHeight;
      lastMessage[kind] = task.message;
    }
  }
  const foreground = status.battle;
  const busy = Boolean(foreground.active || foreground.restarting || status.sweep?.active || status.actions?.busy?.length);
  document.getElementById('run-battle').disabled = busy;
  document.getElementById('restart-game').disabled = busy || Boolean(status.gacha?.active);
  for (const id of ['scan-map', 'scan-current', 'map-route']) document.getElementById(id).disabled = busy || !status.maps?.routes?.length;
  document.getElementById('inspect-map-buttons').disabled = busy;
  document.getElementById('stop-map-scan').disabled = !foreground.active || !foreground.operation?.startsWith('map-');
  if (foreground.operation?.startsWith('map-')) {
    document.getElementById('map-phase').textContent = labels[foreground.phase] || foreground.phase;
    document.getElementById('map-message').textContent = foreground.message;
  }
  if (status.maps) {
    document.getElementById('map-file').textContent = status.maps.file;
    if (status.maps.error) document.getElementById('map-message').textContent = `配置需要处理：${status.maps.error}`;
    const mapSignature = JSON.stringify([status.maps.hash, status.maps.routes]);
    if (mapHash !== mapSignature) {
      const select = document.getElementById('map-route'), selected = select.value;
      select.replaceChildren();
      for (const route of status.maps.routes) { const option = document.createElement('option'); option.value = route.id; option.textContent = route.name; select.append(option); }
      if (status.maps.routes.some(route => route.id === selected)) select.value = selected;
      mapHash = mapSignature;
    }
  }
  if (foreground.mapResult && renderedResult !== foreground.mapResult.scannedAt) {
    const list = document.getElementById('map-levels'); list.replaceChildren();
    for (const level of foreground.mapResult.levels) {
      const item = document.createElement('li'); item.textContent = `${level.label}${level.recommendedPower ? ` · 推荐战力 ${level.recommendedPower}` : ''}${level.visibleButton ? '' : ' · 滚动区域外'}${level.interactable ? '' : ' · 不可交互'}`; list.append(item);
    }
    renderedResult = foreground.mapResult.scannedAt;
    document.getElementById('map-workflow-file').textContent = foreground.mapResult.workflowFile || '';
  }
  if (foreground.mapButtons && renderedButtons !== foreground.mapButtons.scannedAt) {
    const list = document.getElementById('map-buttons'); list.replaceChildren();
    for (const button of foreground.mapButtons.buttons) { const item = document.createElement('li'); item.textContent = `${button.label} — ${button.path}`; list.append(item); }
    renderedButtons = foreground.mapButtons.scannedAt;
  }
  const summon = status.gacha;
  for (const id of ['gacha-single', 'gacha-ten', 'gacha-batches', 'gacha-pool']) document.getElementById(id).disabled = Boolean(summon?.active || foreground.restarting || summon?.ledger?.reserved);
  for (const id of ['battle-route', 'battle-kind', 'battle-part', 'battle-mode', 'battle-chapter', 'battle-entry', 'sweep-stage', 'refresh-stages']) document.getElementById(id).disabled = busy;
  document.getElementById('stop-gacha').disabled = !summon?.active;
  if (summon) {
    document.getElementById('gacha-phase').textContent = labels[summon.phase] || summon.phase;
    document.getElementById('gacha-message').textContent = summon.message;
    if (lastMessage.gacha !== summon.message) { const li = document.createElement('li'); li.textContent = `${new Date().toLocaleTimeString()} [召唤] ${summon.message}`; const list = document.getElementById('history'); list.append(li); if (list.children.length > 80) list.firstElementChild.remove(); lastMessage.gacha = summon.message; }
  }
  document.getElementById('choose-directory').disabled = Boolean(status.market.active);
  document.getElementById('directory').textContent = status.directory || '';
  const stats = status.market.stats;
  document.getElementById('stats').textContent = stats ? `采样 ${stats.cycles} 轮 · 现货 ${stats.spotWritten} 条 · 期货 ${stats.futuresWritten} 条 · 未变化 ${stats.unchanged} 次 · 失败 ${stats.errors} 次${stats.lastSuccessAt ? ` · 最近成功 ${new Date(stats.lastSuccessAt).toLocaleTimeString()}` : ''}` : '';
  window.actionView.update(status);
  window.sweepView.update(status);
  if(status.battle.active&&campaign)document.getElementById('sweep-stage').value=campaign.stageId;
});
window.assistant.command('sync-status').catch(() => {});
