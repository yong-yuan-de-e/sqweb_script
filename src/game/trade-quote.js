'use strict';

// 与原站sweep59的积分报价及整数取整一致，不能用现价乘数量替代。
function spotQuote(side, price, quantity, stock, config) {
  for (const key of ['minPrice', 'maxPrice', 'minLiquidity', 'liquidityRatio', 'feeRate', 'maxPerTrade']) if (!Number.isFinite(config?.[key])) throw new Error('交易配置缺失，请重新读取行情。');
  if (config.liquidityRatio <= 0 || config.minLiquidity <= 0) throw new Error('交易流动性配置异常。');
  const clamp = value => Math.max(config.minPrice, Math.min(config.maxPrice, value));
  const qty = quantity, sign = side === 'buy' ? 1 : -1, boundary = config.minLiquidity / config.liquidityRatio, factor = 1 / config.liquidityRatio;
  const cap = side === 'buy' ? config.maxPrice : config.minPrice;
  let current = clamp(price), supply = Math.max(0, stock), left = qty, gross = 0;
  for (let iteration = 0; left > 0 && iteration < 4; iteration += 1) {
    if (current === cap) { gross += current * left; left = 0; break; }
    const elastic = supply > boundary || side === 'buy' && supply >= boundary;
    const crossing = elastic ? side === 'buy' ? Infinity : supply - boundary : side === 'buy' ? boundary - supply : Infinity;
    const limit = elastic ? sign * supply * Math.expm1(Math.log(cap / current) / factor) : sign * config.minLiquidity * Math.log(cap / current);
    const portion = Math.min(left, Math.max(0, crossing), Math.max(0, limit));
    if (portion === 0) { current = cap; continue; }
    const exponent = elastic ? Math.log1p(sign * portion / supply) : sign * portion / config.minLiquidity;
    gross += elastic ? current * supply / (factor + 1) * Math.abs(Math.expm1((factor + 1) * exponent)) : current * config.minLiquidity * Math.abs(Math.expm1(exponent));
    current = portion === limit ? cap : clamp(current * Math.exp(elastic ? factor * exponent : exponent));
    supply = portion === crossing ? boundary : Math.max(0, supply + sign * portion); left -= portion;
  }
  const ceil = value => Math.ceil(value - 1e-6), floor = value => Math.floor(value + 1e-6), fee = ceil(gross * config.feeRate);
  const money = side === 'buy' ? ceil(gross) + fee : Math.max(0, floor(gross) - fee);
  if (!Number.isSafeInteger(money)) throw new Error('报价金额超出精确整数范围。');
  return { qty, money, fee, average: money / qty, after: current, limit: side === 'buy' ? Math.ceil(money * 1.02) : Math.floor(money * .98) };
}

module.exports = { spotQuote };
