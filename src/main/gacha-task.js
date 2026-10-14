'use strict';

const { powerSaveBlocker } = require('electron');
const { runGacha } = require('../automation/gacha');
const { tradeTolerance } = require('../shared/trade-tolerance');

class GachaTask {
  constructor({ ledger, getPage, report, artifacts, isRestarting, onComplete }) {
    Object.assign(this, { ledger, getPage, report, artifacts, isRestarting, onComplete }); this.activeRun = null;
    this.status = { active: false, phase: 'idle', message: 'API召唤可与推图并行，按每批实时价格执行。', ledger: ledger.snapshot() };
  }
  publish(event) { this.status = { ...this.status, ...event, ledger: this.ledger.snapshot() }; this.artifacts.log({ task: 'gacha', ...event, ledger: undefined }); this.report(); }
  async start(options) {
    if (this.activeRun || this.isRestarting()) throw Error('召唤已运行或游戏正在重启。');
    options = { ...options, tolerance: tradeTolerance(options.tolerance) };
    const controller = new AbortController(); this.activeRun = controller;
    const blocker = powerSaveBlocker.start('prevent-app-suspension');
    this.publish({ active: true, phase: 'running', baselineCost:null, tolerance:options.tolerance, message: '读取首次费用作为本次基准，按上涨/下跌接受幅度执行API召唤。' });
    try { const page = await this.getPage(controller.signal); await runGacha({ page, signal: controller.signal, report: e => this.publish(e), ledger: this.ledger, ...options }); }
    catch (error) { this.publish({ phase: controller.signal.aborted ? 'stopped' : 'error', message: controller.signal.aborted ? '已停止后续批次；已发送请求不会撤销或重发，请查看回执。' : String(error.message).split('\n')[0] }); }
    finally { this.activeRun = null; powerSaveBlocker.stop(blocker); this.publish({ active: false }); this.onComplete?.(); }
    return { phase: this.status.phase, message: this.status.message };
  }
  stop() { this.activeRun?.abort(); }
  dispose() { this.stop(); }
}

module.exports = { GachaTask };
