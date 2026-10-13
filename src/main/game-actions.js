'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readGameState, requestNative, sweepCost } = require('../game/native-bridge');
const { spotQuote } = require('../game/trade-quote');

const integer = (value, label, min = 1, max = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}应为${min}至${max}的整数。`); return value; };
const domains = { spot: 'spot', withdraw: 'spot', futures: 'futures', close: 'futures', add: 'futures', sweep: 'sweep', stamina: 'sweep' };
const names = { spot: '现货交易', withdraw: '钱包提取', futures: '期货开仓', close: '期货平仓', add: '追加保证金', sweep: '关卡扫荡', stamina: '体力购买' };

class GameActions {
  constructor({ game, maps, artifacts, report }) {
    Object.assign(this, { game, maps, artifacts, report }); this.drafts = new Map(); this.busy = new Set(); this.reading = false;
    this.status = { account: null, message: '可读取体力与主线扫荡信息。', busy: [], unknown: [], receipts: [] };
    this.file = path.join(artifacts.root, 'action-receipts.jsonl');
    const pending = new Map();
    try { if (fs.existsSync(this.file)) for (const line of fs.readFileSync(this.file, 'utf8').trim().split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line); if (!record.id || !['spot', 'futures', 'sweep'].includes(record.domain)) throw new Error('操作回执结构异常');
      if (record.state === 'pending') pending.set(record.id, record.domain); else if (['resolved', 'acknowledged'].includes(record.state)) pending.delete(record.id); else throw new Error('操作回执状态异常');
    } } catch (error) { this.ledgerError = `操作回执暂时不可读：${error.message}。交易与扫荡暂停，行情仍可采集。`; this.status.message = this.ledgerError; }
    this.unresolved = pending; this.status.unknown = [...new Set(pending.values())];
  }

  get busyCount() { return this.busy.size; }
  clear() { this.drafts.clear(); this.publish({ account: null, message: '等待游戏登录后读取体力与余额。' }); }
  publish(event = {}) { this.status = { ...this.status, ...event, busy: [...this.busy], unknown: [...new Set(this.unresolved.values())] }; this.report(); }
  journal(event) { fs.appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n', { flush: true }); }
  async page() { if (this.game.activeRun || this.game.restarting) throw new Error('请先完成当前作战、召唤或地图导航。'); if (!this.game.window || this.game.window.isDestroyed()) throw new Error('请先打开并登录游戏窗口。'); return this.game.session.page(); }

  async refresh(routeId, sync = false, providedRoute) {
    if (this.reading || this.busyCount || this.game.activeRun || this.game.restarting) return this.status.account;
    this.reading = true;
    try {
      const route = providedRoute || (routeId ? this.maps.get(routeId).route : undefined);
      const state = await readGameState(await this.page(), route, sync);
      state.routeId = routeId || this.status.account?.routeId || null;
      if (!routeId) state.stages = this.status.account?.stages || [];
      this.publish({ account: state, message: state.stageError || '体力与关卡信息已更新。' }); return state;
    } finally { this.reading = false; }
  }

  async prepare(options) {
    if (this.ledgerError) throw new Error(this.ledgerError);
    if (!options || !Object.hasOwn(domains, options.kind)) throw new Error('未知交易或扫荡动作。');
    const domain = domains[options.kind];
    if (this.busy.has(domain) || [...this.unresolved.values()].includes(domain)) throw new Error('此类操作正在提交或有未知结果，请先核对。');
    this.busy.add(domain); this.publish();
    try {
      const page = await this.page(), account = await readGameState(page, undefined, true);
      if (account.inBattle) throw new Error('游戏仍在战斗中，请先完成战斗。');
      let endpoint, body, description;
      if (options.kind === 'spot') {
        if (!['buy', 'sell'].includes(options.side)) throw new Error('请选择买入或卖出。');
        const qty = integer(options.qty, '张数'), market = (await requestNative(page, '/exchange/market')).data;
        if (!market.enabled || market.config?.enabled === false || market.tradeBlockReason) throw new Error(market.tradeBlockReason || '现货暂停交易。');
        if (qty > market.config.maxPerTrade) throw new Error('张数超过原站单笔上限。');
        const quote = spotQuote(options.side, market.price, qty, market.stock, market.config);
        if (options.side === 'buy' && quote.limit > account.money) throw new Error('艾莉丝不足以覆盖报价及原站2%价格限制。');
        if (options.side === 'sell' && qty > account.tickets) throw new Error('跳过券不足。');
        endpoint = '/exchange/trade'; body = { side: options.side, qty, limit: quote.limit, requestId: randomUUID() };
        description = `${options.side === 'buy' ? '买入' : '卖出'} ${qty} 张\n预计${options.side === 'buy' ? '花费' : '到手'} ${quote.money.toLocaleString()} 艾莉丝，含手续费 ${quote.fee}\n原站价格限制：${quote.limit.toLocaleString()}，报价均价 ${quote.average}。`;
      } else if (options.kind === 'withdraw') {
        const market = (await requestNative(page, '/exchange/market')).data;
        if (!market.wallet || !(market.wallet.money > 0 || market.wallet.tickets > 0)) throw new Error('交易所钱包没有待提取余额。');
        endpoint = '/exchange/withdraw'; body = {}; description = `提取交易所钱包：艾莉丝 ${market.wallet.money}，跳过券 ${market.wallet.tickets}。`;
      } else if (['futures', 'close', 'add'].includes(options.kind)) {
        const state = (await requestNative(page, '/futures/state')).data;
        if (!Number.isFinite(state.index) || !['maxLeverage', 'openFeeRate', 'maxNotionalPerUser', 'maintenance', 'minHoldMinutes'].every(key => Number.isFinite(state.config?.[key]))) throw new Error('期货报价配置缺失，未提交操作。');
        if (options.kind === 'futures') {
          if (!['long', 'short'].includes(options.side)) throw new Error('请选择看涨或看跌。');
          const margin = integer(options.margin, '保证金'), leverage = integer(options.leverage, '杠杆', 1, state.config?.maxLeverage || 100);
          if (!state.eligible || !state.config?.enabled || state.round?.status !== 'open' || Date.now() >= state.round.cutoffAt) throw new Error(state.reason || '本期不可开仓。');
          const notional = margin * leverage, fee = Math.ceil(Math.round(notional * state.config.openFeeRate * 1e6) / 1e6);
          if (!Number.isSafeInteger(notional) || notional > state.config.maxNotionalPerUser) throw new Error('名义价值超过原站上限。');
          if (margin + fee > account.money) throw new Error('保证金与手续费超过余额。');
          const liquidation = options.side === 'long' ? state.index - (1 - state.config.maintenance) * Math.max(Math.abs(state.index), 1) / leverage : state.index + (1 - state.config.maintenance) * Math.max(Math.abs(state.index), 1) / leverage;
          endpoint = '/futures/open'; body = { side: options.side, margin, leverage, requestId: randomUUID() };
          description = `${options.side === 'long' ? '看涨' : '看跌'}开仓\n保证金 ${margin}，杠杆 ${leverage}×，名义价值 ${notional}，手续费 ${fee}\n参考开仓价 ${state.index}，参考爆仓价 ${liquidation}。`;
        } else {
          const position = state.myPositions?.find(item => String(item.id) === String(options.positionId));
          if (!position || position.status !== 'open') throw new Error('仓位不存在或已结束。');
          if (options.kind === 'close') {
            const left = Math.max(0, position.createdAt + state.config.minHoldMinutes * 60000 - Date.now());
            if (left) throw new Error(`尚需持仓${Math.ceil(left / 1000)}秒才能平仓。`);
            endpoint = '/futures/close'; body = { positionId: position.id }; description = `平仓 ${position.id}\n方向 ${position.side}，保证金 ${position.margin}，当前盈亏 ${position.pnl}。盈利按原站结算规则到账。`;
          } else {
            const amount = integer(options.amount, '追加保证金'); if (amount > account.money) throw new Error('艾莉丝不足。');
            endpoint = '/futures/addMargin'; body = { positionId: position.id, amount, requestId: randomUUID() }; description = `为仓位 ${position.id} 追加保证金 ${amount}，原站不收此项手续费。`;
          }
        }
      } else if (options.kind === 'stamina') {
        const recovery = account.recovery;
        if (!recovery || recovery.remaining === 0 || recovery.cost > account.money || account.stamina + recovery.gain > account.limit) throw new Error('余额、今日购买次数或体力上限不满足原站条件。');
        endpoint = '/rpc/shopBuy'; body = { args: ['11000'] }; description = `购买一次体力回复\n消耗艾莉丝 ${recovery.cost}，体力 ${account.stamina} → ${account.stamina + recovery.gain}\n今日剩余 ${recovery.remaining ?? '不限'} 次。`;
      } else {
        const route = options.resolvedRoute || this.maps.get(options.routeId).route, state = await readGameState(page, route);
        const stage = state.stages.find(item => item.id === options.stageId);
        if (!stage) throw new Error('请选择当前主线路线的实际关卡。');
        const count = integer(options.count, '扫荡次数', 1, 100), costs = await sweepCost(page, stage.id, count);
        if (!costs.skip || costs.lockedBy?.length) throw new Error('原站要求三冠通关并解放前置关卡后才能扫荡。');
        if (Number.isFinite(costs.challengeLeft) && count > costs.challengeLeft) throw new Error('超过今日挑战次数。');
        if (costs.stamina * count > account.stamina || costs.tickets > account.tickets) throw new Error('体力或跳过券不足。');
        endpoint = '/rpc/battleSkip'; body = { args: [stage.id, count] }; description = `${stage.label}（ID ${stage.id}）扫荡 ${count} 次\n消耗体力 ${costs.stamina * count}、跳过券 ${costs.tickets}，HARD额外券按原站算法计算。`;
      }
      for (const [id, draft] of this.drafts) if (draft.expiresAt < Date.now()) this.drafts.delete(id);
      if (this.drafts.size >= 100) this.drafts.delete(this.drafts.keys().next().value);
      const draft = { id: randomUUID(), domain, kind: options.kind, endpoint, body, description, expiresAt: Date.now() + 60000, windowId: this.game.window.id };
      this.drafts.set(draft.id, draft); account.stages = this.status.account?.stages || []; account.routeId = this.status.account?.routeId || null; this.publish({ account, message: '报价已读取，确认后仅提交一次。' });
      return { id: draft.id, description, expiresAt: draft.expiresAt };
    } finally { this.busy.delete(domain); this.publish(); }
  }

  async commit(id, { refresh = true } = {}) {
    const draft = this.drafts.get(id);
    if (!draft || draft.expiresAt < Date.now() || draft.windowId !== this.game.window?.id) throw new Error('报价已失效，请重新读取。');
    if (this.busy.has(draft.domain) || [...this.unresolved.values()].includes(draft.domain)) throw new Error('此类操作尚未结束。');
    this.drafts.delete(id); this.busy.add(draft.domain); this.publish();
    let submitted = false;
    try {
      const page = await this.page();
      this.journal({ id, domain: draft.domain, kind: draft.kind, state: 'pending', input: draft.body });
      submitted = true; this.unresolved.set(id, draft.domain);
      const result = await requestNative(page, draft.endpoint, draft.body);
      const receipt = { id, kind: draft.kind, ok: result.ok, status: result.status, sentAt: result.sentAt, receivedAt: result.receivedAt, message: result.ok ? `${names[draft.kind]}已由服务器确认。` : result.error || '服务器拒绝此操作。' };
      this.journal({ ...receipt, domain: draft.domain, state: 'resolved' }); this.unresolved.delete(id);
      this.publish({ message: receipt.message, receipts: [...this.status.receipts.slice(-19), receipt] }); return receipt;
    } catch (error) {
      const rejected = submitted && error.status >= 400 && error.status < 500 && error.status !== 408;
      const receipt = { id, kind: draft.kind, ok: false, status: error.status, sentAt: error.sentAt, receivedAt: error.receivedAt, unknown: submitted && !rejected, message: error.message };
      if (rejected) { this.journal({ ...receipt, domain: draft.domain, state: 'resolved' }); this.unresolved.delete(id); }
      this.publish({ message: receipt.unknown ? `${error.message} 结果未知，停止同类操作，请核对游戏。` : error.message, receipts: [...this.status.receipts.slice(-19), receipt] }); return receipt;
    } finally {
      this.busy.delete(draft.domain); this.publish();
      if (refresh && !this.busyCount) await this.refresh(undefined, true).catch(() => {});
    }
  }

  planDraft(kind, body, description) {
    if (!['sweep','stamina'].includes(kind) || this.ledgerError || [...this.unresolved.values()].includes('sweep') || this.busy.has('sweep')) throw Error('扫荡/体力存在未确认操作，计划暂停。');
    if (kind === 'sweep' ? !Array.isArray(body?.args) || typeof body.args[0] !== 'string' || !Number.isInteger(body.args[1]) || body.args[1] < 1 || body.args[1] > 100 : JSON.stringify(body) !== JSON.stringify({args:['11000']})) throw Error('计划请求参数无效。');
    const draft = { id: randomUUID(), domain:'sweep', kind, endpoint:kind === 'sweep' ? '/rpc/battleSkip' : '/rpc/shopBuy', body, description, expiresAt:Date.now()+60000, windowId:this.game.window.id }; this.drafts.set(draft.id,draft); return draft;
  }

  acknowledge(domain) {
    if (!['spot', 'futures', 'sweep'].includes(domain) || this.busyCount) throw new Error('请选择已核对的空闲操作类型。');
    for (const [id, value] of this.unresolved) if (value === domain) { this.journal({ id, domain, state: 'acknowledged' }); this.unresolved.delete(id); }
    this.publish({ message: '已记录人工核对，不补发之前的操作。' });
  }
}

module.exports = { GameActions };
