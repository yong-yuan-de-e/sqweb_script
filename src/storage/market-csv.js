'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const schemas = {
  spot: {
    values: ['price', 'fair_price', 'stock', 'turnover_24h', 'price_index', 'change_24h_pct'],
    raw: ['price', 'fair_price', 'stock', 'turnover_24h', 'price_index', 'change_24h_pct'],
    names: ['巴尼尔现价_艾莉丝每张', '基本面价_艾莉丝每张', '全服存量_张', '24小时换手_张', '物价指数', '24小时涨跌_百分比',
      '巴尼尔现价_原文', '基本面价_原文', '全服存量_原文', '24小时换手_原文', '物价指数_原文', '24小时涨跌_原文'],
  },
  futures: {
    values: ['price', 'period_change_pct', 'long_people', 'long_funds', 'short_people', 'short_funds'],
    raw: ['price', 'period_change_pct', 'long', 'short'],
    names: ['当前价', '本期涨幅_百分比', '多头人数', '多头资金_保证金艾莉丝', '空头人数', '空头资金_保证金艾莉丝',
      '当前价_原文', '本期涨幅_原文', '多头人数资金_原文', '空头人数资金_原文'],
  },
};

const encode = values => values.map(value => { const text = String(value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }).join(',');
function decode(line) {
  const cells = []; let value = '', quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { cells.push(value); value = ''; }
    else value += character;
  }
  if (quoted) throw new Error('CSV 最后一条记录不完整，请先检查文件。');
  cells.push(value); return cells;
}

function shanghaiTime(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

class MarketCsv {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.token = randomUUID();
    this.lock = path.join(this.directory, '.collector.lock');
    this.files = {};
    this.acquire();
    try { for (const kind of Object.keys(schemas)) this.files[kind] = this.open(kind); }
    catch (error) { this.close(); throw error; }
  }

  acquire() {
    try { fs.writeFileSync(this.lock, JSON.stringify({ owner: 'sqweb-market', pid: process.pid, token: this.token }), { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(fs.readFileSync(this.lock, 'utf8'));
      if (previous.owner !== 'sqweb-market' || !Number.isInteger(previous.pid)) throw new Error('数据目录存在未知采集锁，请检查该目录。');
      try { process.kill(previous.pid, 0); }
      catch (problem) {
        if (problem.code !== 'ESRCH') throw new Error('无法确认已有采集进程状态。');
        fs.unlinkSync(this.lock); return this.acquire();
      }
      throw new Error('该 CSV 目录已有采集任务运行，请先停止另一个任务。');
    }
  }

  open(kind) {
    const schema = schemas[kind];
    const filename = path.join(this.directory, `${kind}.csv`);
    const header = encode(['采集时间_UTC', '采集时间_北京时间', '采样轮次', ...schema.names]);
    if (!fs.existsSync(filename) || fs.statSync(filename).size === 0) fs.writeFileSync(filename, '\uFEFF' + header + '\r\n', { encoding: 'utf8', flush: true });
    const reader = fs.openSync(filename, 'r');
    let last = null;
    try {
      const size = fs.fstatSync(reader).size;
      const head = Buffer.alloc(Math.min(size, 4096)); fs.readSync(reader, head, 0, head.length, 0);
      if (head.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0] !== header) throw new Error(`${kind}.csv 表头与当前字段不一致，请选择新的数据目录。`);
      const tail = Buffer.alloc(Math.min(size, 65536)); fs.readSync(reader, tail, 0, tail.length, size - tail.length);
      const lines = tail.toString('utf8').split(/\r?\n/).filter(Boolean);
      const line = lines.at(-1)?.replace(/^\uFEFF/, '');
      if (line !== header) {
        const cells = decode(line);
        if (cells.length !== 3 + schema.names.length) throw new Error(`${kind}.csv 最后一行字段数异常，未追加数据。`);
        last = cells.slice(3, 3 + schema.values.length);
      }
      if (!tail.toString('utf8').endsWith('\n')) throw new Error(`${kind}.csv 结尾缺少换行，请先检查是否有未写完的记录。`);
    } finally { fs.closeSync(reader); }
    return { filename, fd: fs.openSync(filename, 'a'), last };
  }

  record(kind, sample, cycle) {
    const schema = schemas[kind], file = this.files[kind];
    const values = schema.values.map(key => sample.values[key]);
    if (values.some(value => typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))) throw new Error('行情字段不是有效数值，未写入 CSV。');
    if (file.last && values.every((value, index) => value === file.last[index])) return false;
    const row = encode([sample.capturedAt, shanghaiTime(sample.capturedAt), cycle, ...values, ...schema.raw.map(key => sample.raw[key])]) + '\r\n';
    fs.writeSync(file.fd, row); fs.fsyncSync(file.fd);
    file.last = values;
    return true;
  }

  close() {
    for (const file of Object.values(this.files)) fs.closeSync(file.fd);
    this.files = {};
    if (fs.existsSync(this.lock) && JSON.parse(fs.readFileSync(this.lock, 'utf8')).token === this.token) fs.unlinkSync(this.lock);
  }
}

module.exports = { MarketCsv };
