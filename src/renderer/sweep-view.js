'use strict';

(() => {
  const $=id=>document.getElementById(id),fmt=window.formatNumber;
  const ids=prefix=>prefix==='plan'?{mode:'plan-goal-mode',count:'plan-total-count',tickets:'plan-ticket-budget',refill:'plan-refill',unit:'plan-goal-unit',interval:'plan-interval-ms',recovery:'plan-recovery-mode'}:{mode:'sweep-goal-mode',count:'sweep-count',tickets:'sweep-ticket-budget',refill:'sweep-refill',unit:'sweep-goal-unit',interval:'sweep-interval-ms',recovery:'sweep-recovery-mode'};
  const options=prefix=>{const i=ids(prefix),goalMode=$(i.mode).value;return {goalMode,...(goalMode==='tickets'?{ticketBudget:Number($(i.tickets).value)}:{totalCount:Number($(i.count).value)}),buyStamina:$(i.refill).checked,recoveryMode:$(i.recovery).value,requestLimit:prefix==='plan'?Number($('plan-command-limit').value):100,intervalMs:$(i.interval).value.trim()===''?NaN:Number($(i.interval).value)};};
  function bind(prefix,changed){const i=ids(prefix);const toggle=()=>{const tickets=$(i.mode).value==='tickets';$(i.count).hidden=tickets;$(i.tickets).hidden=!tickets;$(i.unit).textContent=tickets?'张券':'次';$(i.recovery).disabled=!$(i.refill).checked;changed();};$(i.mode).addEventListener('change',toggle);$(i.refill).addEventListener('change',toggle);for(const id of [i.count,i.tickets,i.interval,i.recovery])$(id).addEventListener('input',changed);toggle();}
  const summary=q=>`${q.goalMode==='tickets'?`预算 ${fmt(q.ticketBudget)} 张券`:`目标 ${fmt(q.totalCount)} 次`} → 当前预计 ${fmt(q.estimatedCount)} 次 / ${fmt(q.estimatedTickets)} 张券${q.goalMode==='tickets'?`，预算剩余 ${fmt(q.ticketBudget-q.estimatedTickets)} 张`:''}${q.limitedBy?`（受${q.limitedBy}限制）`:''}。${q.dailyRemaining!==null?`今日剩余 ${fmt(q.dailyRemaining)} 次。`:''}下一场 ${fmt(q.nextTickets)} 张券。间隔 ${fmt(q.intervalMs??400)} ms${q.intervalMs===0?'，仅等回执':''}。`;
  const recoveryLabel=mode=>({'money':'仅艾莉丝','items':'仅道具','items-first':'道具优先，之后艾莉丝'}[mode||'money']);
  const refill=q=>`体力不足时${recoveryLabel(q.recoveryMode)}，按最大可补数量回复：${fmt(q.stamina)} → ${fmt(q.refillTarget)} / ${fmt(q.limit)}；${q.refillItems?.length?q.refillItems.map(i=>`${i.name} × ${fmt(i.count)}`).join('、')+'；':''}艾莉丝购买 ${fmt(q.refillPurchases??q.refillCount)} 次，按当前价预计 ${fmt(q.refillCost)} 艾莉丝。道具先大后小、同类批量使用，购买逐次核价；库存、余额或次数不足时停止。`;
  let state,key,timer,generation=0,inFlight=false,lastMessage;
  function schedule(){generation++;clearTimeout(timer);$('sweep-estimate').textContent=state?.sweep?.active?'扫荡运行中，结束后更新剩余资源估算。':'正在按当前关卡和目标核算券耗…';timer=setTimeout(()=>preview().catch(()=>{}),300);}
  async function preview(){
    if(!state||window.assistantView.current()!=='battle')return;
    if(inFlight){timer=setTimeout(()=>preview().catch(()=>{}),350);return;}
    if(state.battle.active||state.battle.restarting||state.sweep?.active||state.actions?.busy?.length||window.combatView?.verifying){$('sweep-estimate').textContent='任务或核对运行中，空闲后自动更新估算。';return;}
    const routeState=state.actions?.routeStates?.[$('battle-route').value],stage=routeState?.stages?.find(s=>s.id===$('sweep-stage').value);
    if(routeState?.error){$('sweep-estimate').textContent=routeState.error;return;}
    if(!stage){$('sweep-estimate').textContent='等待自动核对关卡；未关联真实ID的活动需先适配。';return;}
    if(stage.kind==='worldboss'){$('sweep-estimate').textContent='世界Boss已核对次数，请使用“打开所选入口”在原站挑战；不支持普通扫荡。';return;}
    if(!stage.skip||stage.locked){$('sweep-estimate').textContent=stage.locked?'当前关卡尚未解锁。':'原站尚未允许此关卡扫荡；可挑战的关卡可使用左侧作战。';return;}
    const current=generation;inFlight=true;
    try{const q=await window.assistant.command('preview-sweep-plan',{...options('sweep'),selection:window.combatView.selection(),stageId:$('sweep-stage').value});if(current===generation)$('sweep-estimate').textContent=summary(q);}
    catch(e){if(current===generation)$('sweep-estimate').textContent=e.message;}
    finally{inFlight=false;}
  }
  bind('sweep',schedule);$('sweep-stage').addEventListener('change',schedule);
  $('stop-sweep').addEventListener('click',()=>window.assistant.command('stop-sweep-plan').catch(e=>{$('sweep-message').textContent=e.message;}));
  window.addEventListener('assistant-view-changed',schedule);
  window.sweepView={options,bind,summary,refill,recoveryLabel,update(status){state=status;$('stop-sweep').disabled=!status.sweep?.active;
    const next=JSON.stringify([$('battle-route').value,$('sweep-stage').value,status.actions?.routeStates?.[$('battle-route').value],status.actions?.account?.tickets,status.actions?.account?.stamina,status.actions?.account?.staminaItems,status.actions?.account?.recovery,status.actions?.account?.money,status.battle.active,status.battle.restarting,status.actions?.busy,status.sweep?.active,window.combatView?.verifying]);
    if(next!==key){key=next;schedule();}
    if(status.sweep?.message!==lastMessage){lastMessage=status.sweep?.message;if(status.sweep?.phase!=='idle')$('sweep-message').textContent=lastMessage;}
  }};
})();
