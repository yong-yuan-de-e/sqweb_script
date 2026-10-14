'use strict';

const { requestNative, readGameState } = require('../game/native-bridge');
const { gachaPolicy, quoteGacha, isGachaPriceConfirmation } = require('../game/gacha-policy');
const { formatNumber: fmt } = require('../shared/number-format');

async function runGacha({ page, signal, report, ledger, pool, mode, batches = 1, tolerance }) {
  if (!['single', 'ten'].includes(mode) || !Number.isInteger(batches) || batches < 1 || batches > 100) throw Error('召唤模式或批次数无效。');
  if (ledger.snapshot().reserved) throw Error('上一笔召唤结果未确认，请先核对游戏记录。');
  const policy = gachaPolicy({ pool, mode, tolerance });
  let completed = 0, drawn = 0, costThisRun = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    signal?.throwIfAborted();
    let reply, reservation, quote, retryOf = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      signal?.throwIfAborted();
      report({ phase: 'running', message: `读取${pool.name}最新API报价（${batch + 1}/${batches}批${attempt === 2 ? '，价格确认后重报' : ''}）`, ledger: ledger.snapshot() });
      quote = quoteGacha(policy, (await requestNative(page, '/rpc/releasedGachaPools', { args: [] })).data);
      const account = await readGameState(page, undefined, true);
      if (account.money < quote.cost) throw Error('艾莉丝不足，本批未提交。');
      signal?.throwIfAborted();
      reservation = ledger.reserve({ pool: policy.poolName, count: policy.count, cost: quote.cost, baselineCost: policy.baselineCost, tolerance: policy.tolerance, attempt, retryOf });
      report({ phase: 'running', baselineCost: policy.baselineCost, tolerance: policy.tolerance, message: `第${batch + 1}/${batches}批：${policy.count}抽，费用 ${fmt(quote.cost)} 艾莉丝；本次基准 ${fmt(policy.baselineCost)}，允许涨 ${policy.tolerance.upPct}% / 跌 ${policy.tolerance.downPct}%。${attempt === 2 ? '价格确认后重报一次。' : ''}`, ledger: ledger.snapshot() });
      // 先落盘，再提交；只有明确 price 拒绝才核价重报，未知结果保留 reserved。
      try { reply = await requestNative(page, '/rpc/gachaDraw', { args: [policy.poolId, quote.button, quote.cost] }); }
      catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 408) ledger.settle(reservation, 'rejected', { code: `http_${error.status}` });
        throw error;
      }
      if (reply.status >= 500 || reply.status === 408) throw Error('召唤服务响应异常，结果未知，请核对游戏记录；不会补抽。');
      if (!reply.ok) {
        const known = reply.status === 200 || reply.status >= 400 && reply.status < 500;
        if (!known) throw Error(reply.error || '本批结果未知，请核对游戏记录；不会补抽。');
        ledger.settle(reservation, 'rejected', { code: String(reply.code || 'server_rejected').slice(0,80) });
        if (isGachaPriceConfirmation(reply) && attempt === 1) { retryOf = reservation.id; report({ phase:'running', message:'原站明确拒绝了旧费用，正在对照本次首次报价检查接受幅度；范围内重报一次。', ledger:ledger.snapshot() }); continue; }
        throw Error((reply.error || '原站拒绝本批召唤，已停止。') + (isGachaPriceConfirmation(reply) ? ' 已重报一次，请重新启动任务。' : ''));
      }
      break;
    }
    if (!Array.isArray(reply.data?.results) || reply.data.results.length > policy.count) throw Error('未取得可核实的抽卡结果，请核对游戏记录；不会重发。');
    const results = reply.data.results.map(r => ({ id: String(r.id), rare: r.rare, isNew: Boolean(r.isNew) }));
    const items=(reply.data.items||[]).filter(i=>Number.isFinite(i.t)&&typeof i.id!=='undefined'&&Number.isFinite(i.n)).slice(0,100).map(i=>({type:i.t,id:String(i.id),count:i.n}));
    ledger.settle(reservation, 'spent', { results, items }); completed += 1; drawn += policy.count; costThisRun += quote.cost;
    report({ phase: 'running', message: `API已确认${completed}批 / ${drawn}抽，召唤结果已记录。`, ledger: ledger.snapshot() });
  }
  report({ phase: 'completed', message: `召唤完成：${completed}批，共${drawn}抽。本次消耗 ${fmt(costThisRun)} 艾莉丝。`, ledger: ledger.snapshot() });
  return { completed, drawn, cost: costThisRun };
}

module.exports = { runGacha };
