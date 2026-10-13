'use strict';

const puppeteer = require('puppeteer-core');
const { waitUntil } = require('../automation/wait');
const { origin } = require('../shared/config');

class BrowserSession {
  constructor(port, gameWindow) {
    this.port = port;
    this.gameWindow = gameWindow;
    this.browser = null;
    this.targetId = null;
  }

  async page(signal) {
    if (this.gameWindow.isDestroyed()) throw new Error('游戏窗口已关闭，请重新打开游戏。');
    if (!this.targetId) {
      const debuggerApi = this.gameWindow.webContents.debugger;
      debuggerApi.attach('1.3');
      try { this.targetId = (await debuggerApi.sendCommand('Target.getTargetInfo')).targetInfo.targetId; }
      finally { debuggerApi.detach(); }
    }
    if (!this.browser?.connected) {
      await waitUntil(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, { signal: AbortSignal.timeout(1200) });
          return response.ok;
        } catch { return false; }
      }, { signal, timeout: 15000, description: '本机浏览器连接' });
      this.browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${this.port}`,
        defaultViewport: null,
        protocolTimeout: 15000,
      });
    }
    return waitUntil(async () => {
      for (const page of await this.browser.pages()) {
        try { if (new URL(page.url()).origin !== origin) continue; } catch { continue; }
        const session = await page.createCDPSession();
        try {
          const { targetInfo } = await session.send('Target.getTargetInfo');
          if (targetInfo.targetId === this.targetId) return page;
        } finally { await session.detach(); }
      }
      return false;
    }, { signal, timeout: 15000, description: '本任务对应的 SQWeb 页面' });
  }

  disconnect() {
    this.browser?.disconnect();
    this.browser = null;
  }
}

module.exports = { BrowserSession };
