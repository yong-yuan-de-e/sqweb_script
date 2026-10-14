'use strict';

const { randomUUID }=require('node:crypto');
const { spotQuote }=require('./trade-quote');
const { tradeTolerance,priceMovement }=require('../shared/trade-tolerance');
const { formatNumber:fmt }=require('../shared/number-format');
const integer=(n,label)=>{if(!Number.isSafeInteger(n)||n<1)throw Error(`${label}应为正整数。`);return n;};

function percentageFraction(value){
  const [mantissa,exponent='0']=String(value).toLowerCase().split('e'),decimals=mantissa.split('.')[1]?.length||0,scale=decimals-Number(exponent);
  return {n:BigInt(mantissa.replace('.',''))*(scale<0?10n**BigInt(-scale):1n),d:scale>0?10n**BigInt(scale):1n};
}

function moneyBound(money,percent,up){
  const {n,d}=percentageFraction(percent),denominator=100n*d,numerator=BigInt(money)*(up?denominator+n:denominator-n);
  if(numerator<=0n)return 0;
  const bound=up?numerator/denominator:(numerator+denominator-1n)/denominator;
  return Number(bound>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):bound);
}

function spotLimit(originalMoney,side,tolerance){
  return moneyBound(originalMoney,side==='buy'?tolerance.upPct:tolerance.downPct,side==='buy');
}

const toleranceText=t=>`相对本次确认报价：允许上涨 ${fmt(t.upPct)}%、下跌 ${fmt(t.downPct)}%（按实际价格方向）。\n仅在服务端明确要求价格确认时自动重报1次，超范围停止。`;

function createTrade(options,state,account,now=Date.now()){
  const kind=options.kind,tolerance=tradeTolerance(options.tolerance);let endpoint,body,description,baselinePrice,baselineMoney,roundId;
  if(kind==='spot'){
    if(!['buy','sell'].includes(options.side))throw Error('请选择买入或卖出。');
    const qty=integer(options.qty,'张数');
    if(!state.enabled||state.config?.enabled===false||state.tradeBlockReason)throw Error(state.tradeBlockReason||'现货暂停交易。');
    if(qty>state.config?.maxPerTrade)throw Error('张数超过原站单笔上限。');
    if(!Number.isFinite(state.price)||!Number.isFinite(state.stock))throw Error('现货报价缺失。');
    const quote=spotQuote(options.side,state.price,qty,state.stock,state.config);
    let limit=spotLimit(quote.money,options.side,tolerance);
    if(options.side==='buy'&&quote.money>account.money)throw Error('艾莉丝不足以覆盖现货报价。');
    if(options.side==='buy')limit=Math.min(limit,account.money);
    if(options.side==='sell'&&qty>account.tickets)throw Error('跳过券不足。');
    if(state.vanir){
      if(!Number.isFinite(state.vanir.cash)||!Number.isFinite(state.vanir.tickets)||state.vanir.cash<0||state.vanir.tickets<0)throw Error('巴尼尔库存数据异常。');
      if(options.side==='buy'&&qty>state.vanir.tickets)throw Error(`巴尼尔库存跳过券不足，目前 ${fmt(state.vanir.tickets)} 张。`);
      if(options.side==='sell'&&quote.money>state.vanir.cash)throw Error('巴尼尔的艾莉丝库存不足以收购。');
    }
    endpoint='/exchange/trade';body={side:options.side,qty,limit,requestId:randomUUID()};baselinePrice=quote.average;baselineMoney=quote.money;
    description=`${options.side==='buy'?'买入':'卖出'} ${fmt(qty)} 张\n预计${options.side==='buy'?'花费':'到手'} ${fmt(quote.money)} 艾莉丝，含手续费 ${fmt(quote.fee)}\n含费均价 ${fmt(quote.average)}；本次金额限价 ${fmt(limit)}。\n${toleranceText(tolerance)}`;
  }else if(kind==='futures'||kind==='close'){
    const config=state.config;
    if(!Number.isFinite(state.index)||!['maxLeverage','openFeeRate','maxNotionalPerUser','maintenance','minHoldMinutes'].every(k=>Number.isFinite(config?.[k])))throw Error('期货报价配置缺失。');
    baselinePrice=state.index;roundId=state.round?.id;
    if(kind==='futures'){
      if(!['long','short'].includes(options.side))throw Error('请选择看涨或看跌。');
      const margin=integer(options.margin,'保证金'),leverage=integer(options.leverage,'杠杆');
      if(leverage>config.maxLeverage)throw Error('杠杆超过原站上限。');
      if(!state.eligible||!config.enabled||state.round?.status!=='open'||now>=state.round.cutoffAt)throw Error(state.reason||'本期不可开仓。');
      const notional=margin*leverage,fee=Math.ceil(Math.round(notional*config.openFeeRate*1e6)/1e6);
      if(!Number.isSafeInteger(notional)||notional>config.maxNotionalPerUser)throw Error('名义价值超过原站上限。');
      if(margin+fee>account.money)throw Error('保证金与手续费超过余额。');
      const distance=(1-config.maintenance)*Math.max(Math.abs(state.index),1)/leverage,liquidation=options.side==='long'?state.index-distance:state.index+distance;
      endpoint='/futures/open';body={side:options.side,margin,leverage,requestId:randomUUID()};
      description=`${options.side==='long'?'看涨':'看跌'}开仓\n保证金 ${fmt(margin)}，杠杆 ${leverage}×，名义价值 ${fmt(notional)}，手续费 ${fmt(fee)}\n参考开仓价 ${fmt(state.index)}，参考爆仓价 ${fmt(liquidation)}。`;
    }else{
      const position=state.myPositions?.find(p=>String(p.id)===String(options.positionId));
      if(!position||position.status!=='open')throw Error('仓位不存在或已结束。');
      const left=position.createdAt+config.minHoldMinutes*60000-now;
      if(left>0)throw Error(`尚需持仓 ${Math.ceil(left/1000)} 秒才能平仓。`);
      endpoint='/futures/close';body={positionId:position.id};
      description=`平仓 ${position.id}\n方向 ${position.side}，保证金 ${fmt(position.margin)}，参考价 ${fmt(state.index)}，当前盈亏 ${fmt(position.pnl)}。盈利按原站规则结算。`;
    }
    description+=`\n${toleranceText(tolerance)}\n期货接受度按提交前标记价核对，实际成交价由原站确定。`;
  }else throw Error('未知价格交易类型。');
  const frozen={kind,...(kind==='spot'?{side:options.side,qty:options.qty}:kind==='futures'?{side:options.side,margin:options.margin,leverage:options.leverage}:{positionId:options.positionId}),tolerance};
  return {endpoint,body,description,trade:{options:frozen,tolerance,baselinePrice,baselineMoney,roundId}};
}

function requoteTrade(trade,state,account){
  const fresh=createTrade(trade.options,state,account);
  if(trade.options.kind!=='spot'&&fresh.trade.roundId!==trade.roundId)throw Error('期货期次已经变化，请重新确认。');
  const move=priceMovement(trade.baselinePrice,fresh.trade.baselinePrice,trade.tolerance);
  if(trade.options.kind==='spot'){
    fresh.body.limit=spotLimit(trade.baselineMoney,trade.options.side,trade.tolerance);
    if(trade.options.side==='buy')fresh.body.limit=Math.min(fresh.body.limit,account.money);
  }
  return {...fresh,trade,move};
}

module.exports={createTrade,requoteTrade,spotLimit};
