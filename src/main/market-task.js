'use strict';

const { powerSaveBlocker } = require('electron');
const { collectMarket } = require('../automation/market-collector');
const { setTimeout: delay } = require('node:timers/promises');

class MarketTask {
  constructor({ client, artifacts, report, directory, onWaiting }) {
    Object.assign(this, { client, artifacts, report, directory, onWaiting });
    this.activeRun = null;
    this.status = { phase: 'idle', active: false, message: '助手启动后自动采集行情，等待登录会话即可开始。' };
  }
  publish(event) {
    const { log = true, ...payload } = event;
    this.status = { ...this.status, ...payload };
    if (log) this.artifacts.log({ ...payload, task: 'market' });
    this.report();
  }
  async start() {
    if (this.activeRun) throw new Error('行情采集已在运行。');
    const controller = new AbortController();
    this.activeRun = controller;
    const blocker = powerSaveBlocker.start('prevent-app-suspension');
    this.publish({ phase: 'running', active: true, stats: null, message: '启动后台行情请求…' });
    try {
      while (!controller.signal.aborted) {
        try { await collectMarket({ client: this.client, signal: controller.signal, report: event => this.publish(event), directory: this.directory(), onWaiting: this.onWaiting }); break; }
        catch (error) {
          controller.signal.throwIfAborted();
          if (!['EACCES', 'EPERM', 'ENOSPC', 'EMFILE', 'ENFILE', 'EBUSY', 'EIO'].includes(error.code)) throw error;
          this.publish({ phase: 'waiting_storage', message: `保存暂时失败：${error.message}。10秒后重新打开CSV，已有数据保留。` });
          await delay(10000, undefined, { signal: controller.signal });
        }
      }
    }
    catch (error) { this.publish({ phase: controller.signal.aborted ? 'stopped' : 'error', message: controller.signal.aborted ? '采集已停止，CSV 保留。' : error.message }); }
    finally { powerSaveBlocker.stop(blocker); this.activeRun = null; this.publish({ active: false }); }
  }
  stop() { this.activeRun?.abort(); }
  dispose() { this.stop(); }
}
module.exports = { MarketTask };
