'use strict';

const { powerSaveBlocker }=require('electron');
const { calculateSweep }=require('../game/sweep-plan');
const { readGameState }=require('../game/native-bridge');

class SweepTask {
  constructor({game,actions,catalog,report,artifacts}){Object.assign(this,{game,actions,catalog,report,artifacts});this.activeRun=null;this.status={active:false,phase:'idle',message:'扫荡计划按实际资源拆分，自动回复到可购买的最大体力。'};}
  publish(event){this.status={...this.status,...event};this.artifacts.log({task:'sweep-plan',...event});this.report();}
  async preview(options){const route=this.catalog.resolve(options.selection);if(!route.stages.some(s=>s.id===options.stageId))throw Error('请先选择有真实ID的关卡。');const page=await this.game.session.page();const q=await calculateSweep(page,route,options.stageId,options.totalCount,options.requestLimit||100,true);return {route:route.name,stage:q.stage.label,requested:q.requested,batchCount:q.batchCount,staminaPerRun:q.staminaPerRun,stamina:q.account.stamina,limit:q.account.limit,refillCount:q.refillCount,refillTarget:q.refillTarget,refillCost:q.refillCost,refillGain:q.account.recovery?.gain,recoveryRemaining:q.account.recovery?.remaining,resourceMax:q.resourceMax};}
  async start(options){
    if(this.activeRun||this.game.activeRun||this.game.restarting||this.actions.busyCount)throw Error('扫荡、作战或交易正在运行。');
    const route=this.catalog.resolve(options.selection);if(!route.stages.some(s=>s.id===options.stageId)||!Number.isSafeInteger(options.totalCount)||options.totalCount<1||typeof options.buyStamina!=='boolean')throw Error('扫荡计划参数无效。');
    const controller=new AbortController();this.activeRun=controller;const blocker=powerSaveBlocker.start('prevent-app-suspension');let remaining=options.totalCount,completed=0,purchases=0,commands=0,lastSent=0;
    this.publish({active:true,phase:'running',requested:remaining,completed:0,remaining,purchases:0,commands:0,message:'按实时体力与原站规则计算扫荡批次。'});
    try{
      const page=await this.game.session.page(controller.signal);await readGameState(page,undefined,true);
      while(remaining>0){
        controller.signal.throwIfAborted();let q=await calculateSweep(page,route,options.stageId,remaining,options.requestLimit||100);
        if(q.account.inBattle)throw Error('游戏进入战斗，扫荡计划停止；已确认的扫荡不重发。');
        if(!q.resourceMax)throw Error('跳过券或今日挑战次数不足，计划停止。');
        if(!q.batchCount){
          if(!options.buyStamina||!q.refillCount)throw Error('体力不足且无法继续回复，计划停止。');
          let refill=0;
          while(true){
            controller.signal.throwIfAborted();const a=await readGameState(page),r=a.recovery;
            if(!r||!Number.isFinite(r.gain)||r.gain<=0||!Number.isFinite(r.cost)||r.cost<=0||r.remaining===0||r.cost>a.money||a.stamina+r.gain>a.limit)break;
            const draft=this.actions.planDraft('stamina',{args:['11000']},'计划按最大可补体力购买一次回复');const reply=await this.actions.commit(draft.id,{refresh:false});if(!reply.ok)throw Error(reply.message);purchases++;refill++;
            const after=await readGameState(page);if(after.stamina<=a.stamina)throw Error('购买已返回成功但体力未更新，暂停后续购买，请核对游戏。');
            this.publish({purchases,message:`自动回复体力${refill}次，按持有上限/余额/每日次数补至最大可购买值。`});
          }
          if(!refill)throw Error('体力无法回复，计划停止。');const account=await readGameState(page,route);account.routeId=route.id;this.actions.publish({account});continue;
        }
        const wait=Math.max(0,400-(Date.now()-lastSent));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));controller.signal.throwIfAborted();
        const draft=this.actions.planDraft('sweep',{args:[options.stageId,q.batchCount]},`${q.stage.label}计划扫荡${q.batchCount}次`);lastSent=Date.now();
        const reply=await this.actions.commit(draft.id,{refresh:false});commands++;if(!reply.ok)throw Error(reply.message);completed+=q.batchCount;remaining-=q.batchCount;
        this.publish({completed,remaining,purchases,commands,lastRequestAt:reply.sentAt,message:`已扫荡${completed}/${options.totalCount}次，本条${q.batchCount}次；单条按原站资源取最大值。`});
        const account=await readGameState(page,route);account.routeId=route.id;this.actions.publish({account});
      }
      this.publish({phase:'completed',message:`扫荡计划完成：${completed}次，${commands}条扫荡命令，购买体力回复${purchases}次。`});
    }catch(e){this.publish({phase:controller.signal.aborted?'stopped':'error',message:controller.signal.aborted?'已停止后续扫荡，已提交请求不撤销或重发。':String(e.message).split('\n')[0],completed,remaining,purchases,commands});}
    finally{this.activeRun=null;powerSaveBlocker.stop(blocker);this.publish({active:false});await this.actions.refresh(undefined,true).catch(()=>{});}
    return {phase:this.status.phase,message:this.status.message};
  }
  stop(){this.activeRun?.abort();}dispose(){this.stop();}
}

module.exports={SweepTask};
