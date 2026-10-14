'use strict';

const { readGameState, sweepPricing } = require('./native-bridge');
const { sweepGoal, ticketTotal, maxAffordable } = require('../shared/sweep-goal');
const { recoveryPlan } = require('./stamina-recovery');

async function calculateSweep(page, route, stageId, options, requestLimit = 100, sync = false) {
  const goal=sweepGoal(typeof options==='number'?{totalCount:options,requestLimit}:options);
  const account=await readGameState(page,route,sync),stage=account.stages.find(s=>s.id===stageId);
  if(!stage||!stage.skip||stage.locked)throw Error(account.stageError||'此关卡尚未三冠或前置未解放，不能扫荡。');
  const pricing=await sweepPricing(page,stageId),cost=n=>ticketTotal(n,pricing.used);
  const requested=goal.goalMode==='count'?goal.totalCount:maxAffordable(cost,goal.ticketBudget);
  const daily=Number.isFinite(pricing.challengeLeft)?Math.max(0,pricing.challengeLeft):Number.MAX_SAFE_INTEGER;
  const ticketLimit=Math.min(account.tickets,goal.goalMode==='tickets'?goal.ticketBudget:Number.MAX_SAFE_INTEGER);
  const estimatedCount=maxAffordable(cost,ticketLimit,Math.min(requested,daily)),upper=Math.min(estimatedCount,goal.requestLimit);
  const batchCount=maxAffordable(n=>pricing.stamina*n,account.stamina,upper),resourceMax=upper;
  return {account,stage,...goal,staminaPerRun:pricing.stamina,batchCount,batchTickets:pricing.costs[batchCount],resourceMax,estimatedCount,estimatedTickets:cost(estimatedCount),nextTickets:pricing.costs[1],dailyRemaining:daily===Number.MAX_SAFE_INTEGER?null:daily,
    budgetExhausted:goal.goalMode==='tickets'&&goal.ticketBudget<pricing.costs[1],limitedBy:daily<requested?'今日挑战次数':estimatedCount<requested?'持有跳过券':null,
    ...recoveryPlan(account,goal.recoveryMode),requested};
}

module.exports={calculateSweep};
