'use strict';

const { numeric } = require('./market-values');

function parseExchangeDisplay(kind, data, sample) {
  let omitted = 0;
  const number = value => { if (value === null || value === undefined) return null; try { return numeric(value, '展示字段'); } catch { omitted += 1; return null; } };
  const text = value => typeof value === 'string' ? value.slice(0, 200) : null;
  const time = value => {
    if (value === null || value === undefined) return null;
    const valueMs = typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value) ? Date.parse(value) : Number(value);
    if (!Number.isSafeInteger(valueMs) || valueMs <= 0 || valueMs > 8640000000000000) { omitted += 1; return null; }
    return valueMs;
  };
  const list = (value, convert, limit) => {
    if (!Array.isArray(value)) return null;
    if (value.length > limit) omitted += value.length - limit;
    return value.slice(0, limit).filter(item => { if (!item || typeof item !== 'object' || Array.isArray(item)) { omitted += 1; return false; } return true; }).map(convert);
  };
  const chart = value => {
    const points = list(value, item => ({ t: time(item.t), price: number(item.price) }), 4096);
    return points && points.filter(point => { if (point.t !== null && point.price !== null) return true; omitted += 1; return false; }).sort((a, b) => a.t - b.t);
  };
  const result = { capturedAt: sample.capturedAt, values: sample.values };
  if (kind === 'spot') {
    result.wallet = data.wallet && typeof data.wallet === 'object' && !Array.isArray(data.wallet)
      ? { money: number(data.wallet.money), tickets: number(data.wallet.tickets) } : null;
    result.orders = list(data.myTrades, item => ({ at: time(item.at), side: ['buy', 'sell'].includes(item.side) ? item.side : null,
      qty: number(item.qty), money: number(item.money), avg: number(item.avg) }), 200);
    result.chart = chart(data.history);
    result.liquidity = number(data.liquidity);
    result.enabled = typeof data.enabled === 'boolean' ? data.enabled : null;
    result.reason = text(data.tradeBlockReason);
  } else {
    result.openPrice = number(data.openPrice);
    const round = data.round;
    result.round = round && typeof round === 'object' && !Array.isArray(round)
      ? { id: number(round.id), status: text(round.status), settleAt: time(round.settleAt), cutoffAt: time(round.cutoffAt) } : null;
    result.positions = list(data.myPositions, item => ({ id: typeof item.id === 'string' ? item.id.slice(0, 100) : number(item.id),
      side: ['long', 'short'].includes(item.side) ? item.side : null, margin: number(item.margin), entry: number(item.entry),
      leverage: number(item.effLeverage ?? item.leverage), liqPrice: number(item.liqPrice), pnl: number(item.pnl),
      lockedPnl: number(item.lockedPnl), debt: number(item.debt), exit: number(item.exit), notional: number(item.notional),
      status: text(item.status), createdAt: time(item.createdAt) }), 200);
    result.settlements = list(data.history, item => ({ id: number(item.id ?? item.roundId), settleAt: time(item.settleAt),
      settlePrice: number(item.settlePrice ?? item.settle_price), myPnl: number(item.myPnl ?? item.pnl) }), 100);
    result.chart = chart(data.chart);
    result.eligible = typeof data.eligible === 'boolean' ? data.eligible : null;
    result.reason = text(data.reason);
  }
  result.omitted = omitted;
  return result;
}

module.exports = { parseExchangeDisplay };
