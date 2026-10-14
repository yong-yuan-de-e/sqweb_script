'use strict';

function sweepGoal(options) {
  const goalMode = options.goalMode || 'count', requestLimit = options.requestLimit ?? 100, intervalMs = options.intervalMs === undefined ? 400 : options.intervalMs;
  const recoveryMode = options.recoveryMode === undefined ? 'money' : options.recoveryMode;
  if (!['money', 'items', 'items-first'].includes(recoveryMode)) throw Error('请选择有效的体力回复渠道。');
  if (!['count', 'tickets'].includes(goalMode) || !Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 100) throw Error('请选择次数或券预算目标，单条命令为1至100次。');
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) throw Error('扫荡请求间隔应为0至60,000毫秒的整数。');
  const target = goalMode === 'tickets' ? options.ticketBudget : options.totalCount;
  if (!Number.isSafeInteger(target) || target < 1) throw Error(goalMode === 'tickets' ? '券预算应为正整数。' : '扫荡总次数应为正整数。');
  return { goalMode, ...(goalMode === 'tickets' ? { ticketBudget: target } : { totalCount: target }), requestLimit, intervalMs, recoveryMode };
}

// 原站 mainHardTicket.t 的等差数列形式；每次读取时用原函数的实际结果校验。
// BigInt 避免大目标估算溢出或为了求和在游戏页面进行超长循环。
function ticketTotal(count, used = null) {
  if (!Number.isSafeInteger(count) || count < 0 || (used !== null && (!Number.isSafeInteger(used) || used < 0))) throw Error('原站扫荡费用参数异常。');
  if (used === null) return count;
  const n = BigInt(count), u = BigInt(used), first = u >= 3n ? 1n : 4n - u;
  const terms = n >= first ? n - first + 1n : 0n;
  const result = n + terms * (2n * u + first + n - 6n) / 2n;
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Infinity;
}

function maxAffordable(cost, budget, upper = Number.MAX_SAFE_INTEGER) {
  let low = 0, high = Math.max(0, Math.floor(upper));
  while (low < high) { const n = low + Math.ceil((high - low) / 2); if (cost(n) <= budget) low = n; else high = n - 1; }
  return low;
}

module.exports = { sweepGoal, ticketTotal, maxAffordable };
