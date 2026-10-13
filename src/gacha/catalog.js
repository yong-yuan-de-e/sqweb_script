'use strict';

const fs = require('node:fs');
const path = require('node:path');
const defaultPool = Object.freeze({ id: '100001', name: '高级召唤', pathIncludes: 'GachaListArea/', automatic: true, modes: ['single', 'ten'], buttons: [] });

class GachaCatalog {
  constructor(directory) { this.directory = path.resolve(directory); this.file = path.join(this.directory, 'pools.json'); this.data = { version: 1, scannedAt: null, pools: [] }; this.error = null; this.reload(); }
  reload() {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 262144) throw Error('卡池文件过大。');
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
        if (data.version !== 1 || !Array.isArray(data.pools) || data.pools.length > 200) throw Error('卡池记录格式无效。');
        const ids = new Set();
        for (const p of data.pools) {
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name || p.name.length > 200 || !Array.isArray(p.buttons) || !Array.isArray(p.modes) || p.modes.some(m => !['single', 'ten'].includes(m))) throw Error('卡池条目无效。');
          ids.add(p.id);
        }
        this.data = data;
      }
      this.error = null;
    } catch (error) { this.error = error.message; }
    return this.snapshot();
  }
  save(pools) {
    const data = { version: 1, scannedAt: new Date().toISOString(), pools };
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data, null, 2) + '\n', { flush: true });
    fs.renameSync(this.file + '.tmp', this.file); this.data = data; this.error = null;
    return this.snapshot();
  }
  snapshot() { return { ...this.data, file: this.file, error: this.error }; }
  selectable() { const rows = this.data.pools.filter(p => p.automatic); return rows.some(p => p.id === defaultPool.id) ? rows : [defaultPool, ...rows]; }
  get(id = defaultPool.id) {
    this.reload(); if (this.error) throw Error(`卡池记录需要处理：${this.error}`);
    const pool = this.selectable().find(p => p.id === id); if (!pool) throw Error('请选择支持艾莉丝单抽/十连的已录入卡池。');
    return JSON.parse(JSON.stringify(pool));
  }
}

module.exports = { GachaCatalog, defaultPool };
