'use strict';

// 钱包、订单和历史图只在此内存对象及主控页面中存在，不写日志或文件。
class ExchangeState {
  constructor(report) { this.report = report; this.spot = null; this.futures = null; }
  update(kind, display) { if (!['spot', 'futures'].includes(kind)) return; this[kind] = display; this.report(); }
  clear() { this.spot = null; this.futures = null; this.report(); }
  snapshot() { return { spot: this.spot, futures: this.futures }; }
}

module.exports = { ExchangeState };
