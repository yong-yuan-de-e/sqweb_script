'use strict';

const { powerSaveBlocker }=require('electron');
const { calculateSweep }=require('../game/sweep-plan');
const { readGameState }=require('../game/native-bridge');
const { sweepGoal }=require('../shared/sweep-goal');
const { waitRequestInterval }=require('../game/request-delay');
const { recoveryPlan, staminaItemBody }=require('../game/stamina-recovery');
const fmt=n=>n.toLocaleString('en-US');

class SweepTask {
  constructor({game,actions,catalog,report,artifacts}){Object.assign(this,{game,actions,catalog,report,artifacts});this.activeRun=null;this.status={active:false,phase:'idle',message:'支持次数或券预算目标；体力不足时按所选渠道补充，支持道具回复。'};}
  publish(event){this.status={...this.status,...event};this.artifacts.log({task:'sweep-plan',...event});this.report();}
  target(options){const goal=sweepGoal(options),route=this.catalog.resolve(options.selection);if(!route.stages.some(s=>s.id===options.stageId)||typeof options.buyStamina!=='boolean')throw Error('请选择真实关卡及体力回复选项。');return {route,goal};}
  async preview(options){
    if(this.game.activeRun||this.game.restarting||this.activeRun||this.actions.busyCount)throw Error('任务运行中，空闲后自动更新估算。');
    const {route,goal}=this.target(options),page=await this.game.session.page(),q=await calculateSweep(page,route,options.stageId,goal,100,true);
    return {route:route.name,stage:q.stage.label,...goal,estimatedCount:q.estimatedCount,estimatedTickets:q.estimatedTickets,nextTickets:q.nextTickets,limitedBy:q.limitedBy,dailyRemaining:q.dailyRemaining,batchCount:q.batchCount,batchTickets:q.batchTickets,staminaPerRun:q.staminaPerRun,stamina:q.account.stamina,limit:q.account.limit,refillCount:q.refillCount,refillTarget:q.refillTarget,refillCost:q.refillCost,refillItems:q.refillItems,refillPurchases:q.refillPurchases,refillItemCount:q.refillItemCount,resourceMax:q.resourceMax};
  }
  async start(options){
    if(this.activeRun||this.game.activeRun||this.game.restarting||this.actions.busyCount||this.actions.status.unknown.includes('sweep'))throw Error('扫荡、作战或交易正在运行，或存在未确认扫荡。');
    const {route,goal}=this.target(options),controller=new AbortController();this.activeRun=controller;
    const blocker=powerSaveBlocker.start('prevent-app-suspension');let completed=0,spentTickets=0,purchases=0,itemsUsed=0,commands=0,lastSent=-Infinity,stopReason='';
    const remainingGoal=()=>goal.goalMode==='tickets'?{...goal,ticketBudget:goal.ticketBudget-spentTickets}:{...goal,totalCount:goal.totalCount-completed};
    const done=()=>goal.goalMode==='tickets'?spentTickets>=goal.ticketBudget:completed>=goal.totalCount;
    const progress=()=>({completed,spentTickets,purchases,itemsUsed,commands,remaining:goal.goalMode==='tickets'?goal.ticketBudget-spentTickets:goal.totalCount-completed});
    this.publish({active:true,phase:'running',...goal,...progress(),message:`扫荡请求间隔 ${fmt(goal.intervalMs)} 毫秒${goal.intervalMs===0?'，仅等待回执及资源核对':''}；按原站实时费用计算最大批次。`});
    try{
      const page=await this.game.session.page(controller.signal);await readGameState(page,undefined,true);
      while(!done()){
        controller.signal.throwIfAborted();
        await waitRequestInterval(goal.intervalMs,lastSent,controller.signal);
        const q=await calculateSweep(page,route,options.stageId,remainingGoal());
        if(q.account.inBattle)throw Error('游戏进入战斗，扫荡停止；已确认的请求不重发。');
        if(q.budgetExhausted){stopReason=`剩余预算 ${fmt(goal.ticketBudget-spentTickets)} 张，不足支付下一场 ${fmt(q.nextTickets)} 张`;break;}
        if(!q.resourceMax)throw Error(q.dailyRemaining===0?'今日挑战次数已用完，扫荡停止。':'持有跳过券不足，扫荡停止。');
        if(!q.batchCount){
          if(!options.buyStamina||!q.refillCount)throw Error('体力不足且无法继续回复，扫荡停止。');
          let refill=0;
          while(true){
            controller.signal.throwIfAborted();const a=await readGameState(page),plan=recoveryPlan(a,goal.recoveryMode),item=plan.refillItems[0];
            if(a.inBattle)throw Error('游戏进入战斗，已停止后续体力回复。');
            if(!plan.refillCount)break;
            const gain=item?item.gain*item.count:a.recovery.gain;
            const draft=this.actions.planDraft(item?'stamina-item':'stamina',item?staminaItemBody(a,item.id,item.count):{args:['11000']},item?`使用${item.name} × ${fmt(item.count)} 回复体力`:'按最大可补体力购买一次回复');
            const reply=await this.actions.commit(draft.id,{refresh:false});if(!reply.ok)throw Error(reply.message);
            if(item)itemsUsed+=item.count;else purchases++;refill++;
            const after=await readGameState(page);
            if(after.stamina<a.stamina+gain || (item&&a.staminaItems.find(i=>i.id===item.id).count-after.staminaItems.find(i=>i.id===item.id)?.count!==item.count))throw Error('回复已确认，但体力或道具库存变化与报价不一致，已停止后续请求，请核对游戏。');
            this.actions.publish({account:after});
            this.publish({...progress(),message:`本轮已提交 ${refill} 次回复，累计使用道具 ${fmt(itemsUsed)} 个、艾莉丝购买 ${fmt(purchases)} 次，按所选渠道补至可回复的最大值。`});
          }
          if(!refill)throw Error('体力无法回复，扫荡停止。');this.actions.publish({account:await readGameState(page,route)});continue;
        }
        const draft=this.actions.planDraft('sweep',{args:[options.stageId,q.batchCount]},`${q.stage.label}扫荡${q.batchCount}次，预计${q.batchTickets}张券`);lastSent=performance.now();
        const reply=await this.actions.commit(draft.id,{refresh:false});commands++;if(!reply.ok)throw Error(reply.message);completed+=q.batchCount;
        // POST 已确认即记入报价；存档核对失败时停止，避免重发已完成的批次。
        spentTickets+=q.batchTickets;
        const account=await readGameState(page,route),actual=q.account.tickets-account.tickets;this.actions.publish({account});
        if(!Number.isSafeInteger(actual)||actual!==q.batchTickets){
          if(Number.isSafeInteger(actual)&&actual>=0)spentTickets+=actual-q.batchTickets;
          throw Error(`扫荡已确认，但券余额变化 ${fmt(actual)} 与报价 ${fmt(q.batchTickets)} 不一致；停止后续请求，请核对游戏及其他交易。`);
        }
        this.publish({...progress(),lastRequestAt:reply.sentAt,message:`已扫荡 ${fmt(completed)} 次，消耗 ${fmt(spentTickets)} 张券${goal.goalMode==='tickets'?` / 预算 ${fmt(goal.ticketBudget)}`:` / 目标 ${fmt(goal.totalCount)} 次`}。`});
      }
      this.publish({phase:'completed',...progress(),message:`扫荡完成：${fmt(completed)} 次，消耗 ${fmt(spentTickets)} 张券，${commands} 条命令，使用体力道具 ${fmt(itemsUsed)} 个、购买体力 ${purchases} 次。${stopReason?stopReason+'，已停止。':''}`});
    }catch(e){this.publish({phase:controller.signal.aborted?'stopped':'error',...progress(),message:`${controller.signal.aborted?'已停止后续请求，已提交请求不重发。':String(e.message).split('\n')[0]} 已确认 ${fmt(completed)} 次 / ${fmt(spentTickets)} 张券，使用体力道具 ${fmt(itemsUsed)} 个、购买体力 ${purchases} 次。`});}
    finally{this.activeRun=null;powerSaveBlocker.stop(blocker);this.publish({active:false});await this.actions.refresh(undefined,true).catch(()=>{});}
    return {phase:this.status.phase,message:this.status.message,...progress()};
  }
  stop(){this.activeRun?.abort();}dispose(){this.stop();}
}

module.exports={SweepTask};
