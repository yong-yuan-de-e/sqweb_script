'use strict';

(() => {
  const $ = id => document.getElementById(id), stateNames = { pending: '待执行', running: '执行中', completed: '已完成', failed: '已停止', missed: '未执行', cancelled: '已取消', needs_review: '需核对' }; let version, submitting = false, sweepTarget,previewTimer,previewGeneration=0;
  const localInput = timestamp => { const d = new Date(timestamp), pad = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fillNext = async () => { const clock = await window.assistant.command('plan-clock'); $('plan-at').value = localInput(clock.nextMinute); };
  $('plan-next-minute').addEventListener('click', () => fillNext().catch(e => { $('plan-message').textContent = e.message; }));
  $('plan-kind').addEventListener('change',()=>{$('plan-gacha-fields').hidden=$('plan-kind').value!=='gacha';$('plan-sweep-fields').hidden=$('plan-kind').value!=='sweep';});
  const sweepOptions=()=>({...sweepTarget,totalCount:Number($('plan-total-count').value),requestLimit:Number($('plan-command-limit').value),buyStamina:$('plan-refill').checked});
  const preview=async()=>{if(!sweepTarget)return;const current=++previewGeneration;try{const q=await window.assistant.command('preview-sweep-plan',sweepOptions());if(current!==previewGeneration)return;$('plan-sweep-preview').textContent=`总次数${q.requested} · 当前最大一条${q.batchCount}次 · 每场${q.staminaPerRun}体力。自动回复按最大可购买数量：当前预计${q.refillCount}次回复，体力${q.stamina}→${q.refillTarget}（持有上限${q.limit}），当前价格估计${q.refillCost.toLocaleString()}艾莉丝；实际逐次核价，受余额/每日次数限制。`;}catch(e){if(current===previewGeneration)$('plan-sweep-preview').textContent=e.message;}};
  $('plan-use-stage').addEventListener('click',()=>{sweepTarget={selection:window.combatView.selection(),stageId:$('sweep-stage').value};$('plan-sweep-target').textContent=$('sweep-stage').selectedOptions[0]?.textContent||'请先在作战页选择关卡';preview().catch(()=>{});});
  for(const id of ['plan-total-count','plan-command-limit'])$(id).addEventListener('input',()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>preview().catch(()=>{}),350);});
  $('stop-sweep-plan').addEventListener('click',()=>window.assistant.command('stop-sweep-plan').catch(e=>{$('plan-message').textContent=e.message;}));
  $('add-plan').addEventListener('click', async () => {
    if (submitting) return; submitting = true; $('add-plan').disabled = true;
    try { const kind=$('plan-kind').value;if(kind==='sweep'&&!sweepTarget)throw Error('请使用作战页当前关卡。');const plan = await window.assistant.command('add-plan', { kind,runAt: new Date($('plan-at').value).getTime(), ...(kind==='gacha'?{poolId: $('plan-pool').value, mode: $('plan-mode').value, batches: Number($('plan-batches').value)}:sweepOptions()) }); $('plan-message').textContent = `计划已保存：${new Date(plan.runAt).toLocaleString('zh-CN',{hour12:false})} · ${plan.kind==='gacha'?`${plan.poolName} · ${plan.mode === 'single' ? '单抽' : '十连'} ${plan.batches}批`:`${plan.routeName} ${plan.stageName} · ${plan.totalCount}次扫荡`}`; }
    catch (error) { $('plan-message').textContent = error.message; }
    finally { submitting = false; $('add-plan').disabled = false; }
  });
  const clock = () => { $('system-clock').textContent = `当前系统时间 ${new Date().toLocaleString('zh-CN',{hour12:false})} · 按执行日期与时间触发`; };
  clock(); setInterval(() => { if (window.assistantView.current() === 'plans') clock(); }, 1000);
  window.addEventListener('assistant-view-changed', () => { if (window.assistantView.current() === 'plans') { clock(); if (!$('plan-at').value) fillNext().catch(() => {}); } });
  window.plansView = { update(status) {
    const data = status.plans; if (!data) return;
    $('stop-sweep-plan').disabled=!status.sweep?.active;
    $('add-plan').disabled = submitting || Boolean(data.error); if (data.error) $('plan-message').textContent = data.error;
    const signature = JSON.stringify([data.error, data.plans]); if (version === signature) return; version = signature;
    const table = $('plan-records'); table.replaceChildren();
    for (const plan of [...data.plans].sort((a, b) => b.runAt - a.runAt)) {
      const row = document.createElement('tr');
      for (const text of [new Date(plan.runAt).toLocaleString('zh-CN',{hour12:false}), plan.kind==='sweep'?`${plan.routeName} / ${plan.stageName} · ${plan.totalCount}次`:`${plan.poolName} · ${plan.mode === 'single' ? '单抽' : '十连'} ${plan.batches}批`, stateNames[plan.state] || plan.state, plan.message?.replace(/\s*累计测试消耗 \d+ \/ \d+ 艾莉丝[。.]?/, '')]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
      const cell = document.createElement('td');
      const button = document.createElement('button'); button.textContent = plan.state === 'pending' ? '取消' : '删除记录'; button.disabled = plan.state === 'running';
      button.addEventListener('click', () => window.assistant.command(plan.state === 'pending' ? 'cancel-plan' : 'delete-plan', { id: plan.id }).catch(e => { $('plan-message').textContent = e.message; })); cell.append(button); row.append(cell); table.append(row);
    }
    if (!table.children.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.textContent = '暂无计划'; td.className = 'empty'; tr.append(td); table.append(tr); }
  } };
})();
