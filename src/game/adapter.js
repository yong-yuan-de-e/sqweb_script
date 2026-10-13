'use strict';

const { waitUntil } = require('../automation/wait');
const config = require('../shared/config');
const { PageState, PageStateError, classifyPageState } = require('./page-state');

function matches(label, matcher, path = '') {
  if (matcher.labels) return matcher.labels.includes(label) && path.includes(matcher.pathIncludes || '');
  return matcher instanceof RegExp ? matcher.test(label) : matcher.includes(label);
}

class GameAdapter {
  constructor(page, signal) {
    this.page = page;
    this.signal = signal;
  }

  async inspect() {
    this.signal?.throwIfAborted();
    if (new URL(this.page.url()).origin !== config.origin) throw new Error('游戏页面离开了 sqweb.fun，已停止操作。');
    const snapshot = await this.page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button[aria-label]')].filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        // ugui-hit 本身就是透明命中层，不能用 opacity 判断游戏按钮是否可见。
        return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled;
      }).map(element => ({ label: element.getAttribute('aria-label'), path: element.dataset.path || '' }));
      const texts = [], scenes = [];
      const walk = (node, alpha = 1) => {
        if (!node || !node.active || alpha * (node.groupAlpha ?? 1) <= 0.01) return;
        if (/Screen$/.test(node.name || '')) scenes.push(node.name);
        if (node.text?.enabled !== false && node.text?.text) texts.push(String(node.text.text));
        for (const child of node.children || []) walk(child, alpha * (node.groupAlpha ?? 1));
      };
      if (window.stage) { walk(window.stage.main); walk(window.stage.window); }
      const visible = element => element && element.getBoundingClientRect().width > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
      const maintenance = document.getElementById('oldui-maint');
      const maintenanceVisible = Boolean(visible(maintenance) && /服务器更新中/.test(maintenance.innerText));
      return { buttons, texts, scenes, loading: !window.stage || Boolean(window.stage.loading), url: location.href,
        maintenanceVisible, otherTabVisible: Boolean(visible(document.getElementById('oldui-othertab'))), splashVisible: Boolean(visible(document.getElementById('splash'))) };
    });
    snapshot.pageState = classifyPageState(snapshot);
    return snapshot;
  }

  async has(matcher) {
    return (await this.inspect()).buttons.some(button => matches(button.label, matcher, button.path));
  }

  async waitFor(matcher, description, timeout = config.timeouts.navigation) {
    return waitUntil(async () => {
      const snapshot = await this.inspect();
      this.checkProblem(snapshot);
      return snapshot.buttons.some(button => matches(button.label, matcher, button.path)) && snapshot;
    }, { signal: this.signal, timeout, description, interval: config.timeouts.poll });
  }

  checkProblem(snapshot) {
    if ([PageState.SERVER_UPDATING, PageState.OTHER_TAB].includes(snapshot.pageState?.code)) throw new PageStateError(snapshot.pageState);
    const text = snapshot.texts.join('\n');
    if (/无法开始|体力不足|队伍.{0,8}还没有编入成员|今天的挑战次数已用完|战斗演出中断|没能确认这场战斗的结算结果|结算失败|登录已过期|账号已在其他/.test(text)) {
      throw new Error(`游戏提示：${text.slice(-1200)}`);
    }
  }

  async click(matcher, description) {
    await this.waitFor(matcher, description);
    const handles = await this.page.$$('button[aria-label]');
    try {
      const candidates = [];
      for (const handle of handles) {
        const data = await handle.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { label: element.getAttribute('aria-label'), path: element.dataset.path || '', enabled: !element.disabled && rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' };
        });
        if (data.enabled && matches(data.label, matcher, data.path)) candidates.push(handle);
      }
      if (candidates.length !== 1) throw new Error(`${description}匹配到 ${candidates.length} 个按钮，无法确定目标。`);
      const identity = await candidates[0].evaluate(element => ({ label: element.getAttribute('aria-label'), path: element.dataset.path }));
      // ElementHandle 的查询上下文可能隔离于网站脚本，stage 必须在 Page 主上下文读取。
      await waitUntil(() => this.page.evaluate(identity => {
        const element = [...document.querySelectorAll('button[aria-label]')].find(button =>
          button.getAttribute('aria-label') === identity.label && button.dataset.path === identity.path && button.isConnected);
        const stage = window.stage;
        if (!element || element.disabled || !stage || stage.loading || stage.holds > 0) return false;
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || !(hit === element || element.contains(hit))) return false;
        const entry = [...stage.buttons.entries()].find(([, button]) => button === element);
        if (!entry) return false;
        let armMs = 250;
        for (let node = entry[0]; node; node = node.parent) {
          if (node.interactable === false) return false;
          const value = stage.armMs.get(node);
          if (value !== undefined) { armMs = value; break; }
        }
        let until = Math.max((stage.shownAt.get(element) || 0) + armMs, stage.armAllAt + 250);
        for (let node = entry[0]; node; node = node.parent) until = Math.max(until, stage.armUntil.get(node) || 0);
        return performance.now() >= until + 100 && stage.tapSync !== stage.syncNo;
      }, identity), { signal: this.signal, timeout: 15000, interval: 100, description: `${description}动画和防误触结束` });
      this.signal?.throwIfAborted();
      // 动画等待期间列表会重建，重新取得当前 DOM，避免点击已经离开文档的旧节点。
      const liveHandle = await this.page.evaluateHandle(identity => [...document.querySelectorAll('button[aria-label]')].find(button =>
        button.getAttribute('aria-label') === identity.label && button.dataset.path === identity.path && button.isConnected), identity);
      try {
        const element = liveHandle.asElement();
        if (!element) throw new Error(`${description}按钮在点击前消失了。`);
        await element.click({ delay: 70 });
      } finally { await liveHandle.dispose(); }
    } finally { await Promise.all(handles.map(handle => handle.dispose())); }
  }

  async navigate(from, to, description) {
    // 导航按钮受站点的动画/防误触时间限制；仅导航允许在确认没有变化后重试。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.click(from, description);
      try { return await this.waitFor(to, `${description}后的页面`, 6000); }
      catch (error) {
        if (this.signal?.aborted || !error.message.startsWith('等待') || attempt === 2) throw error;
      }
    }
  }

  async revealStage(matcher) {
    if (await this.has(matcher)) return;
    // 只滚动任务列表，找不到时停止；不点击关卡或付费按钮。
    for (const deltaY of [-420, 420]) for (let turn = 0; turn < 16; turn += 1) {
      this.signal?.throwIfAborted();
      if (await this.has(matcher)) return;
      const point = await this.page.evaluate(() => {
        const e = [...document.querySelectorAll('button[data-path]')].find(e => {
          const r = e.getBoundingClientRect(); return e.dataset.path.includes('QuestStageItemCell') && r.width > 1 && r.height > 1 && r.top >= 0 && r.bottom <= innerHeight;
        });
        if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!point) throw new Error('没有可滚动的关卡列表，请在游戏中手动定位。');
      await this.page.mouse.move(point.x, point.y); await this.page.mouse.wheel({ deltaY });
      await waitUntil(() => this.has(matcher), { signal: this.signal, timeout: 350, interval: 100, description: '关卡滚动' }).catch(error => { if (this.signal?.aborted || !error.message.startsWith('等待')) throw error; });
    }
    throw new Error('关卡未进入可见列表，请在游戏中手动定位后重试。');
  }

  async battleControls() {
    return this.page.evaluate(() => {
      const root = window.stage?.window;
      const find = (node, name) => {
        if (!node?.active) return null;
        if (node.name === name) return node;
        for (const child of node.children || []) { const found = find(child, name); if (found) return found; }
        return null;
      };
      const auto = find(root, 'AutoButton');
      const speed = find(root, 'SpeedUpButton');
      const animation = node => node?.animation?.name ?? node?.animation?.clip?.name ?? null;
      // 当前控件以橙色/白色贴图与动画表现状态，只读 UI 节点，实际操作仍走鼠标。
      const texture = node => node?.image?.sprite ?? node?.image?.texture?.src ?? '';
      const autoTexture = texture(auto);
      const speedTexture = texture(speed);
      return {
        auto: /button_orange/.test(autoTexture) ? true : /button_white/.test(autoTexture) ? false : null,
        speed: /button_white/.test(speedTexture) ? 0 : /button_orange/.test(speedTexture) ? 1 : null,
        autoAnimation: animation(auto), speedAnimation: animation(speed),
      };
    });
  }
}

module.exports = { GameAdapter };
