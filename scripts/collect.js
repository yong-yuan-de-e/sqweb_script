'use strict';

const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { collectMarket } = require('../src/automation/market-collector');
const { MarketClient } = require('../src/api/market-client');
const { sessionHeaders } = require('../src/browser/api-session');
const { origin } = require('../src/shared/config');
const { Artifacts } = require('../src/storage/artifacts');

async function main() {
  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
  const endpoint = new URL(option('--browser-url', 'http://127.0.0.1:0'));
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.port === '0' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('请传入 --browser-url http://127.0.0.1:本机端口');
  const maxCycles = option('--cycles', undefined) === undefined ? Infinity : Number(option('--cycles'));
  if (!(maxCycles === Infinity || Number.isInteger(maxCycles) && maxCycles > 0)) throw new Error('cycles 必须是正整数。');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const browser = await puppeteer.connect({ browserURL: endpoint.origin, defaultViewport: null, protocolTimeout: 15000 });
  let page, observe, headers;
  try {
    const pages = (await browser.pages()).filter(page => { try { return new URL(page.url()).origin === origin; } catch { return false; } });
    if (pages.length !== 1) throw new Error('必须有且只有一个 SQWeb 登录窗口。');
    page = pages[0];
    observe = request => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const fresh = sessionHeaders(request.headers());
        if (fresh) headers = fresh;
      }
    };
    page.on('request', observe);
    const client = new MarketClient({ fetch: globalThis.fetch.bind(globalThis), credentials: () => page.isClosed() ? null : headers, invalidate: () => { headers = null; } });
    const artifacts = new Artifacts(path.resolve(process.env.SQWEB_DATA_DIR || '.runtime'));
    await collectMarket({ client, signal: controller.signal, directory: path.resolve(option('--output-dir', 'data/market-api')),
      intervalSeconds: Number(option('--interval', '10')), maxCycles, report: event => {
        if (event.log !== false) artifacts.log(event); console.log(`${new Date().toISOString()} ${event.message}`);
      } });
  } catch (error) {
    if (controller.signal.aborted) console.log('采集已停止，CSV 已保留。'); else throw error;
  } finally {
    if (page && observe) page.off('request', observe);
    headers = null; browser.disconnect();
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
