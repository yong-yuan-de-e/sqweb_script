'use strict';

const { setTimeout: pause } = require('node:timers/promises');

// 用单调时钟计算两次提交的最小间隔；停止时取消等待，不影响已提交的请求。
async function waitRequestInterval(intervalMs, lastSent, signal) {
  signal.throwIfAborted();
  const wait = Math.max(0, intervalMs - (performance.now() - lastSent));
  if (wait > 0) await pause(Math.ceil(wait), undefined, { signal });
  signal.throwIfAborted();
}

module.exports = { waitRequestInterval };
