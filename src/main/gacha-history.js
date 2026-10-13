'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { nativeContext } = require('../game/native-bridge');

class GachaHistory {
  constructor({ directory, ledger, getPage, isBusy, report }) {
    Object.assign(this, { ledger, getPage, isBusy, report }); this.file = path.join(directory, 'gacha-cards.json'); this.cards = {}; this.loading = false; this.nextTry = 0; this.error = null; this.disposed = false;
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size < 1048576) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [id, card] of Object.entries(data.cards || {})) if (/^[\w:-]{1,96}$/.test(id) && typeof card?.name === 'string' && card.name.length <= 200) this.cards[id] = { name: card.name, description: String(card.description || '').slice(0, 1500), rare:card.rare };
      }
    } catch { this.error = '卡片名称缓存暂不可读，仍保留真实抽卡ID。'; }
  }
  snapshot() { return { error: this.error, records: this.ledger.history().map(e => ({ ...e, items:e.items.map(i=>({...i,name:this.cards[`${i.type}:${i.id}`]?.name||null,description:this.cards[`${i.type}:${i.id}`]?.description||'',rare:this.cards[`${i.type}:${i.id}`]?.rare})), results: e.results.map(r => ({ ...r, name: this.cards[r.id]?.name || null, description: this.cards[r.id]?.description || '' })) })) }; }
  async refresh() {
    if (this.disposed || this.loading || this.isBusy() || Date.now() < this.nextTry) return;
    const ids = [...new Set(this.ledger.history().flatMap(e => [...e.results.map(r=>r.id),...e.items.map(i=>`${i.type}:${i.id}`)]))].filter(id => !this.cards[id]);
    if (!ids.length) return;
    this.loading = true;
    try {
      const page = await this.getPage(), info = await nativeContext(page);
      const cards = await page.evaluate(async ({ info, ids }) => {
        const master = await import(info.master), economy = await master.s();
        if (typeof master.m !== 'function' || !Number.isFinite(master.r?.MEMBER)) throw Error('公开卡片资料结构改变。');
        return ids.map(key => { const split=key.split(':'),type=split.length>1?Number(split[0]):master.r.MEMBER,id=split.at(-1),item = master.m(economy, type, id); return { id:key, name: item.name, description: item.desc,rare:item.rare }; });
      }, { info, ids });
      if (this.disposed) return;
      for (const card of cards) if (typeof card.name === 'string') this.cards[card.id] = { name: card.name.replace(/<[^>]*>/g, '').slice(0, 200), description: String(card.description || '').replace(/<[^>]*>/g, '').slice(0, 1500),rare:card.rare };
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, cards: this.cards }, null, 2) + '\n', { flush: true }); fs.renameSync(this.file + '.tmp', this.file);
      this.error = null; this.report();
    } catch { this.error = '卡片名称暂未读取；结果保留原站ID与稀有度，稍后重试资料读取。'; this.nextTry = Date.now() + 30000; this.report(); }
    finally { this.loading = false; }
  }
  dispose() { this.disposed = true; }
}

module.exports = { GachaHistory };
