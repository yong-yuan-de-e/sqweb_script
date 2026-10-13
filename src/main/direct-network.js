'use strict';

const config = require('../shared/config');

// 游戏页面和行情共用这个 Session；任何窗口加载前先固定直连。
async function configureDirectNetwork(network) {
  await network.setProxy({ mode: 'direct' });
  await network.closeAllConnections();
  await network.clearHostResolverCache();
  const proxy = await network.resolveProxy(config.gameUrl);
  if (proxy !== 'DIRECT') throw new Error('游戏直连配置未生效，已停止启动，请检查网络设置。');
  return { mode: 'direct', proxy };
}

module.exports = { configureDirectNetwork };
