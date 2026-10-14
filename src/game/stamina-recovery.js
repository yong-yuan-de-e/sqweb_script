'use strict';

// 道具定义及库存来自原站 economy.stItem / STAMINA_ITEM，不推测道具ID。
function recoveryPlan(account, mode = 'money') {
  if (!['money', 'items', 'items-first'].includes(mode)) throw Error('请选择艾莉丝、仅道具或道具优先的体力回复渠道。');
  let room = Math.max(0, account.limit - account.stamina);
  const refillItems = [];
  if (mode !== 'money') for (const item of [...(account.staminaItems || [])].sort((a, b) => b.gain - a.gain || a.id.localeCompare(b.id))) {
    if (!Number.isSafeInteger(item.gain) || item.gain <= 0 || !Number.isSafeInteger(item.count) || item.count <= 0) continue;
    const count = Math.min(item.count, Math.floor(room / item.gain));
    if (count) { refillItems.push({ id: item.id, name: item.name, gain: item.gain, count }); room -= count * item.gain; }
  }
  const r = account.recovery;
  const refillPurchases = mode !== 'items' && r?.gain > 0 && Number.isFinite(r.gain) && r.cost > 0 && Number.isFinite(r.cost)
    ? Math.max(0, Math.min(Math.floor(room / r.gain), r.remaining ?? Infinity, Math.floor(account.money / r.cost))) : 0;
  const refillItemCount = refillItems.reduce((sum, item) => sum + item.count, 0);
  return { recoveryMode: mode, refillItems, refillItemCount, refillPurchases, refillCount: refillItemCount + refillPurchases,
    refillTarget: account.limit - room + refillPurchases * (r?.gain || 0), refillCost: refillPurchases * (r?.cost || 0) };
}

function staminaItemBody(account, id, count) {
  const item = account.staminaItems?.find(item => item.id === id);
  if (!item || !Number.isSafeInteger(item.gain) || item.gain <= 0) throw Error('原站未提供该体力道具的回复量。');
  if (!Number.isSafeInteger(count) || count < 1) throw Error('体力道具数量应为正整数。');
  if (count > item.count) throw Error('体力道具不足。');
  if (count > Math.floor((account.limit - account.stamina) / item.gain)) throw Error('体力将超过原站持有上限，无法回复。');
  return { args: [item.id, count] };
}

module.exports = { recoveryPlan, staminaItemBody };
