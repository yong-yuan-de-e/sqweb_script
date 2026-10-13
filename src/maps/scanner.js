'use strict';

const { GameAdapter } = require('../game/adapter');
const { waitUntil } = require('../automation/wait');
const { dangerous } = require('./catalog');
const { readGameState } = require('../game/native-bridge');
const { navigateRoute } = require('./navigation');
const {readWorldBoss}=require('../game/world-boss');

async function levels(page, filter = {}) {
  return page.evaluate(filter => {
    const result = [], seen = new Set();
    const stage = window.stage;
    const textOf = node => {
      const texts = [];
      const walk = (n, alpha = 1) => {
        if (!n?.active || alpha * (n.groupAlpha ?? 1) <= 0.01) return;
        if (n.text?.enabled !== false && n.text?.text) texts.push(String(n.text.text).replace(/<[^>]+>/g, '').trim());
        for (const child of n.children || []) walk(child, alpha * (n.groupAlpha ?? 1));
      };
      walk(node); return [...new Set(texts.filter(Boolean))];
    };
    const pathOf = node => {
      const parts = [];
      for (let n = node; n; n = n.parent) {
        const peers = n.parent?.children?.filter(child => child.name === n.name) || [n];
        parts.unshift(n.name + (peers.length > 1 ? `[${peers.indexOf(n)}]` : ''));
        if (/Screen$/.test(n.name)) break;
      }
      return parts.join('/');
    };
    const numbered = label => /^(?:\d+章[-－]\d+|\d+[-－]\d+|(?:EX|SP|BOSS|关卡|挑战|第)\s*[-－]?\d+(?:关|层)?)(?:\s|$)/i.test(label);
    const walk = (node, alpha = 1) => {
      if (!node?.active || alpha * (node.groupAlpha ?? 1) <= 0.01) return;
      const label = typeof node.label === 'string' ? node.label.trim() : '';
      if (label) {
        const path = pathOf(node), custom = Boolean(filter.pathIncludes || filter.labelPrefix);
        const candidate = custom ? path.includes(filter.pathIncludes || '') && label.startsWith(filter.labelPrefix || '') :
          /Stage.*(?:Cell|Item|Button)$/.test(node.name) || numbered(label);
        if (candidate && !seen.has(path)) {
          seen.add(path);
          const texts = textOf(node), powerIndex = texts.findIndex(text => /推荐战力/.test(text));
          let interactable = true;
          for (let n = node; n; n = n.parent) if (n.interactable === false) interactable = false;
          const element = stage?.buttons?.get(node), rect = element?.getBoundingClientRect();
          result.push({ label, path, kind: /^(?:播放视频|播放剧情|观看|剧情|故事)/.test(label) ? 'story' : 'stage', visibleButton: Boolean(rect && rect.width > 1 && rect.height > 1),
            interactable, hasClickHandler: typeof node.onClick === 'function', recommendedPower: powerIndex >= 0 ? texts[powerIndex + 1] || null : null, texts });
        }
      }
      for (const child of node.children || []) walk(child, alpha * (node.groupAlpha ?? 1));
    };
    walk(stage?.main); return result;
  }, filter);
}

async function scanMap({ page, signal, report, catalog, route, hash, currentOnly = false }) {
  const game = new GameAdapter(page, signal);
  let navigation = [];
  const step = message => report({ phase: 'running', message });
  const snapshot = await game.inspect(); game.checkProblem(snapshot);
  if (snapshot.buttons.some(button => ['自动', 'AUTO', 'SKIP', '战斗开始', '确定召唤'].includes(button.label))) throw new Error('当前存在战斗、召唤或确认操作，请先完成后再扫描。');
  if (!currentOnly) navigation = await navigateRoute(game, route, signal, report);
  step('读取完整关卡UI树，包括滚动区域外的已加载条目');
  let items;
  await waitUntil(async () => {
    const view = await game.inspect(); game.checkProblem(view);
    if(route.levelSelector?.pathIncludes==='WorldBossScreen'){
      const button=view.buttons.find(b=>/WorldBossScreen\/.+ScorechallengeRankingCell\[0\]\/DescriptionArea\/DetailButton$/.test(b.path));
      if(!button)return false;const boss=await readWorldBoss(page);
      items=[{id:boss.id,label:boss.name,path:button.path,kind:'worldboss',stamina:0,manualBattle:true,visibleButton:true,interactable:true,hasClickHandler:true,texts:[boss.name],public:{enemy:boss.enemy,art:boss.art,start:boss.start,end:boss.end,dailyTries:boss.dailyTries}}];
    }else items = await levels(page, route.levelSelector);
    return !view.loading && items.some(item => ['stage','worldboss'].includes(item.kind));
  }, { signal, timeout: 15000, interval: 300, description: '可识别的关卡列表' });
  if (!currentOnly) {
    try {
      const state = await readGameState(page, route);
      for (const item of items) {
        const matches = state.stages.filter(stage => stage.label === item.label);
        if (matches.length === 1) { item.id = matches[0].id; item.stamina = matches[0].stamina; }
      }
    } catch { step('已读取UI关卡列表，原站ID适配暂不可用；不猜测ID。'); }
  }
  const url = new URL(page.url());
  const result = { version: 1, routeId: route.id, routeName: route.name, mode: currentOnly ? 'current-page' : 'route',
    configHash: hash, scannedAt: new Date().toISOString(), sourcePage: url.origin + url.pathname + url.hash, routeSteps: route.steps, navigation,
    levels: items.filter(item => ['stage','worldboss'].includes(item.kind)), extras: items.filter(item => !['stage','worldboss'].includes(item.kind)) };
  const filename = catalog.save(route.id + (currentOnly ? '-current' : ''), result);
  const workflowFile = catalog.saveWorkflow(route, result);
  report({ phase: 'completed', message: `已识别 ${result.levels.length} 个关卡${result.extras.length ? `及${result.extras.length}个剧情条目` : ''}，结果与流程文档已保存；停留在列表页面。`, mapResult: { ...result, filename, workflowFile } });
  return result;
}

async function inspectMapButtons({ page, signal, report, catalog }) {
  const game = new GameAdapter(page, signal), view = await game.inspect(); game.checkProblem(view);
  const buttons = view.buttons.filter(button => !/DefaultHeader|UserInfo/.test(button.path) && !dangerous.test(button.label) && /Screen|MyPageFooter/.test(button.path));
  const url = new URL(page.url());
  const result = { scannedAt: new Date().toISOString(), sourcePage: url.origin + url.pathname + url.hash, buttons };
  const filename = catalog.save('current-buttons', result);
  report({ phase: 'completed', message: `已读取 ${buttons.length} 个当前导航按钮，可复制名称与路径到路线配置。`, mapButtons: { ...result, filename } });
}

module.exports = { scanMap, levels, inspectMapButtons };
