'use strict';

const { origin } = require('../shared/config');
const cache = new WeakMap();

async function nativeContext(page) {
  if (new URL(page.url()).origin !== origin) throw new Error('游戏页面不在SQWeb，已停止。');
  const entry = await page.evaluate(() => [...document.scripts].map(script => script.src).find(url => /\/index-[^/]+\.js$/.test(url)));
  const cached = cache.get(page);
  if (cached?.entry === entry) return cached;
  const info = await page.evaluate(async entry => {
    if (!entry || new URL(entry).origin !== location.origin) throw Error('无法识别当前游戏入口。');
    const source = async url => { const response = await fetch(url); if (!response.ok) throw Error('游戏公开模块无法读取。'); return response.text(); };
    const index = await source(entry);
    const locate = (text, name, base = entry) => { const match = text.match(new RegExp('\\./' + name + '-[A-Za-z0-9_-]+\\.js')); if (!match) throw Error('游戏模块结构改变：' + name); return new URL(match[0], base).href; };
    const net = locate(index, 'net'), save = locate(index, 'save'), member = locate(index, 'member'), master = locate(index, 'master');
    const [netText, memberText, masterText] = await Promise.all([source(net), source(member), source(master)]);
    const alias = (text, symbol) => { const exports = [...text.matchAll(/export\{([^}]+)\}/g)].at(-1)?.[1]; const name = exports?.split(',').map(x => x.trim().split(/\s+as\s+/)).find(x => x[0] === symbol)?.[1]; if (!name) throw Error('游戏接口导出改变：' + (symbol || '未识别的函数')); return name; };
    const direct = netText.match(/function (\w+)\(e,t,n\)\{return \w+\(e,t,n,\{authLost:!0,timeoutMs:\w+\}\)\}/)?.[1];
    if (!direct) throw Error('游戏请求接口改变，未提交操作。');
    const memberAlias = name => { const symbol = memberText.match(new RegExp(name + ':\\(\\)=>([\\w$]+)'))?.[1]; return alias(memberText, symbol); };
    const version = locate(index, 'v59'), versionText = await source(version), quest = locate(versionText, 'quest59', version), questText = await source(quest);
    return { entry, net, save, member, master, io: locate(masterText, 'io', master), direct: alias(netText, direct),
      stageInfo: memberAlias('stageInfo'), hardTicket: locate(questText, 'mainHardTicket', quest), worldBossNet: /\.\/worldbossNet-/.test(index) ? locate(index,'worldbossNet') : null };
  }, entry);
  cache.set(page, info); return info;
}

async function readGameState(page, route, sync = false) {
  if(route?.activity?.kind==='worldboss'){
    const account=await readGameState(page,undefined,sync),boss=await require('./world-boss').readWorldBoss(page),stage=route.stages[0];
    if(!stage||stage.id!==boss.id)return {...account,stageError:'世界Boss已轮换，请重新录入当前Boss。'};
    return {...account,worldBoss:boss,stages:[{id:boss.id,label:boss.name,stamina:0,skip:false,locked:Boolean(boss.closed),challengeLeft:boss.triesLeft,kind:'worldboss',manualBattle:true}]};
  }
  const info = await nativeContext(page);
  return page.evaluate(async ({ info, route, sync }) => {
    const [net, save, member, master] = await Promise.all([import(info.net), import(info.save), import(info.member), import(info.master)]);
    if (sync) await net[info.direct]('GET', '/auth/me');
    const api = Object.values(save).find(value => value && typeof value === 'object' && typeof value.stamina === 'function' && typeof value.count === 'function');
    if (!api) throw Error('存档接口已改变。');
    const economy = await master.s();
    const shop = economy.shop.find(item => item.id === '11000');
    const current = api.save();
    const result = { capturedAt: new Date().toISOString(), stamina: api.stamina(), maximum: api.staminaMax(), nextSeconds: api.staminaNext(), limit: api.STAMINA_LIMIT,
      money: api.money(), tickets: api.count(8, '1'), inBattle: Boolean(current.battle), recovery: shop ? { id: '11000', cost: master.pt(shop.price[2]),
        gain: shop.get.find(([type]) => type === 9)?.[2] ?? null, remaining: Number.isFinite(api.remaining('shop:11000', shop.limit)) ? api.remaining('shop:11000', shop.limit) : null } : null, stages: [] };
    if (!route) return result;
    if (route.activity) {
      const stages = route.activity.stages || [];
      if (!stages.length || stages.some(s => !s.id)) return { ...result, stageError: '活动关卡尚未人工关联真实ID；可查看已录入按钮，适配后再作战/扫荡。' };
      for (const stage of stages) { const details = await member[info.stageInfo](String(stage.id)); result.stages.push({ id: String(stage.id), label: stage.label, detailLabel:stage.detailLabel, stamina: details.stamina, skip: Boolean(details.skip), locked: Boolean(details.lockedBy?.length), challengeLeft: Number.isFinite(details.challengeLeft) ? details.challengeLeft : null, selector: stage.selector || route.activity.stageSelector }); }
      return result;
    }
    const part = route.steps.flatMap(step => step.labels || []).map(label => label.match(/^第?(\d+)部$/)).find(Boolean)?.[1];
    const chapter = route.steps.map(step => step.labelPrefix || step.labels?.[0] || '').find(label => /^第\d+章/.test(label));
    const difficulty = route.steps.some(step => step.labels?.includes('HARD')) ? '2' : route.steps.some(step => step.labels?.includes('EXPERT')) ? '3' : '1';
    if (!part || !chapter) return { ...result, stageError: '此路线不是主线章配置，暂时不能自动关联扫荡关卡。' };
    const io = await import(info.io), quests = await io.i('master/quest59.json');
    const chapterNumber = chapter.match(/^第(\d+)章/)?.[1];
    const areas = quests.areas.filter(area => String(area.part) === part && String(area.area) === chapterNumber);
    if (areas.length !== 1) return { ...result, stageError: '主线章匹配不唯一，未猜测关卡ID。' };
    for (const stage of areas[0].modes[difficulty]?.stages || []) {
      const details = await member[info.stageInfo](String(stage.id));
      result.stages.push({ id: String(stage.id), label: stage.title, stamina: details.stamina, skip: Boolean(details.skip),
        locked: Boolean(details.lockedBy?.length), challengeLeft: Number.isFinite(details.challengeLeft) ? details.challengeLeft : null });
    }
    return result;
  }, { info, route, sync });
}

async function requestNative(page, endpoint, body) {
  const allowed = new Set(['/exchange/market', '/futures/state', '/exchange/trade', '/exchange/withdraw', '/futures/open', '/futures/close', '/futures/addMargin', '/rpc/battleSkip', '/rpc/shopBuy', '/rpc/releasedGachaPools', '/rpc/gachaDraw', '/auth/me']);
  if (!allowed.has(endpoint)) throw new Error('不允许的游戏操作。');
  const info = await nativeContext(page), sentAt = new Date().toISOString();
  let observed, request;
  const observe = response => {
    if (response.url() !== origin + '/api' + endpoint || response.request().method() !== (body ? 'POST' : 'GET')) return;
    if (body && response.request().postData() !== JSON.stringify(body)) return;
    observed = response.status();
  };
  const outgoing = candidate => { if (candidate.url() === origin + '/api' + endpoint && candidate.method() === (body ? 'POST' : 'GET') && (!body || candidate.postData() === JSON.stringify(body))) request = new Date().toISOString(); };
  page.on('response', observe); page.on('request', outgoing);
  try {
    const result = await page.evaluate(async ({ info, endpoint, body }) => { const net = await import(info.net); const response = await net[info.direct](body ? 'POST' : 'GET', endpoint, body);
      return { ok: response.ok !== false && response.data?.ok !== false, error: response.data?.error || response.error || null, code: response.data?.code ?? response.code ?? null, data: response.data?.data ?? response.data }; }, { info, endpoint, body });
    return { ...result, status: observed, sentAt: request || sentAt, receivedAt: new Date().toISOString() };
  } catch (error) {
    const failure = new Error(String(error.message || '游戏请求失败。').split('\n')[0]);
    failure.status = observed; failure.sentAt = request || sentAt; failure.receivedAt = new Date().toISOString(); throw failure;
  } finally { page.off('response', observe); page.off('request', outgoing); }
}

async function sweepCost(page, id, count) {
  const info = await nativeContext(page);
  return page.evaluate(async ({ info, id, count }) => { const member = await import(info.member); const stage = await member[info.stageInfo](id); const hard = await import(info.hardTicket); return { ...stage, tickets: count + (stage.hard ? hard.t(count, stage.hard.used) : 0) }; }, { info, id, count });
}

module.exports = { nativeContext, readGameState, requestNative, sweepCost };
