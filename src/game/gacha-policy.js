'use strict';

const { tradeTolerance, priceMovement } = require('../shared/trade-tolerance');

function gachaPolicy({ pool, mode, tolerance }) {
  if (!pool || !['single', 'ten'].includes(mode)) throw Error('请选择有效卡池和召唤模式。');
  return { poolId: pool.id, poolName: pool.name, count: mode === 'single' ? 1 : 10, tolerance: tradeTolerance(tolerance), baselineCost: null, button: null };
}

function quoteGacha(policy, pools) {
  if (!Array.isArray(pools)) throw Error('原站卡池列表格式改变，未发送抽卡请求。');
  const live = pools.find(pool => String(pool.id) === policy.poolId);
  const button = live?.buttons?.find(button => button.count === policy.count && button.ticket === false && Number.isSafeInteger(button.cost) && button.cost > 0);
  if (!live || live.name !== policy.poolName || live.kind === 'assist' || !button || typeof button.button !== 'string' || !button.button) throw Error('卡池、模式或消耗类型已变化，请重新录入。');
  if (policy.button !== null && policy.button !== button.button) throw Error('召唤按钮已变更，已停止，请重新确认卡池。');
  const baselineCost = policy.baselineCost ?? button.cost;
  const movement = priceMovement(baselineCost, button.cost, policy.tolerance);
  if (policy.baselineCost === null) { policy.baselineCost = baselineCost; policy.button = button.button; }
  return { cost: button.cost, button: button.button, ...movement };
}

// 官方 gacha59 以业务 code=price 区分费用确认拒绝；不将模糊错误或未知结果当作重报依据。
function isGachaPriceConfirmation(reply) {
  return reply.ok === false && !reply.unknown && reply.code === 'price' && [200, 400, 409, 422].includes(reply.status);
}

module.exports = { gachaPolicy, quoteGacha, isGachaPriceConfirmation };
