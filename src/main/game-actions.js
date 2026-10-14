'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readGameState, requestNative, sweepCost } = require('../game/native-bridge');
const { createTrade, requoteTrade } = require('../game/trade-policy');
const { staminaItemBody } = require('../game/stamina-recovery');
const { isPriceConfirmation } = require('../shared/trade-tolerance');
const { formatNumber: fmt } = require('../shared/number-format');

const integer = (value, label, min = 1, max = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}应为${min}至${max}的整数。`); return value; };
const domains = { spot: 'spot', withdraw: 'spot', futures: 'futures', close: 'futures', add: 'futures', sweep: 'sweep', stamina: 'sweep', 'stamina-item': 'sweep' };
const names = { spot: '现货交易', withdraw: '钱包提取', futures: '期货开仓', close: '期货平仓', add: '追加保证金', sweep: '关卡扫荡', stamina: '体力购买', 'stamina-item': '道具回复体力' };

class GameActions {
  constructor({ game, maps, artifacts, report, isSweepBusy }) {
    Object.assign(this, { game, maps, artifacts, report, isSweepBusy }); this.drafts = new Map(); this.busy = new Set(); this.reading = false;
    this.refreshJobs=new Map();this.refreshChain=Promise.resolve();this.generation=0;
    this.status = { account: null, routeStates: {}, message: '切换章节后自动核对关卡与体力。', busy: [], unknown: [], receipts: [] };
    this.file = path.join(artifacts.root, 'action-receipts.jsonl');
    const pending = new Map();
    try { if (fs.existsSync(this.file)) for (const line of fs.readFileSync(this.file, 'utf8').trim().split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line); if (!record.id || !['spot', 'futures', 'sweep'].includes(record.domain)) throw new Error('操作回执结构异常');
      if (record.state === 'pending') pending.set(record.id, record.domain); else if (['resolved', 'acknowledged'].includes(record.state)) pending.delete(record.id); else throw new Error('操作回执状态异常');
    } } catch (error) { this.ledgerError = `操作回执暂时不可读：${error.message}。交易与扫荡暂停，行情仍可采集。`; this.status.message = this.ledgerError; }
    this.unresolved = pending; this.status.unknown = [...new Set(pending.values())];
  }

  get busyCount() { return this.busy.size; }
  clear() { this.generation++;this.drafts.clear(); this.publish({ account: null, routeStates: {}, message: '等待游戏登录后读取体力与余额。' }); }
  publish(event = {}) {
    const account=event.account;
    if(account?.routeId&&account.stageCapturedAt){const routes={...this.status.routeStates,[account.routeId]:{stages:account.stages,capturedAt:account.stageCapturedAt,error:account.stageError||null}};while(Object.keys(routes).length>128)delete routes[Object.keys(routes)[0]];event={...event,routeStates:routes};}
    this.status = { ...this.status, ...event, busy: [...this.busy], unknown: [...new Set(this.unresolved.values())] }; this.report();
  }
  journal(event) { fs.appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n', { flush: true }); }
  async page() { if (this.game.activeRun || this.game.restarting) throw new Error('请先完成当前作战、召唤或地图导航。'); if (!this.game.window || this.game.window.isDestroyed()) throw new Error('请先打开并登录游戏窗口。'); return this.game.session.page(); }

  refresh(routeId, sync = false, providedRoute) {
    const key=routeId||'account';if(this.refreshJobs.has(key))return this.refreshJobs.get(key);
    const generation=this.generation;
    const job=this.refreshChain.catch(()=>{}).then(async()=>{
      if(this.busyCount||this.game.activeRun||this.game.restarting||this.isSweepBusy?.()||generation!==this.generation)return null;
      this.reading=true;
      try{
        const route=providedRoute||(routeId?this.maps.get(routeId).route:undefined),state=await readGameState(await this.page(),route,sync);
        if(generation!==this.generation)return null;
        state.routeId=routeId||this.status.account?.routeId||null;
        if(!routeId){state.stages=this.status.account?.stages||[];state.stageCapturedAt=this.status.account?.stageCapturedAt;}
        this.publish({account:state,message:state.stageError||'体力与关卡信息已更新。'});return state;
      }finally{this.reading=false;}
    }).finally(()=>this.refreshJobs.delete(key));
    this.refreshJobs.set(key,job);this.refreshChain=job;return job;
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
      let endpoint, body, description, trade;
      if (['spot','futures','close'].includes(options.kind)) {
        const state=(await requestNative(page,options.kind==='spot'?'/exchange/market':'/futures/state')).data;
        ({endpoint,body,description,trade}=createTrade(options,state,account));
      } else if (options.kind === 'withdraw') {
        const market=(await requestNative(page,'/exchange/market')).data;
        if(!market.wallet||!(market.wallet.money>0||market.wallet.tickets>0))throw Error('交易所钱包没有待提取余额。');
        endpoint='/exchange/withdraw';body={};description=`提取交易所钱包：艾莉丝 ${fmt(market.wallet.money)}，跳过券 ${fmt(market.wallet.tickets)}。`;
      } else if (options.kind === 'add') {
        const state=(await requestNative(page,'/futures/state')).data,position=state.myPositions?.find(p=>String(p.id)===String(options.positionId));
        if(!position||position.status!=='open')throw Error('仓位不存在或已结束。');
        const amount=integer(options.amount,'追加保证金');if(amount>account.money)throw Error('艾莉丝不足。');
        endpoint='/futures/addMargin';body={positionId:position.id,amount,requestId:randomUUID()};description=`为仓位 ${position.id} 追加保证金 ${fmt(amount)}，原站不收此项手续费。`;
      } else if (options.kind === 'stamina-item') {
        endpoint = '/rpc/useStaminaItem'; body = staminaItemBody(account, options.itemId, options.count);
        const item = account.staminaItems.find(item => item.id === options.itemId);
        description = `使用${item.name} × ${fmt(options.count)}\n体力 ${fmt(account.stamina)} → ${fmt(account.stamina + item.gain * options.count)} / 持有上限 ${fmt(account.limit)}\n道具库存 ${fmt(item.count)} → ${fmt(item.count - options.count)}；不消耗艾莉丝。`;
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
      const draft = { id: randomUUID(), domain, kind: options.kind, endpoint, body, description, trade, generation:this.generation, expiresAt: Date.now() + 60000, windowId: this.game.window.id };
      this.drafts.set(draft.id, draft); account.stages = this.status.account?.stages || []; account.routeId = this.status.account?.routeId || null; this.publish({ account, message: trade?'报价已读取，请确认金额与涨跌接受度。':'报价已读取，确认后仅提交一次。' });
      return { id: draft.id, description, expiresAt: draft.expiresAt };
    } finally { this.busy.delete(domain); this.publish(); }
  }

  async commit(id, { refresh = true } = {}) {
    const draft = this.drafts.get(id);
    if (!draft || draft.expiresAt < Date.now() || draft.windowId !== this.game.window?.id) throw new Error('报价已失效，请重新读取。');
    if (this.busy.has(draft.domain) || [...this.unresolved.values()].includes(draft.domain)) throw new Error('此类操作尚未结束。');
    this.drafts.delete(id); this.busy.add(draft.domain); this.publish();
    let attempts=0;
    try {
      const page = await this.page();
      for(let attempt=1;attempt<=(draft.trade?2:1);attempt++){
        const quote=draft.trade?await this.reprice(page,draft):null,body=quote?.body||draft.body;
        attempts=attempt;
        const receipt=await this.submitAttempt(page,{...draft,id:attempt===1?id:randomUUID(),body},attempt,attempt===1?null:id);
        if(draft.trade&&attempt===1&&isPriceConfirmation(receipt)){
          this.publish({message:'服务端要求价格确认，正在按原确认价核对涨跌接受度并重报一次。'});continue;
        }
        const result={...receipt,transactionId:id,attempts};
        if(attempt===2)result.message=receipt.ok?`${names[draft.kind]}已确认，自动重报1次；相对原报价${quote.move.changePct>=0?'上涨':'下跌'} ${fmt(Math.round(Math.abs(quote.move.changePct)*1e6)/1e6)}%。`:`${receipt.message}${isPriceConfirmation(receipt)?' 已重报1次，请重新报价。':''}`;
        this.publish({message:result.unknown?`${result.message} 结果未知，停止同类操作，请核对游戏。`:result.message});return result;
      }
    } catch (error) {
      const unknown=[...this.unresolved.values()].includes(draft.domain);
      const receipt={id,kind:draft.kind,ok:false,unknown,attempts,message:error.message};
      this.publish({message:unknown?`${receipt.message} 结果未知，请核对游戏。`:receipt.message,receipts:[...this.status.receipts.slice(-19),receipt]});return receipt;
    } finally {
      this.busy.delete(draft.domain); this.publish();
      if (refresh && !this.busyCount) await this.refresh(undefined, true).catch(() => {});
    }
  }

  async reprice(page,draft){
    if(draft.generation!==this.generation||draft.windowId!==this.game.window?.id||Date.now()>draft.expiresAt)throw Error('原确认报价或登录会话已失效，请重新报价。');
    const state=(await requestNative(page,draft.kind==='spot'?'/exchange/market':'/futures/state')).data,account=await readGameState(page);
    if(account.inBattle)throw Error('游戏仍在战斗中，请先完成战斗。');
    if(draft.generation!==this.generation||draft.windowId!==this.game.window?.id||Date.now()>draft.expiresAt)throw Error('原报价或登录会话发生变化，请重新报价。');
    return requoteTrade(draft.trade,state,account);
  }

  async submitAttempt(page,draft,attempt,retryOf){
    const id=draft.id;let submitted=false;
    const meta={attempt,...(retryOf?{retryOf}:{})};
    try{
      this.journal({id,domain:draft.domain,kind:draft.kind,state:'pending',input:draft.body,...meta});
      submitted=true;this.unresolved.set(id,draft.domain);
      const result=await requestNative(page,draft.endpoint,draft.body);
      if(result.status>=500||result.status===408)throw Object.assign(Error(result.error||'交易服务暂时不可用。'),{status:result.status,sentAt:result.sentAt,receivedAt:result.receivedAt});
      const receipt={id,kind:draft.kind,ok:result.ok,status:result.status,sentAt:result.sentAt,receivedAt:result.receivedAt,...meta,message:result.ok?`${names[draft.kind]}已由服务器确认。`:result.error||'服务器拒绝此操作。'};
      this.journal({...receipt,domain:draft.domain,state:'resolved'});this.unresolved.delete(id);
      this.publish({message:receipt.message,receipts:[...this.status.receipts.slice(-19),receipt]});return receipt;
    }catch(error){
      const outcome={ok:false,status:error.status,message:error.message};
      const rejected=submitted&&(error.status>=400&&error.status<500&&error.status!==408||isPriceConfirmation(outcome));
      const receipt={id,kind:draft.kind,...outcome,sentAt:error.sentAt,receivedAt:error.receivedAt,unknown:submitted&&!rejected,...meta};
      if(rejected){this.journal({...receipt,domain:draft.domain,state:'resolved'});this.unresolved.delete(id);}
      this.publish({message:receipt.unknown?`${receipt.message} 结果未知，停止同类操作，请核对游戏。`:receipt.message,receipts:[...this.status.receipts.slice(-19),receipt]});return receipt;
    }
  }

  planDraft(kind, body, description) {
    if (!['sweep','stamina','stamina-item'].includes(kind) || this.ledgerError || [...this.unresolved.values()].includes('sweep') || this.busy.has('sweep')) throw Error('扫荡/体力存在未确认操作，计划暂停。');
    const args=body?.args,quantity=Array.isArray(args)&&args.length===2&&typeof args[0]==='string'&&args[0].length>0&&Number.isSafeInteger(args[1])&&args[1]>=1;
    if (Object.keys(body||{}).join(',')!=='args' || (kind === 'stamina' ? JSON.stringify(body)!==JSON.stringify({args:['11000']}) : !quantity || (kind==='sweep'&&args[1]>100))) throw Error('计划请求参数无效。');
    const endpoint={sweep:'/rpc/battleSkip',stamina:'/rpc/shopBuy','stamina-item':'/rpc/useStaminaItem'}[kind];
    const draft = { id: randomUUID(), domain:'sweep', kind, endpoint, body, description, expiresAt:Date.now()+60000, windowId:this.game.window.id }; this.drafts.set(draft.id,draft); return draft;
  }

  acknowledge(domain) {
    if (!['spot', 'futures', 'sweep'].includes(domain) || this.busyCount) throw new Error('请选择已核对的空闲操作类型。');
    for (const [id, value] of this.unresolved) if (value === domain) { this.journal({ id, domain, state: 'acknowledged' }); this.unresolved.delete(id); }
    this.publish({ message: '已记录人工核对，不补发之前的操作。' });
  }
}

module.exports = { GameActions };
