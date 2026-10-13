'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

const pages = Object.freeze(['market', 'battle', 'gacha', 'maps', 'plans', 'trading']);

class Controllers {
  constructor({ publish, onEmpty }) { this.windows = new Set(); this.publish = publish; this.onEmpty = onEmpty; }

  create(page = 'market') {
    if (!pages.includes(page)) throw new Error('未知主控页面。');
    const window = new BrowserWindow({
      title: 'SQWeb 数据与作战助手', width: 1080, height: 820, minWidth: 760, minHeight: 600, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    this.windows.add(window);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('did-finish-load', () => { window.show(); this.publish(); });
    window.on('closed', () => { this.windows.delete(window); if (!this.windows.size) this.onEmpty(); });
    window.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { page } }).catch(() => {});
    return window;
  }

  owns(event) {
    return [...this.windows].some(window => !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
  }

  broadcast(channel, snapshot) {
    for (const window of this.windows) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, snapshot);
  }
}

module.exports = { Controllers, controllerPages: pages };
