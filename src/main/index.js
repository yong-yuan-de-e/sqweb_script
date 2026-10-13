'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const config = require('../shared/config');
const { Artifacts } = require('../storage/artifacts');
const { Settings } = require('../storage/settings');
const { GameTask } = require('./game-task');
const { MarketTask } = require('./market-task');
const { ApiSession } = require('../browser/api-session');
const { MarketClient } = require('../api/market-client');
const { GachaLedger } = require('../storage/gacha-ledger');
const { MapCatalog } = require('../maps/catalog');
const { configureDirectNetwork } = require('./direct-network');
const { Controllers } = require('./controllers');
const { ExchangeState } = require('./exchange-state');
const { GameActions } = require('./game-actions');
const { GachaCatalog } = require('../gacha/catalog');
const { Scheduler } = require('./scheduler');
const { bootstrapData } = require('../storage/bootstrap-data');
const { GachaHistory } = require('./gacha-history');
const { GachaTask } = require('./gacha-task');
const { BattleCatalog } = require('../battle/catalog');
const { SweepTask } = require('./sweep-task');

// 仅影响本助手，不修改 Windows 或其他应用的代理。
app.commandLine.appendSwitch('no-proxy-server');

if (process.env.SQWEB_DATA_DIR) app.setPath('userData', path.resolve(process.env.SQWEB_DATA_DIR));
const hasLock = app.requestSingleInstanceLock();
let port;
if (!hasLock) app.quit();
else {
  // 只有主实例分配端口，避免第二次启动覆盖仍在使用的 DevToolsActivePort。
  const portProbe = spawnSync(process.execPath, ['-e',
    'const s=require("node:net").createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})',
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 5000, windowsHide: true });
  port = Number(portProbe.stdout.trim());
  if (portProbe.status !== 0 || !Number.isInteger(port) || port < 1) throw new Error('无法分配本机浏览器调试端口。');
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
}

let controllers, artifacts, settings, apiSession, maps, networkStatus, exchange, actions, pools, scheduler, gachaHistory, battleCatalog;
let pendingControllers = 0, quitting = false, publishTimer;
const tasks = {};
const publish = () => {
  if(!controllers||!tasks.market||!tasks.battle||quitting||publishTimer)return;
  publishTimer=setTimeout(()=>{publishTimer=null;if(quitting)return;controllers.broadcast(config.channels.status, {
    market: tasks.market.status, battle: tasks.battle.status, directory: settings.values.marketDirectory, maps: maps.snapshot(), network: networkStatus,
    exchange: exchange.snapshot(),
    actions: actions?.status,
    pools: pools?.snapshot(), plans: scheduler?.snapshot(),
    gachaHistory: gachaHistory?.snapshot(),
    gacha: tasks.gacha?.status,
    battleCatalog: battleCatalog?.snapshot(),
    sweep: tasks.sweep?.status,
  });},200);publishTimer.unref?.();
};

if (hasLock) app.whenReady().then(async () => {
  artifacts = new Artifacts(app.getPath('userData'));
  const executableDirectory = path.dirname(process.execPath);
  const baseDirectory = app.isPackaged ? process.env.PORTABLE_EXECUTABLE_DIR ||
    (path.basename(executableDirectory) === 'win-unpacked' ? path.dirname(executableDirectory) : executableDirectory) : path.join(__dirname, '../..');
  bootstrapData(app.isPackaged ? process.resourcesPath : path.join(baseDirectory,'assets'), path.join(baseDirectory, 'data'));
  settings = new Settings(app.getPath('userData'), path.join(baseDirectory, 'data', 'market-api'));
  maps = new MapCatalog(path.join(baseDirectory, 'data', 'maps'));
  battleCatalog = new BattleCatalog({directory:maps.directory,maps,report:publish,getPage:()=>tasks.battle.session.page()});
  pools = new GachaCatalog(path.join(baseDirectory, 'data', 'gacha'));
  const gameNetwork = session.fromPartition('persist:sqweb-account');
  networkStatus = await configureDirectNetwork(gameNetwork);
  artifacts.log({ task: 'network', message: '游戏窗口与行情请求已固定程序直连。', ...networkStatus });
  exchange = new ExchangeState(publish);
  apiSession = new ApiSession(gameNetwork, { onInvalidate: () => { exchange.clear(); actions?.clear(); } });
  const client = new MarketClient({ fetch: apiSession.fetch.bind(apiSession), credentials: () => apiSession.credentials(), invalidate: () => apiSession.invalidate(),
    onDisplay: (kind, display) => { exchange.update(kind, display); if (kind === 'spot') { actions?.refresh().catch(() => {}); gachaHistory?.refresh().catch(() => {}); battleCatalog?.refresh().catch(() => {}); } } });
  tasks.market = new MarketTask({ client, artifacts, report: publish, directory: () => settings.values.marketDirectory,
    onWaiting: code => code === 'login_required' ? tasks.battle.refreshSession(tasks.market.activeRun?.signal) : undefined });
  tasks.battle = new GameTask({ port, artifacts, ledger: new GachaLedger(artifacts.root), report: publish, onWindow: window => apiSession.bind(window),
    resetNetwork: async () => { networkStatus = await configureDirectNetwork(gameNetwork); publish(); }, isExternalBusy: () => Boolean(actions?.busyCount||tasks.sweep?.activeRun), isRequestBusy: () => Boolean(tasks.gacha?.activeRun||tasks.sweep?.activeRun) });
  tasks.gacha = new GachaTask({ ledger: tasks.battle.ledger, artifacts, report: publish, isRestarting: () => tasks.battle.restarting,
    getPage: signal => { if (!tasks.battle.window || tasks.battle.window.isDestroyed()) throw Error('请先打开并登录游戏。'); return tasks.battle.session.page(signal); },
    onComplete: () => gachaHistory?.refresh().catch(() => {}) });
  actions = new GameActions({ game: tasks.battle, maps, artifacts, report: publish });
  tasks.sweep=new SweepTask({game:tasks.battle,actions,catalog:battleCatalog,report:publish,artifacts});
  gachaHistory = new GachaHistory({ directory: artifacts.root, ledger: tasks.battle.ledger, report: publish,
    getPage: () => tasks.battle.session.page(), isBusy: () => Boolean(tasks.gacha.activeRun || tasks.battle.restarting) });
  scheduler = new Scheduler({ directory: artifacts.root, report: publish, resolvePool: id => pools.get(id),resolveSweep:options=>{const route=battleCatalog.resolve(options.selection),stage=route.stages.find(s=>s.id===options.stageId);if(!stage)throw Error('请选择已关联真实ID的扫荡关卡。');return{route,stage};},
    ready: plan => tasks.battle.restarting ? '到点时游戏重启，未启动任务。' : plan.kind==='sweep'?(tasks.sweep.activeRun||tasks.battle.activeRun||actions.status.account?.inBattle||actions.busyCount||actions.status.unknown.includes('sweep')?'到点时扫荡/作战忙碌或存在未确认扫荡，等待空闲。':!apiSession.credentials()?'没有有效登录会话。':null)
      : tasks.gacha.activeRun ? '到点时召唤正在执行，未启动新的召唤。' : tasks.battle.ledger.snapshot().reserved ? '存在未确认召唤，请先核对。'
        : !apiSession.credentials() ? '到点时没有有效登录会话，未启动召唤。' : null,
    execute: plan => {
      if(plan.kind==='sweep')return tasks.sweep.start(plan);
      const pool = pools.get(plan.poolId);
      if (pool.name !== plan.poolName) throw new Error('计划中的卡池名称已变更，请重新确认后添加计划。');
      return tasks.gacha.start({ pool, mode: plan.mode, batches: plan.batches });
    } });
  controllers = new Controllers({ publish, onEmpty: () => { if (!quitting) app.quit(); } });
  const start = (kind, options) => tasks[kind].start(options).catch(error => tasks[kind].publish({ message: error.message }));
  ipcMain.handle(config.channels.command, async (event, action, options) => {
    if (!controllers.owns(event)) throw new Error('无权调用控制命令。');
    switch (action) {
      case 'new-controller': controllers.create(options?.page || 'market'); break;
      case 'sync-status': publish(); break;
      case 'plan-clock': return scheduler.clock();
      case 'add-plan': return scheduler.add(options);
      case 'cancel-plan': scheduler.cancel(options?.id); break;
      case 'delete-plan': scheduler.remove(options?.id); break;
      case 'preview-sweep-plan': return tasks.sweep.preview(options);
      case 'stop-sweep-plan': tasks.sweep.stop();break;
      case 'exit-assistant': app.quit(); break;
      case 'refresh-battle-catalog': await battleCatalog.refresh(true); break;
      case 'refresh-game-stats': {
        if(options?.selection){const route=battleCatalog.resolve(options.selection);await actions.refresh(route.id,true,route);}else await actions.refresh(undefined,true);break;
      }
      case 'prepare-action': if(['sweep','stamina'].includes(options?.kind)&&tasks.sweep.activeRun)throw Error('扫荡计划运行中，请先停止计划。');return actions.prepare(options?.kind==='sweep'?{...options,resolvedRoute:battleCatalog.resolve(options.selection)}:options);
      case 'commit-action': {
        if (typeof options?.id !== 'string' || options.id.length > 100) throw new Error('缺少有效报价。');
        return actions.commit(options.id);
      }
      case 'acknowledge-action': actions.acknowledge(options?.domain); break;
      case 'acknowledge-gacha': if(tasks.gacha.activeRun)throw Error('请等待本批结束。');tasks.battle.ledger.acknowledge(options?.id);tasks.gacha.publish({message:'已记录人工核对，不重抽旧请求。'});break;
      case 'open-game':
      case 'open-market':
      case 'open-battle': tasks.battle.open(); break;
      case 'collect-market': start('market'); break;
      case 'run-battle': {
        if (!options || typeof options.stageId !== 'string' || typeof options.autoNext !== 'boolean' || !Number.isSafeInteger(options.limit) || options.limit<0) throw new Error('请选择关卡、自动下一关及有效次数。');
        const route=battleCatalog.resolve(options.selection);
        if(route.activity?.kind==='worldboss')throw Error('世界Boss采用独立编队/次数/结算，请使用打开所选入口，在原站确认挑战。');
        if(!route.stages.some(s=>s.id===options.stageId))throw Error('所选关卡不在此层级，请先人工适配活动ID。');
        start('battle', { route, stageId: options.stageId, autoNext:options.autoNext, limit:options.limit, catalog:battleCatalog,onState:state=>actions.publish({account:state}) }); break;
      }
      case 'open-battle-entry': start('battle',{operation:'battle-entry',route:battleCatalog.resolve(options?.selection)});break;
      case 'restart-game': await tasks.battle.restart(); break;
      case 'run-gacha': {
        if (!options || !['single', 'ten'].includes(options.mode) || !Number.isInteger(options.batches) || options.batches < 1 || options.batches > 100) throw new Error('请选择单抽或十连，批次数为1至100。');
        const pool = pools.get(options.poolId);
        if (!pool.modes.includes(options.mode)) throw new Error('卡池不支持所选召唤模式。');
        start('gacha', { mode: options.mode, batches: options.batches, pool }); break;
      }
      case 'stop-gacha': tasks.gacha.stop(); break;
      case 'scan-pools': start('battle', { operation: 'pool-scan', catalog: pools }); break;
      case 'stop-pool-scan': tasks.battle.stop(); break;
      case 'reload-pools': pools.reload(); publish(); break;
      case 'pool-data': { const problem = await shell.openPath(pools.directory); if (problem) throw new Error(problem); break; }
      case 'stop-map-scan': tasks.battle.stop(); break;
      case 'inspect-map-buttons': start('battle', { operation: 'map-inspect', catalog: maps }); break;
      case 'scan-map': {
        if (!options || typeof options.routeId !== 'string' || options.routeId.length > 64 || (options.currentOnly !== undefined && typeof options.currentOnly !== 'boolean')) throw new Error('请选择地图路线。');
        const snapshot = maps.get(options.routeId);const activity=battleCatalog.activities().find(e=>e.routeId===options.routeId);if(activity)snapshot.route={...snapshot.route,activity,stages:activity.stages};publish();
        start('battle', { operation: 'map-scan', catalog: maps, ...snapshot, currentOnly: Boolean(options.currentOnly) }); break;
      }
      case 'reload-map-routes': {
        maps.reload(); publish();
        if (maps.error) throw new Error(`配置无效，已保留上一份有效目录：${maps.error}`);
        break;
      }
      case 'map-config': {
        const problem = await shell.openPath(maps.file); if (problem) throw new Error(problem); break;
      }
      case 'combat-adapters': {
        battleCatalog.ensureAdapters(); const problem=await shell.openPath(battleCatalog.adaptersFile);if(problem)throw Error(problem);break;
      }
      case 'map-data': {
        const problem = await shell.openPath(maps.directory); if (problem) throw new Error(problem); break;
      }
      case 'map-workflow': {
        if (!options || typeof options.routeId !== 'string') throw new Error('请选择地图路线。');
        const { route } = maps.get(options.routeId);
        const filename = maps.workflowPath(route.id);
        if (!fs.existsSync(filename)) throw new Error('请先按路线完成一次扫描，才会生成流程文档。');
        const problem = await shell.openPath(filename); if (problem) throw new Error(problem); break;
      }
      case 'stop-market': tasks.market.stop(); break;
      case 'stop-battle': tasks.battle.stop(); break;
      case 'logs': await shell.openPath(artifacts.root); break;
      case 'data': {
        fs.mkdirSync(settings.values.marketDirectory, { recursive: true });
        const problem = await shell.openPath(settings.values.marketDirectory);
        if (problem) throw new Error(problem);
        break;
      }
      case 'choose-directory': {
        if (tasks.market.activeRun) throw new Error('请先停止采集再修改保存目录。');
        const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: '选择 CSV 保存目录', defaultPath: settings.values.marketDirectory, properties: ['openDirectory', 'createDirectory'] });
        if (!selection.canceled && selection.filePaths[0]) { settings.setDirectory(selection.filePaths[0]); publish(); }
        break;
      }
      default: throw new Error('未知命令。');
    }
    return { ok: true };
  });
  controllers.create();
  while (pendingControllers > 0) { pendingControllers -= 1; controllers.create(); }
  tasks.battle.open();
  start('market');
}).catch(error => { console.error(error); artifacts?.log({ task: 'startup', phase: 'error', message: error.message }); app.quit(); });

app.on('second-instance', () => { if (quitting) return; if (controllers) controllers.create(); else pendingControllers += 1; });
app.on('before-quit', () => { quitting = true; scheduler?.dispose(); gachaHistory?.dispose(); for (const task of Object.values(tasks)) task.dispose(); apiSession?.dispose(); });
app.on('window-all-closed', () => app.quit());
