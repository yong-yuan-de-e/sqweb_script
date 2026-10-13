'use strict';

const { BrowserWindow, powerSaveBlocker } = require('electron');
const { BrowserSession } = require('../browser/session');
const { runSingleBattle } = require('../automation/single-battle');
const { runCampaign } = require('../automation/campaign');
const { GameRecovery } = require('./game-recovery');
const { scanMap, inspectMapButtons } = require('../maps/scanner');
const { PageState } = require('../game/page-state');
const { scanGachaPools } = require('../gacha/scanner');
const config = require('../shared/config');
const {GameAdapter}=require('../game/adapter');
const {navigateRoute}=require('../maps/navigation');

// 每个任务只持有自己的窗口、Page、取消信号和状态。
class GameTask {
  constructor({ kind = 'battle', port, artifacts, report, onWindow, ledger, resetNetwork, isExternalBusy = () => false, isRequestBusy = () => false }) {
    this.kind = kind;
    this.port = port;
    this.artifacts = artifacts;
    this.report = report;
    this.onWindow = onWindow;
    this.ledger = ledger;
    this.resetNetwork = resetNetwork;
    this.isExternalBusy = isExternalBusy;
    this.isRequestBusy = isRequestBusy;
    this.window = null;
    this.session = null;
    this.activeRun = null;
    this.recovery = null;
    this.restarting = false;
    this.lastSessionRefresh = 0;
    this.disposed = false;
    this.status = { phase: 'idle', active: false, operation: 'battle', ledger: ledger?.snapshot(), message: '在游戏窗口登录后可以作战或召唤，后台行情可同时运行。' };
  }

  publish(event) {
    const { log = true, ...payload } = event;
    this.status = { ...this.status, ...payload };
    if (log) this.artifacts.log({ ...payload, task: this.kind });
    this.report();
  }

  open() {
    if (this.window && !this.window.isDestroyed()) {
      if (this.recovery?.failed && !this.activeRun && !this.isExternalBusy() && !this.isRequestBusy()) this.recovery.reload();
      this.window.show(); this.window.focus(); return;
    }
    const title = 'SQWeb 游戏与作战窗口';
    const window = new BrowserWindow({
      title, width: 1280, height: 800, minWidth: 960, minHeight: 600,
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:sqweb-account', nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    this.window = window;
    this.recovery = new GameRecovery({ window, isBusy: () => Boolean(this.activeRun || this.restarting || this.isExternalBusy() || this.isRequestBusy()), publish: event => {
      if (event.phase !== 'idle' || ['idle', 'loading', 'waiting_network'].includes(this.status.phase)) this.publish(event);
    } });
    this.onWindow?.(window);
    const session = new BrowserSession(this.port, window);
    this.session = session;
    window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title); });
    window.webContents.on('did-finish-load', () => window.setTitle(title));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== config.origin) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.on('closed', () => {
      this.recovery?.dispose(); this.stop(); session.disconnect();
      if (this.window === window) this.window = null;
      if (!this.activeRun && !this.restarting) this.publish({ phase: 'idle', active: false, message: '游戏窗口已关闭，可重新打开。' });
    });
    window.loadURL(config.gameUrl).catch(() => {});
  }

  async restart() {
    if (this.activeRun || this.restarting || this.isExternalBusy() || this.isRequestBusy()) throw new Error('请先确认作战、交易、召唤或扫荡操作已结束，再重启游戏。');
    this.restarting = true;
    this.publish({ phase: 'loading', restarting: true, message: '正在重启游戏窗口并刷新网络连接，保留登录数据…' });
    try {
      const old = this.window;
      if (old && !old.isDestroyed()) await new Promise(resolve => { old.once('closed', resolve); old.destroy(); });
      await this.resetNetwork?.();
      this.open();
    } finally { this.restarting = false; this.publish({ restarting: false }); }
  }

  async refreshSession(signal) {
    if (this.disposed || signal?.aborted || this.activeRun || this.restarting || this.isExternalBusy() || this.isRequestBusy() || Date.now() - this.lastSessionRefresh < 10000) return;
    if (!this.window || this.window.isDestroyed()) { this.lastSessionRefresh = Date.now(); this.open(); return; }
    // 只在闲置首页刷新正常会话；登录框及用户正在操作的其他页面保留。
    if (Date.now() - this.recovery.startedAt < 10000) return;
    const window = this.window;
    let timer;
    const safe = await Promise.race([window.webContents.executeJavaScript(`(() => {
      if (!window.stage || location.hash !== '#/home') return false;
      const labels = [...document.querySelectorAll('button[aria-label]')].map(e => e.getAttribute('aria-label'));
      return !labels.some(label => /登录|自动|AUTO|SKIP|确定|取消/.test(label));
    })()`).catch(() => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), 500); })]);
    clearTimeout(timer);
    if (safe && this.window === window && !this.disposed && !signal?.aborted && !this.activeRun && !this.restarting && !this.isExternalBusy() && !this.isRequestBusy()) { this.lastSessionRefresh = Date.now(); this.recovery.reload(); }
  }

  async start(options = {}) {
    if (this.activeRun || this.restarting || this.isExternalBusy()) throw new Error('游戏窗口已有操作运行中。');
    const operation = options.operation || 'battle';
    if (!['battle', 'battle-entry', 'map-scan', 'map-inspect', 'pool-scan'].includes(operation)) throw new Error('未知游戏操作。');
    if (!this.window || this.window.isDestroyed()) this.open();
    const controller = new AbortController();
    this.activeRun = controller;
    const blocker = powerSaveBlocker.start('prevent-app-suspension');
    let page;
    this.publish({ phase: 'running', active: true, operation, message: '连接本任务的游戏窗口…', screenshot: null, stats: null, pageState: undefined, ...(operation === 'map-scan' ? { mapResult: null } : {}) });
    try {
      page = await this.session.page(controller.signal);
      const report = event => this.publish(event);
      if(operation==='battle-entry'){const game=new GameAdapter(page,controller.signal);await navigateRoute(game,options.route,controller.signal,report);if(options.route.activity?.kind==='worldboss')await game.waitFor({labels:['世界BOSS说明'],pathIncludes:'WorldBossScreen'},'世界Boss页面');report({phase:'completed',message:'已打开所选入口，未挑战；世界Boss可在游戏窗口确认编队与挑战。'});}
      else if (operation === 'pool-scan') await scanGachaPools({ page, signal: controller.signal, report, catalog: options.catalog });
      else if (operation === 'map-inspect') await inspectMapButtons({ page, signal: controller.signal, report, catalog: options.catalog });
      else if (operation === 'map-scan') await scanMap({ page, signal: controller.signal, report, catalog: options.catalog, route: options.route, hash: options.hash, currentOnly: options.currentOnly });
      else if(options.route) await runCampaign({page,signal:controller.signal,report,artifacts:this.artifacts,route:options.route,stageId:options.stageId,catalog:options.catalog,autoNext:options.autoNext,limit:options.limit,onState:options.onState});
      else await runSingleBattle({page,signal:controller.signal,report,artifacts:this.artifacts});
    } catch (error) {
      let screenshot;
      if (!controller.signal.aborted && page && !page.isClosed()) screenshot = await this.artifacts.capture(page, `${this.kind}-error`).catch(() => undefined);
      const updating = error.code === PageState.SERVER_UPDATING;
      this.publish({ phase: controller.signal.aborted ? 'stopped' : updating ? 'waiting_update' : 'error',
        pageState: updating ? error.code : undefined,
        message: controller.signal.aborted ? (operation.startsWith('map-') || operation === 'pool-scan' ? '录入已停止，停留在当前页面。' : operation === 'gacha' ? '召唤脚本已停止，已提交的召唤不会撤销；未确认费用仍预留。' : '作战脚本已停止，游戏中已开始的战斗会继续。')
          : updating ? '服务器更新中，操作已停止。恢复后请先检查游戏当前状态。' : error.message, screenshot });
    } finally {
      powerSaveBlocker.stop(blocker);
      this.activeRun = null;
      this.publish({ active: false, ledger: this.ledger?.snapshot() });
    }
    return { phase: this.status.phase, message: this.status.message, ledger: this.ledger?.snapshot() };
  }

  stop() { this.activeRun?.abort(); }
  dispose() { this.disposed = true; this.recovery?.dispose(); this.stop(); this.session?.disconnect(); }
}

module.exports = { GameTask };
