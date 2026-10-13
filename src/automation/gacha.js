'use strict';

const { requestNative, readGameState } = require('../game/native-bridge');

async function runGacha({ page, signal, report, ledger, pool, mode, batches = 1 }) {
  if (!['single', 'ten'].includes(mode) || !Number.isInteger(batches) || batches < 1 || batches > 100) throw Error('召唤模式或批次数无效。');
  if (ledger.snapshot().reserved) throw Error('上一笔召唤结果未确认，请先核对游戏记录。');
  let completed = 0, drawn = 0, costThisRun = 0;
  for (let batch = 0; batch < batches; batch += 1) {
    signal?.throwIfAborted();
    report({ phase: 'running', message: `读取${pool.name}最新API报价（${batch + 1}/${batches}批）`, ledger: ledger.snapshot() });
    const pools = (await requestNative(page, '/rpc/releasedGachaPools', { args: [] })).data;
    if (!Array.isArray(pools)) throw Error('原站卡池列表格式改变，未发送抽卡请求。');
    const live = pools.find(p => String(p.id) === pool.id), count = mode === 'single' ? 1 : 10;
    const button = live?.buttons?.find(b => b.count === count && b.ticket === false && Number.isSafeInteger(b.cost) && b.cost > 0);
    if (!live || live.name !== pool.name || live.kind === 'assist' || !button || typeof button.button !== 'string') throw Error('卡池、模式或消耗类型已变化，请重新录入。');
    const account = await readGameState(page, undefined, true);
    if (account.money < button.cost) throw Error('艾莉丝不足，本批未提交。');
    signal?.throwIfAborted();
    const reservation = ledger.reserve({ pool: live.name, count, cost: button.cost });
    report({ phase: 'running', message: `第${batch + 1}/${batches}批：${count}抽，实时费用${button.cost}艾莉丝，提交一次API请求。`, ledger: ledger.snapshot() });
    // 已发送请求不因停止、网络异常或报价变化而重发。
    let reply;
    try { reply = await requestNative(page, '/rpc/gachaDraw', { args: [pool.id, button.button, button.cost] }); }
    catch(e) { if(e.status>=400&&e.status<500&&e.status!==408)ledger.settle(reservation,'rejected',{code:`http_${e.status}`});throw e; }
    if (!reply.ok && reply.status === 200) { ledger.settle(reservation, 'rejected', { code: String(reply.code || 'server_rejected').slice(0,80) }); throw Error(reply.error || '原站拒绝本批召唤，已停止；不会自动补抽。'); }
    if (!reply.ok || !Array.isArray(reply.data?.results) || reply.data.results.length > count) throw Error(reply.error || '未取得可核实的抽卡结果，请核对游戏记录；不会重发。');
    const results = reply.data.results.map(r => ({ id: String(r.id), rare: r.rare, isNew: Boolean(r.isNew) }));
    const items=(reply.data.items||[]).filter(i=>Number.isFinite(i.t)&&typeof i.id!=='undefined'&&Number.isFinite(i.n)).slice(0,100).map(i=>({type:i.t,id:String(i.id),count:i.n}));
    ledger.settle(reservation, 'spent', { results, items }); completed += 1; drawn += count; costThisRun += button.cost;
    report({ phase: 'running', message: `API已确认${completed}批 / ${drawn}抽，召唤结果已记录。`, ledger: ledger.snapshot() });
  }
  report({ phase: 'completed', message: `召唤完成：${completed}批，共${drawn}抽。本次消耗${costThisRun}艾莉丝。`, ledger: ledger.snapshot() });
  return { completed, drawn, cost: costThisRun };
}

module.exports = { runGacha };
