'use strict';

const { origin } = require('../shared/config');
const contexts = new WeakMap();

// 从本次页面公开模块定位原站的只读 releasedGachaPools，不保存认证信息。
async function readGachaPools(page) {
  if (new URL(page.url()).origin !== origin) throw new Error('游戏页面已离开SQWeb。');
  const entry = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/index-[^/]+\.js$/.test(src)));
  let context = contexts.get(page);
  if (context?.entry !== entry) {
    context = await page.evaluate(async entry => {
      const text = async url => { const r = await fetch(url); if (!r.ok) throw Error('无法读取公开卡池模块。'); return r.text(); };
      const locate = (source, name, base) => { const m = source.match(new RegExp('\\./' + name + '-[\\w-]+\\.js')); if (!m) throw Error('卡池模块结构改变：' + name); return new URL(m[0], base).href; };
      const version = locate(await text(entry), 'v59', entry), screen = locate(await text(version), 'gacha59', version);
      const url = locate(await text(screen), 'gacha', screen), source = await text(url);
      const symbol = source.match(/(\w+)=\w+\([`'"]releasedGachaPools[`'"]\)/)?.[1];
      const parts = [...source.matchAll(/export\{([^}]+)\}/g)].at(-1)?.[1]?.split(',').map(p => p.trim().split(/\s+as\s+/));
      const found = parts?.find(p => p[0] === symbol), exported = found?.[1] || found?.[0];
      if (!exported) throw Error('无法识别只读卡池接口，未执行召唤。');
      return { entry, url, exported };
    }, entry);
    contexts.set(page, context);
  }
  const pools = await page.evaluate(async context => { const module = await import(context.url); return module[context.exported](); }, context);
  if (!Array.isArray(pools) || pools.length > 200) throw new Error('原站卡池列表格式改变。');
  return pools.map(pool => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(pool.id)) || typeof pool.name !== 'string' || !pool.name || pool.name.length > 200) throw new Error('卡池ID或名称无效。');
    return { id: String(pool.id), name: pool.name, kind: typeof pool.kind === 'string' ? pool.kind.slice(0, 60) : '召唤',
      schedule: typeof pool.schedule === 'string' ? pool.schedule.slice(0, 300) : '',
      buttons: (Array.isArray(pool.buttons) ? pool.buttons : []).filter(b => [1, 10].includes(b.count) && typeof b.button === 'string' && Number.isSafeInteger(b.cost) && b.cost >= 0)
        .map(b => ({ button: b.button.slice(0, 30), count: b.count, cost: b.cost, currency: b.ticket === true ? '召唤券' : '艾莉丝', ticket: Boolean(b.ticket),
          baseCost: Number.isSafeInteger(b.baseCost) ? b.baseCost : null })) };
  });
}

module.exports = { readGachaPools };
