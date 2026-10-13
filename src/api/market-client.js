'use strict';

const { origin } = require('../shared/config');
const { parseMarketApi } = require('./market-values');
const { parseExchangeDisplay } = require('./exchange-values');
const endpoints = Object.freeze({ spot: '/api/exchange/market', futures: '/api/futures/state' });

class MarketApiError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = 'MarketApiError'; this.code = code; this.status = status; }
}

class MarketClient {
  constructor({ fetch, credentials, invalidate = () => {}, onDisplay }) {
    this.fetch = fetch;
    this.credentials = credentials;
    this.invalidate = invalidate;
    this.onDisplay = onDisplay;
  }

  async sample(kind, signal) {
    signal?.throwIfAborted();
    if (!Object.hasOwn(endpoints, kind)) throw new Error('未知行情类型。');
    const headers = await this.credentials();
    if (!headers?.Authorization || !headers['X-Tab'] || !headers['X-Device']) throw new MarketApiError('login_required', '等待游戏窗口的有效登录会话。');
    const timeout = AbortSignal.timeout(8000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await this.fetch(origin + endpoints[kind], { method: 'GET', headers, credentials: 'include', cache: 'no-store', redirect: 'error', signal: combined }); }
    catch {
      signal?.throwIfAborted();
      throw new MarketApiError('network_error', timeout.aborted ? '行情请求超时。' : '行情网络连接失败。');
    }
    if (response.status === 503) throw new MarketApiError('server_updating', '服务器更新中，稍后重试。', response.status);
    if ([502, 504].includes(response.status)) throw new MarketApiError('network_error', '行情服务暂时不可用。', response.status);
    let payload;
    try { payload = await response.json(); } catch {
      signal?.throwIfAborted();
      throw new MarketApiError('invalid_response', '行情接口没有返回有效 JSON。', response.status);
    }
    const errorText = typeof payload?.error === 'string' ? payload.error.slice(0, 200) : `行情接口请求失败（${response.status}）。`;
    const current = await this.credentials();
    if (current?.Authorization !== headers.Authorization || current?.['X-Tab'] !== headers['X-Tab']) throw new MarketApiError('login_required', '游戏会话已刷新，等待新窗口的登录请求。');
    if (response.status === 409 && payload?.otherTab) throw new MarketApiError('other_tab', '账号已在其他窗口打开，请在游戏窗口手动确认当前会话。', response.status);
    if (response.status === 401) { this.invalidate(); throw new MarketApiError('login_required', '登录已失效，请在游戏窗口重新登录。', 401); }
    if (payload?.notOpen || /服务器更新|服务器维护/.test(errorText)) throw new MarketApiError('server_updating', errorText, response.status);
    if (response.status === 403 && !/战斗|作战|battle|in.?combat/i.test(errorText)) throw new MarketApiError('forbidden', errorText, response.status);
    if (!response.ok || payload?.ok === false) throw new MarketApiError(/战斗|作战|battle|in.?combat/i.test(errorText) ? 'battle_busy' : 'request_failed', errorText, response.status);
    signal?.throwIfAborted();
    const sample = { ...parseMarketApi(kind, payload?.data), capturedAt: new Date().toISOString() };
    if (this.onDisplay) this.onDisplay(kind, parseExchangeDisplay(kind, payload.data, sample));
    return sample;
  }
}

module.exports = { MarketClient, MarketApiError };
