'use strict';

const config = require('../shared/config');

// HTTP 成功不代表游戏初始化成功；空白/未初始化超时也进入恢复流程。
class GameRecovery {
  constructor({ window, isBusy, publish }) {
    this.window = window; this.isBusy = isBusy; this.publish = publish;
    this.failed = false; this.retry = null; this.checking = false; this.disposed = false;
    this.startedAt = Date.now(); this.attempts = 0; this.ready = false; this.unhealthySince = null;
    this.interval = 10000;
    this.healthTimer = setInterval(() => this.check().catch(() => {}), 1000);
    const wc = window.webContents;
    wc.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        this.startedAt = Date.now(); this.ready = false; this.failed = false; this.unhealthySince = null;
        clearTimeout(this.retry); this.retry = null;
      }
    });
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.schedule(`加载失败：${description}`);
    });
    wc.on('did-finish-load', () => this.check().catch(() => {}));
    wc.on('render-process-gone', () => this.schedule('游戏渲染进程退出'));
  }

  schedule(reason) {
    if (this.disposed || this.window.isDestroyed()) return;
    this.failed = true; this.ready = false;
    if (this.retry) return;
    const remaining = Math.max(0, this.interval - (Date.now() - this.startedAt));
    this.publish({ phase: 'waiting_network', message: `${reason}；${remaining ? `${Math.ceil(remaining / 1000)}秒后` : '立即'}重试，前台任务运行时暂缓。` });
    this.retry = setTimeout(() => {
      this.retry = null;
      if (!this.isBusy()) this.reload();
    }, remaining);
  }

  reload() {
    if (this.disposed || this.window.isDestroyed() || this.isBusy()) return;
    clearTimeout(this.retry); this.retry = null;
    this.failed = false; this.ready = false; this.unhealthySince = null; this.startedAt = Date.now(); this.attempts += 1;
    this.publish({ phase: 'loading', message: `正在重新加载游戏（第 ${this.attempts} 次恢复尝试）…` });
    this.window.webContents.stop();
    this.window.loadURL(config.gameUrl).catch(() => {});
  }

  async check() {
    if (this.disposed || this.window.isDestroyed() || this.checking || this.isBusy()) return;
    if (this.failed) { if (!this.retry) this.schedule('游戏仍未恢复'); return; }
    this.checking = true;
    const generation = this.startedAt;
    let timeout;
    try {
      const healthy = await Promise.race([
        this.window.webContents.executeJavaScript(`(() => {
          const visible = e => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
          const content = (node, alpha = 1) => {
            if (!node?.active || alpha * (node.groupAlpha ?? 1) <= 0.01) return false;
            if ((node.text?.enabled !== false && node.text?.text?.trim()) || (node.image?.enabled !== false && (node.image?.texture || node.image?.sprite))) return true;
            return (node.children || []).some(child => content(child, alpha * (node.groupAlpha ?? 1)));
          };
          // 素材下载会暂时清空命中按钮，但已有画面的正常加载应当继续。
          return Boolean(window.stage && ([...document.querySelectorAll('button[aria-label]')].some(visible) || content(window.stage.main) || content(window.stage.window))) ||
            ['oldui-maint','oldui-closed','oldui-othertab'].some(id => visible(document.getElementById(id)));
        })()`),
        new Promise(resolve => { timeout = setTimeout(() => resolve(false), 500); }),
      ]).catch(() => false);
      if (this.disposed || this.window.isDestroyed() || this.isBusy() || generation !== this.startedAt) return;
      if (healthy) {
        this.unhealthySince = null;
        this.failed = false; clearTimeout(this.retry); this.retry = null;
        if (!this.ready) this.publish({ phase: 'idle', message: '游戏界面已初始化，可登录、作战或召唤。' });
        this.ready = true;
      } else {
        // 已初始化的游戏切换场景也会短暂清空UI，不能按数小时前的加载时间立即刷新。
        this.unhealthySince ??= this.ready ? Date.now() : this.startedAt;
        if (Date.now() - this.unhealthySince >= this.interval) this.schedule('页面连续10秒不可用，可能白屏或连接未完成');
      }
    } finally { clearTimeout(timeout); this.checking = false; }
  }

  dispose() { this.disposed = true; clearTimeout(this.retry); clearInterval(this.healthTimer); }
}

module.exports = { GameRecovery };
