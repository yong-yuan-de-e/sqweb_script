'use strict';

const { GachaAdapter } = require('../game/gacha-adapter');
const { readGachaPools } = require('../game/gacha-pools');

async function scanGachaPools({ page, signal, report, catalog }) {
  const game = new GachaAdapter(page, signal);
  report({ phase: 'running', message: '进入召唤卡池一览，只读取名称、类型与费用。' });
  await game.openList();
  const pools = await readGachaPools(page);
  const entries = await page.evaluate(() => {
    const result = [];
    const walk = (node, parents = []) => {
      if (!node?.active) return;
      const names = [...parents, node.name];
      if (names.includes('GachaListArea') && node.label && typeof node.onClick === 'function' && node.name === 'GachaListCell') result.push({ name: node.label, pathIncludes: 'GachaListArea/' });
      for (const child of node.children || []) walk(child, names);
    };
    walk(window.stage?.main); return result;
  });
  const records = pools.map(pool => {
    const verifiedUI = entries.filter(e => e.name === pool.name).length === 1;
    const modes = pool.buttons.filter(b => !b.ticket && b.cost > 0).map(b => b.count === 1 ? 'single' : 'ten');
    return { ...pool, pathIncludes: 'GachaListArea/', verifiedUI, modes: [...new Set(modes)], automatic: verifiedUI && modes.length > 0 && pool.kind !== 'assist' };
  });
  const result = catalog.save(records);
  report({ phase: 'completed', message: `已录入 ${records.length} 个卡池；只读列表，没有打开付费确认或抽卡。`, poolResult: { scannedAt: result.scannedAt, count: records.length } });
  return result;
}

module.exports = { scanGachaPools };
