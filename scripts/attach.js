'use strict';

// 可选的 Node 入口：复用已开放本机 CDP 的游戏页面，与桌面版共用业务模块。
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { runSingleBattle } = require('../src/automation/single-battle');
const { Artifacts } = require('../src/storage/artifacts');
const { origin } = require('../src/shared/config');

async function main() {
  const argument = process.argv.indexOf('--browser-url');
  if (argument < 0 || !process.argv[argument + 1]) throw new Error('用法：npm run attach -- --browser-url http://127.0.0.1:端口');
  const endpoint = new URL(process.argv[argument + 1]);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('browser-url 必须是 http://127.0.0.1:端口，仅连接本机浏览器。');
  }
  const browser = await puppeteer.connect({ browserURL: endpoint.origin, defaultViewport: null, protocolTimeout: 15000 });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  const artifacts = new Artifacts(path.resolve(process.env.SQWEB_DATA_DIR || '.runtime'));
  let page;
  try {
    const pages = (await browser.pages()).filter(page => { try { return new URL(page.url()).origin === origin; } catch { return false; } });
    if (pages.length !== 1) throw new Error('必须有且只有一个已登录的 SQWeb 页面。');
    page = pages[0];
    await runSingleBattle({ page, signal: controller.signal, artifacts, report: event => { artifacts.log(event); console.log(event.message); if (event.screenshot) console.log(event.screenshot); } });
  } catch (error) {
    const screenshot = !controller.signal.aborted && page && !page.isClosed() ? await artifacts.capture(page, 'error').catch(() => undefined) : undefined;
    artifacts.log({ phase: controller.signal.aborted ? 'stopped' : 'error', message: error.message, screenshot });
    throw error;
  } finally { process.removeListener('SIGINT', cancel); browser.disconnect(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
