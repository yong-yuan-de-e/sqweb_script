'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// 回执在确认付费前落盘，未知结果不重发。沿用旧文件名保留历史未确认记录。
class GachaLedger {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'gacha-budget.jsonl');
    this.entries = new Map();
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
        const event = JSON.parse(line);
        if (!event.id || !['reserved', 'spent', 'rejected'].includes(event.state) || !Number.isSafeInteger(event.cost) || event.cost <= 0 || ![1, 10].includes(event.count)) throw new Error('召唤回执记录损坏，请检查日志后再操作。');
        const previous = this.entries.get(event.id);
        if ((!previous && event.state !== 'reserved') || (previous && (previous.state !== 'reserved' || event.state === 'reserved' || previous.cost !== event.cost || previous.count !== event.count || previous.pool !== event.pool))) throw new Error('召唤回执事件不连续，请先检查日志。');
        this.entries.set(event.id, event);
      }
    }
  }

  snapshot() {
    let spent = 0, reserved = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === 'spent') spent += entry.cost;
      if (entry.state === 'reserved') reserved += entry.cost;
    }
    return { spent, reserved };
  }

  write(event) {
    const record = { ...event, time: new Date().toISOString() };
    const fd = fs.openSync(this.file, 'a');
    try { fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.entries.set(event.id, record);
  }

  history() {
    return [...this.entries.values()].reverse().slice(0, 100).map(e => ({ id: e.id, time: e.time || null, pool: e.pool, count: e.count, cost: e.cost, state: e.state,
      manualConfirmed:Boolean(e.manualConfirmed),items:Array.isArray(e.items)?e.items.slice(0,100):[], results: Array.isArray(e.results) ? e.results.slice(0, 10).filter(r => r && /^[\w-]{1,64}$/.test(String(r.id))).map(r => ({ id: String(r.id), rare: r.rare, isNew: Boolean(r.isNew) })) : [] }));
  }

  reserve({ cost, count, pool, baselineCost, tolerance, attempt, retryOf }) {
    const state = this.snapshot();
    if (state.reserved) throw new Error('上次召唤结果未确认。请先核实游戏记录，助手不会重复付费。');
    if (!Number.isSafeInteger(cost) || cost <= 0 || ![1, 10].includes(count)) throw new Error('无法核实召唤费用或次数。');
    const event = { id: randomUUID(), state: 'reserved', cost, count, pool, ...(baselineCost === undefined ? {} : { baselineCost, tolerance, attempt, retryOf }) };
    this.write(event);
    return event;
  }

  settle(entry, state, receipt = {}) {
    if (this.entries.get(entry.id)?.state !== 'reserved' || !['spent', 'rejected'].includes(state)) throw new Error('召唤回执状态不匹配。');
    this.write({ ...entry, state, ...receipt });
  }
  acknowledge(id) { const e=this.entries.get(id);if(e?.state!=='reserved')throw Error('此记录无需人工解除。');this.settle(e,'spent',{manualConfirmed:true,results:[],note:'用户已在游戏中确认本次完成；旧版原始卡片结果未保存。'}); }
}

module.exports = { GachaLedger };
