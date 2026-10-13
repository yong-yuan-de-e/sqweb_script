'use strict';

const { runSingleBattle }=require('./single-battle');
const { GameAdapter }=require('../game/adapter');
const { readGameState }=require('../game/native-bridge');
const selectors=require('../game/selectors');

async function runCampaign({page,signal,report,artifacts,route,stageId,catalog,autoNext=false,limit=0,onState=()=>{}}){
  const game=new GameAdapter(page,signal);let completed=0,resume=false,currentRoute=route,currentStage=stageId;
  while(true){
    signal?.throwIfAborted();const state=await readGameState(page,currentRoute,true);state.routeId=currentRoute.id;onState(state);
    report({phase:'running',message:`执行${currentRoute.name} / ${state.stages.find(s=>s.id===currentStage)?.label||currentStage}，已完成${completed}关。`,campaignState:{selection:currentRoute.selection,stageId:currentStage,completed}});
    await runSingleBattle({page,signal,report:e=>report({...e,phase:e.phase==='completed'?'running':e.phase}),artifacts,route:currentRoute,stageId:currentStage,resume,forceNew:!resume});completed++;
    if(!autoNext||(limit>0&&completed>=limit))break;
    const next=catalog.next(currentRoute.selection,currentStage);if(!next){report({phase:'completed',message:`自动推图完成${completed}关，目录没有下一关。`});return;}
    const nextState=await readGameState(page,next.route,true),stage=nextState.stages.find(s=>s.id===next.stage.id);nextState.routeId=next.route.id;onState(nextState);
    if(!stage||stage.locked||stage.challengeLeft===0||stage.stamina>nextState.stamina){report({phase:'completed',message:`已完成${completed}关；下一关未解锁、次数用完或体力不足，停止推图。`});return;}
    const button={labels:['下一关'],pathIncludes:'/WinResult/SecondView/'};
    if(currentRoute.id===next.route.id&&await game.has(button)){
      await game.click(button,'原站下一关');
      // 下一关直接发送battleStart；旧详情页的挑战按钮可能仍在下层，不能当作准备完成。
      await game.waitFor(selectors.auto,'原站下一关战斗画面',90000);resume=true;
    }else{resume=false;}
    currentRoute=next.route;currentStage=next.stage.id;
  }
  report({phase:'completed',message:`作战完成${completed}关，停留在结算。`,campaignState:{selection:currentRoute.selection,stageId:currentStage,completed}});
}

module.exports={runCampaign};
