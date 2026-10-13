'use strict';

const { readGameState, sweepCost } = require('./native-bridge');

async function calculateSweep(page, route, stageId, remaining, requestLimit = 100, sync = false) {
  if(!Number.isSafeInteger(remaining)||remaining<1||!Number.isInteger(requestLimit)||requestLimit<1||requestLimit>100)throw Error('扫荡总次数应为正整数，单条命令上限1至100。');
  const account=await readGameState(page,route,sync),stage=account.stages.find(s=>s.id===stageId);
  if(!stage||!stage.skip||stage.locked)throw Error(account.stageError||'此关卡尚未三冠或前置未解放，不能扫荡。');
  const one=await sweepCost(page,stageId,1),upper=Math.min(remaining,requestLimit,Number.isFinite(one.challengeLeft)?one.challengeLeft:requestLimit);
  const affordable=async ignoreStamina=>{let low=0,high=upper;while(low<high){const n=Math.ceil((low+high)/2),cost=await sweepCost(page,stageId,n);if(cost.tickets<=account.tickets&&(ignoreStamina||cost.stamina*n<=account.stamina))low=n;else high=n-1;}return low;};
  const batchCount=await affordable(false),resourceMax=await affordable(true),recovery=account.recovery;
  const refillCount=recovery?.gain>0&&recovery.cost>0?Math.max(0,Math.min(Math.floor((account.limit-account.stamina)/recovery.gain),recovery.remaining??Infinity,Math.floor(account.money/recovery.cost))):0;
  return {account,stage,staminaPerRun:one.stamina,batchCount,resourceMax,refillCount,refillTarget:account.stamina+refillCount*(recovery?.gain||0),refillCost:refillCount*(recovery?.cost||0),requested:remaining,requestLimit};
}

module.exports={calculateSweep};
