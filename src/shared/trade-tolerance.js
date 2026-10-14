'use strict';

function tradeTolerance(value = {}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('请填写上涨和下跌接受度。');
  const result={upPct:value.upPct??2,downPct:value.downPct??2};
  for(const [key,label] of [['upPct','上涨'],['downPct','下跌']])if(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<0||result[key]>10000)throw Error(`${label}接受度应为0至10,000%的数字。`);
  return result;
}

function priceMovement(baseline,current,tolerance) {
  if(!Number.isFinite(baseline)||!Number.isFinite(current))throw Error('价格无效，未自动重报。');
  if(baseline===0&&current!==0)throw Error('原报价为零，无法计算涨跌幅，请重新报价。');
  const changePct=baseline===0?0:(current-baseline)/Math.abs(baseline)*100;
  const allowed=changePct>=0?tolerance.upPct:tolerance.downPct;
  const epsilon=Number.EPSILON*Math.max(1,Math.abs(changePct),allowed)*8;
  if(!Number.isFinite(changePct)||Math.abs(changePct)>allowed+epsilon)throw Error(`价格${changePct>=0?'上涨':'下跌'} ${Math.abs(changePct).toLocaleString('en-US',{maximumFractionDigits:6})}%，超过允许的 ${allowed}%；已停止，请重新报价。`);
  return {baseline,current,changePct};
}

// 只识别明确的价格确认业务拒绝。超时、限流、服务故障或成功回执均不重发。
function isPriceConfirmation(outcome) {
  if(outcome.ok!==false||outcome.unknown||![200,400,409,422].includes(outcome.status))return false;
  return /^(?:Error:\s*)?价格(?:变动|波动)(?:太大|过大|幅度过大)?[，,:：\s]*(?:请)?(?:重新确认|需要确认|确认新价格|再次确认)[。.!！]?$/.test(String(outcome.message||'').trim());
}

if(typeof module!=='undefined'&&module.exports)module.exports={tradeTolerance,priceMovement,isPriceConfirmation};
else window.tradeTolerance=tradeTolerance;
