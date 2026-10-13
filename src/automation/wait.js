'use strict';

const { setTimeout: delay } = require('node:timers/promises');

async function waitUntil(read, { signal, timeout = 45000, interval = 350, description = '页面状态' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    const value = await read();
    signal?.throwIfAborted();
    if (value) return value;
    await delay(interval, undefined, { signal });
  }
  throw new Error(`等待${description}超时（${Math.round(timeout / 1000)}秒）。请查看游戏窗口和运行日志。`);
}

module.exports = { waitUntil };
