'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const { MarketCsv } = require('../storage/market-csv');

async function collectMarket({ client, signal, report, directory, intervalSeconds = 10, maxCycles = Infinity, onWaiting = async () => {} }) {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 86400) throw new Error('采集间隔必须为 10–86400 秒的整数。');
  const csv = new MarketCsv(directory);
  const stats = { cycles: 0, spotWritten: 0, futuresWritten: 0, unchanged: 0, errors: 0, lastSuccessAt: null };
  let failures = 0, pause = '';
  try {
    report({ phase: 'running', message: '通过登录窗口的会话请求行情接口…', directory: csv.directory, stats });
    while (stats.cycles < maxCycles) {
      signal?.throwIfAborted();
      const started = Date.now(), cycle = randomUUID();
      let success = 0, writtenThisCycle = 0, interrupted, schemaFailure = false;
      const kinds = ['spot', 'futures'];
      const outcomes = await Promise.allSettled(kinds.map(kind => client.sample(kind, signal)));
      signal?.throwIfAborted();
      for (const [index, kind] of kinds.entries()) {
        try {
          if (outcomes[index].status === 'rejected') throw outcomes[index].reason;
          const sample = outcomes[index].value;
          signal?.throwIfAborted();
          const written = csv.record(kind, sample, cycle);
          if (written) { stats[kind === 'spot' ? 'spotWritten' : 'futuresWritten'] += 1; writtenThisCycle += 1; }
          else stats.unchanged += 1;
          success += 1;
          stats.lastSuccessAt = sample.capturedAt;
        } catch (error) {
          signal?.throwIfAborted();
          if (['other_tab', 'forbidden'].includes(error.code)) throw error;
          if (['EACCES', 'EPERM', 'ENOSPC', 'EMFILE', 'ENFILE', 'EBUSY', 'EIO'].includes(error.code)) throw error;
          if (['login_required', 'server_updating', 'battle_busy'].includes(error.code)) { interrupted = error; break; }
          stats.errors += 1;
          schemaFailure ||= !error.code;
          report({ phase: 'running', message: `${kind === 'spot' ? '现货' : '期货'}本次未写入：${error.message}`, directory: csv.directory, stats: { ...stats } });
        }
      }
      if (interrupted) {
        const phases = { login_required: 'waiting_login', server_updating: 'waiting_update', battle_busy: 'waiting_battle' };
        if (pause !== interrupted.code) report({ phase: phases[interrupted.code], pageState: interrupted.code, message: interrupted.message + ' 采集暂缓，不写入旧数据。', directory: csv.directory, stats: { ...stats } });
        pause = interrupted.code;
        await onWaiting(interrupted.code);
        await delay(interrupted.code === 'login_required' ? 2000 : Math.max(0, intervalSeconds * 1000 - (Date.now() - started)), undefined, { signal });
        continue;
      }
      pause = '';
      stats.cycles += 1;
      failures = success === 0 ? failures + 1 : 0;
      if (failures >= 3 && schemaFailure) {
        report({ phase: 'waiting_data', message: '接口字段暂时无法解析，10秒采样继续尝试，有效数据才写入。', stats: { ...stats } });
        await delay(Math.max(0, intervalSeconds * 1000 - (Date.now() - started)), undefined, { signal }); failures = 0;
        continue;
      }
      report({ phase: 'running', pageState: 'ready', message: `已采样 ${stats.cycles} 轮，现货写入 ${stats.spotWritten} 条、期货写入 ${stats.futuresWritten} 条，未变化 ${stats.unchanged} 次。`, stats: { ...stats }, directory: csv.directory, log: writtenThisCycle > 0 });
      if (stats.cycles >= maxCycles) break;
      if (failures >= 3) {
        report({ phase: 'waiting_network', message: '行情请求连续失败，保持10秒采样重试，已保存的 CSV 保留。', stats: { ...stats } });
        await delay(Math.max(0, intervalSeconds * 1000 - (Date.now() - started)), undefined, { signal }); failures = 0;
      } else await delay(Math.max(0, intervalSeconds * 1000 - (Date.now() - started)), undefined, { signal });
    }
    report({ phase: 'completed', message: '行情采集完成，CSV 已保存。', stats: { ...stats }, directory: csv.directory });
    return stats;
  } finally { csv.close(); }
}

module.exports = { collectMarket };
