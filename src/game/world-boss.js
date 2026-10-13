'use strict';

const {nativeContext}=require('./native-bridge');

// 世界Boss不是普通stageInfo关卡；只读取原站home，返回白名单，不保留排名或个人战斗日志。
async function readWorldBoss(page){
  const info=await nativeContext(page);if(!info.worldBossNet)throw Error('当前游戏未提供世界Boss模块。');
  return page.evaluate(async url=>{const api=await import(url);if(typeof api.wbHomeApi!=='function')throw Error('世界Boss读取接口已改变。');const home=await api.wbHomeApi(),c=home.config;if(!c||typeof c.id!=='string'||typeof c.name!=='string')throw Error('世界Boss公共信息不完整。');return {id:c.id,name:c.name,enemy:c.enemy,art:c.art,start:c.start,end:c.end,dailyTries:c.dailyTries,triesLeft:home.triesLeft,triesMax:home.triesMax,pending:Boolean(home.me?.pending),closed:home.closed||null};},info.worldBossNet);
}

module.exports={readWorldBoss};
