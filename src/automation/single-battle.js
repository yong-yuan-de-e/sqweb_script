'use strict';

const selectors = require('../game/selectors');
const config = require('../shared/config');
const { GameAdapter } = require('../game/adapter');
const { waitUntil } = require('./wait');
const { readGameState } = require('../game/native-bridge');
const { navigateRoute } = require('../maps/navigation');

async function runSingleBattle({ page, signal, report, artifacts, route, stageId, resume = false, forceNew = false }) {
  const game = new GameAdapter(page, signal);
  const step = (message) => report({ phase: 'running', message });
  const isSettlement = snapshot => snapshot.buttons.some(button => ['再战','下一关','返回列表','下一步'].includes(button.label) && button.path.includes('/WinResult/SecondView/'));
  let stageLabel = '1章-1', detailLabel=stageLabel;
  const complete = async (message = `${stageLabel} 单次作战已结算，停留在结果页面。`) => {
    let growthAdvanced = false;
    await waitUntil(async () => {
      const snapshot = await game.inspect();
      game.checkProblem(snapshot);
      if(snapshot.buttons.some(b=>/LoseResult|DefeatResult|Battleresult_Lose/.test(b.path)))throw Error('本关战败，自动推图已停止。');
      if (!growthAdvanced && snapshot.buttons.some(button => button.label === '下一步' && button.path.includes(selectors.growthNext.pathIncludes))) {
        growthAdvanced = true;
        step('作战获胜，进入最终报酬页面');
        await game.click(selectors.growthNext, '成长结算的下一步');
        return false;
      }
      return isSettlement(snapshot) && snapshot;
    }, { signal, timeout: config.timeouts.battle, description: '最终报酬结算', interval: config.timeouts.poll });
    const screenshot = await artifacts.capture(page, 'settlement');
    report({ phase: 'completed', message, screenshot });
    return { screenshot };
  };
  step('检查登录状态和冒险入口');
  if (isSettlement(await game.inspect()) && !forceNew) {
    step('已在结算页面，确认并保存当前结果');
    return complete('当前作战已结算，已保存结果页面；没有再次挑战。');
  }
  if(isSettlement(await game.inspect())&&forceNew){await game.click({labels:['返回列表','下一步'],pathIncludes:'/WinResult/SecondView/'},'返回关卡列表');}
  if (await game.has(selectors.auto) && !resume) throw new Error('当前已有战斗进行中，请先完成当前战斗再运行。');
  let alreadyBattle=resume&&await game.has(selectors.auto),alreadyPrepare=resume&&await game.has(selectors.start);
  if (route) {
    const state = await readGameState(page, route, true), selected = state.stages.find(s => s.id === stageId);
    if (!selected || selected.locked || (!alreadyBattle&&(selected.challengeLeft === 0 || selected.stamina > state.stamina || state.inBattle))) throw new Error(state.stageError || '关卡、前置解放、挑战次数或体力不满足作战条件。');
    stageLabel = selected.label;
    detailLabel=selected.detailLabel||stageLabel;
    if(!resume||(!alreadyBattle&&!alreadyPrepare&&!await game.has(selectors.challenge))){
      await navigateRoute(game, route, signal, report);
      if(route.activity?.eventName&&!(await game.inspect()).texts.some(t=>t.trim()===route.activity.eventName))throw Error('当前活动已变更，与录入活动名称不一致，请重新录入后再挑战。');
      const stageSelector = selected.selector || { labels: [stageLabel], pathIncludes: 'QuestStageItemCell' };
      await game.revealStage(stageSelector);await game.navigate(stageSelector, selectors.challenge, stageLabel);
    }
  } else {
  await game.waitFor(selectors.adventure, '登录后的冒险入口');
  step('进入冒险 → 主线任务');
  await game.navigate(selectors.adventure, selectors.mainQuest, '冒险');
  await game.navigate(selectors.mainQuest, selectors.part, '主线任务');
  step('选择第1部 · NORMAL · 第1章');
  await game.navigate(selectors.part, selectors.chapter, '第1部');
  if (await game.has(selectors.normal)) await game.click(selectors.normal, 'NORMAL 难度');
  await game.navigate(selectors.chapter, selectors.stage, '第1章');
  await game.navigate(selectors.stage, selectors.challenge, '1章-1');
  }
  if(!alreadyBattle){
    const detail = await game.inspect();
    if (!detail.texts.some(text => text.trim() === detailLabel)) throw new Error('关卡详情未确认是所选关卡，停止挑战。');
    if(!alreadyPrepare){step(`挑战 ${stageLabel}，进入队伍确认`);await game.click(selectors.challenge,'挑战');await game.waitFor(selectors.start,'队伍确认');}
    step('开始单次战斗');await game.click(selectors.start,'战斗开始');await game.waitFor(selectors.auto,'战斗画面',90000);
  }
  step('开启 AUTO 和快进');
  let controls = await game.battleControls();
  if (controls.auto === null || controls.speed === null) throw new Error('无法读取 AUTO/快进状态，请在游戏窗口确认控件。');
  if (!controls.auto) await game.click(selectors.auto, 'AUTO');
  if (controls.speed === 0) await game.click(selectors.speed, '快进');
  await waitUntil(async () => {
    controls = await game.battleControls();
    return controls.auto === true && controls.speed > 0;
  }, { signal, timeout: 5000, description: 'AUTO 和快进已开启' });
  step('AUTO、快进已开启，等待结算');
  // 成长画面的下一步只推进到最终报酬面板，不点击再战或下一关。
  return complete();
}

module.exports = { runSingleBattle };
