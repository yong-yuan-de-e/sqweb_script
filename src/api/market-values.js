'use strict';

function numeric(value, label) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`行情接口缺少 ${label}。`);
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error(`${label} 超出精确数值范围。`);
  const match = String(value).match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) throw new Error(`${label} 不是有效数值。`);
  const fraction = match[3] || '', exponent = Number(match[4] || 0);
  if (Math.abs(exponent) > 100) throw new Error(`${label} 数值范围异常。`);
  let digits = BigInt(match[2] + fraction).toString();
  if (digits === '0') return '0';
  const scale = fraction.length - exponent;
  if (scale <= 0) digits += '0'.repeat(-scale);
  else { digits = digits.padStart(scale + 1, '0'); digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, ''); }
  return match[1] === '-' ? '-' + digits : digits;
}

function fraction(value) {
  const negative = value.startsWith('-'), [whole, decimals = ''] = value.replace(/^-/, '').split('.');
  return { integer: BigInt(whole + decimals) * (negative ? -1n : 1n), scale: 10n ** BigInt(decimals.length) };
}

function periodChange(price, opening) {
  const current = fraction(price), start = fraction(opening);
  if (start.integer <= 0n) throw new Error('期货接口没有有效的本期开盘价。');
  const numerator = (current.integer * start.scale - start.integer * current.scale) * 100n;
  const denominator = current.scale * start.integer;
  const negative = numerator < 0n, absolute = negative ? -numerator : numerator;
  // 本期涨幅由当前价与本期开盘价推导，百分数保留六位小数。
  const scaled = (absolute * 1000000n * 2n + denominator) / (denominator * 2n);
  const text = numeric(`${scaled / 1000000n}.${(scaled % 1000000n).toString().padStart(6, '0')}`, '本期涨幅');
  return negative && text !== '0' ? '-' + text : text;
}

function parseMarketApi(kind, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('行情接口数据结构异常。');
  const read = (value, label) => numeric(value, label);
  if (kind === 'spot') {
    const change = read(data.change24h, '24小时涨跌');
    const ratio = fraction(change);
    const decimals = change.replace(/^-/, '').split('.')[1]?.length || 0;
    const values = { price: read(data.price, '现价'), fair_price: read(data.fair, '基本面价'), stock: read(data.stock, '全服存量'),
      turnover_24h: read(data.volume24h, '24小时换手'), price_index: read(data.index, '物价指数'),
      change_24h_pct: numeric(`${ratio.integer * 100n}e-${decimals}`, '24小时涨跌百分数') };
    return { values, raw: { price: String(data.price), fair_price: String(data.fair), stock: String(data.stock),
      turnover_24h: String(data.volume24h), price_index: String(data.index), change_24h_pct: String(data.change24h) } };
  }
  if (kind === 'futures') {
    const long = data.pools?.long, short = data.pools?.short;
    const price = read(data.index, '期货当前价'), opening = read(data.openPrice, '本期开盘价');
    const change = periodChange(price, opening);
    return { values: { price, period_change_pct: change, long_people: read(long?.count, '多头人数'), long_funds: read(long?.margin, '多头资金'),
      short_people: read(short?.count, '空头人数'), short_funds: read(short?.margin, '空头资金') },
      raw: { price: String(data.index), period_change_pct: `index=${data.index};openPrice=${data.openPrice}`,
        long: `count=${long.count};margin=${long.margin}`, short: `count=${short.count};margin=${short.margin}` } };
  }
  throw new Error('未知行情类型。');
}

module.exports = { parseMarketApi, numeric };
