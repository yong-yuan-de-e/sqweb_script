'use strict';

const { origin } = require('../shared/config');
const allowedHeaders = Object.freeze({ authorization: 'Authorization', 'x-tab': 'X-Tab', 'x-device': 'X-Device', 'user-agent': 'User-Agent' });
function sessionHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (allowedHeaders[name.toLowerCase()] && typeof value === 'string') result[allowedHeaders[name.toLowerCase()]] = value;
  }
  return result.Authorization && result['X-Tab'] && result['X-Device'] ? result : null;
}

class ApiSession {
  constructor(session, { onInvalidate = () => {} } = {}) {
    this.session = session;
    this.onInvalidate = onInvalidate;
    this.window = null;
    this.headers = null;
    this.generation = 0;
    this.pending = new Map();
    session.webRequest.onBeforeSendHeaders({ urls: [origin + '/api/*'] }, (details, callback) => {
      if (this.window && !this.window.isDestroyed() && details.webContentsId === this.window.webContents.id) {
        const headers = sessionHeaders(details.requestHeaders);
        if (headers) {
          if (this.pending.size >= 100) this.pending.delete(this.pending.keys().next().value);
          this.pending.set(details.id, { headers, generation: this.generation, window: this.window });
        }
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    session.webRequest.onCompleted({ urls: [origin + '/api/*'] }, details => {
      const candidate = this.pending.get(details.id);
      this.pending.delete(details.id);
      if (candidate && candidate.generation === this.generation && candidate.window === this.window &&
          this.window && !this.window.isDestroyed() && details.statusCode >= 200 && details.statusCode < 300) {
        // 请求发出不代表服务器接受当前窗口；只复用本站已成功的正常会话。
        if (this.headers && this.headers.Authorization !== candidate.headers.Authorization) this.onInvalidate();
        this.headers = candidate.headers;
      }
    });
    session.webRequest.onErrorOccurred({ urls: [origin + '/api/*'] }, details => this.pending.delete(details.id));
  }

  bind(window) {
    this.invalidate(); this.window = window;
    window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && this.window === window) this.invalidate();
    });
    window.on('closed', () => { if (this.window === window) { this.window = null; this.invalidate(); } });
  }

  credentials() { return this.window && !this.window.isDestroyed() ? this.headers && { ...this.headers } : null; }
  invalidate() { this.headers = null; this.generation += 1; this.pending.clear(); this.onInvalidate(); }
  fetch(url, options) { return this.session.fetch(url, options); }
  dispose() {
    this.invalidate();
    this.session.webRequest.onBeforeSendHeaders(null);
    this.session.webRequest.onCompleted(null);
    this.session.webRequest.onErrorOccurred(null);
  }
}

module.exports = { ApiSession, sessionHeaders };
