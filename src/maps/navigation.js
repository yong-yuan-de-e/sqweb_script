'use strict';

const { waitUntil } = require('../automation/wait');
const { dangerous } = require('./catalog');
const matches = (button, selector) => button.path.includes(selector.pathIncludes || '') && (selector.labels ? selector.labels.includes(button.label) :
  button.label.startsWith(selector.labelPrefix) && (!selector.boundary || /^(?:\s|$)/.test(button.label.slice(selector.labelPrefix.length))));

async function navigateRoute(game, route, signal, report = () => {}) {
  const navigation = [];
  const restoreQuest = async (selector, step) => {
    if (!selector?.labels?.some(l=>['主线任务','活动'].includes(l))) return;
    for (let i = 0; i < 4; i += 1) {
      const view = await game.inspect(); game.checkProblem(view);
      if (view.buttons.some(b => matches(b, selector))) return;
      const back = view.buttons.filter(b => b.label === '返回' && b.path.startsWith('QuestScreen/') && /QuestPartSelector|QuestAreaSelector|QuestStageSelector|StageInfoRightHeader|EventQuestTopRightHeader|EventQuestStageSelector|EventQuestBossStageSelector/.test(b.path) && b.path.endsWith('/BackButton'));
      if (back.length !== 1) return;
      await game.click({ labels: ['返回'], pathIncludes: back[0].path }, '返回任务入口');
      navigation.push({ step, recovery: '返回已记忆的内层页面', label: back[0].label, path: back[0].path });
      await waitUntil(async () => { const v = await game.inspect(); return !v.loading && (!v.buttons.some(b => b.path === back[0].path) || v.buttons.some(b => matches(b, selector))); },
        { signal, timeout: 6000, interval: 200, description: '返回任务上层' });
    }
  };
  const revealPage = async(selector,step)=>{
    const section=selector?.labels?.some(l=>/^第?\d+部$/.test(l))?'QuestPartSelector':/^第\d+章/.test(selector?.labelPrefix||'')?'QuestAreaSelector':null;if(!section)return;
    if((await game.inspect()).buttons.some(b=>matches(b,selector)))return;
    for(const direction of ['上一页','下一页'])for(let turn=0;turn<100;turn++){
      const before=await game.inspect();game.checkProblem(before);if(before.buttons.some(b=>matches(b,selector)))return;
      const arrow=before.buttons.filter(b=>b.label===direction&&b.path.includes(section)&&/ArrowButton/.test(b.path));if(arrow.length!==1)break;
      const fingerprint=before.buttons.filter(b=>b.path.includes(section)&&/QuestBoard/.test(b.path)).map(b=>b.label).join('|');
      await game.click({labels:[direction],pathIncludes:arrow[0].path},'主线目录分页');navigation.push({step,recovery:'目录分页',label:direction,path:arrow[0].path});
      await waitUntil(async()=>{const view=await game.inspect();return view.buttons.some(b=>matches(b,selector))||view.buttons.filter(b=>b.path.includes(section)&&/QuestBoard/.test(b.path)).map(b=>b.label).join('|')!==fingerprint;},{signal,timeout:6000,interval:200,description:'目录翻页'});
    }
  };
  if (await game.has(['关闭交易所'])) await game.click(['关闭交易所'], '关闭交易所面板');
  if (await game.has(['关闭卡池一览'])) await game.click(['关闭卡池一览'], '关闭只读卡池列表');
  for (let index = 0; index < route.steps.length; index += 1) {
    signal?.throwIfAborted();
    const selector = route.steps[index];
    let options = (await game.inspect()).buttons.filter(b => matches(b, selector));
    // 原站会记住冒险内层页面；只用已识别的任务返回按钮回到入口标签。
    if (!options.length && !selector.optional) { await restoreQuest(selector, index + 1);await revealPage(selector,index+1); options = (await game.inspect()).buttons.filter(b => matches(b, selector)); }
    if (selector.optional && !options.length) { navigation.push({ step: index + 1, selector, skipped: true }); continue; }
    const next = route.steps.slice(index + 1).find(s => !s.optional);
    report({ phase: 'running', message: `地图路线 ${index + 1}/${route.steps.length}：${selector.labels?.join(' / ') || selector.labelPrefix}` });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await waitUntil(async () => { const view = await game.inspect(); game.checkProblem(view); options = view.buttons.filter(b => matches(b, selector)); return options.length > 0; },
        { signal, timeout: 15000, interval: 250, description: '配置中的导航按钮' });
      if (options.length !== 1) throw Error(`导航匹配到${options.length}个按钮，请补充pathIncludes或完整名称。`);
      if (dangerous.test(options[0].label) || /BattleStart|TradeBuy|TradeSell|GachaConfirm|ChallengeButton|SweepButton/.test(options[0].path)) throw Error('入口匹配到可能消耗资源的操作，已停止。');
      await game.click({ labels: [options[0].label], pathIncludes: options[0].path }, '地图入口导航');
      if(options[0].label==='首页'&&options[0].path.includes('MyPageFooter'))await waitUntil(async()=>{const v=await game.inspect();game.checkProblem(v);return new URL(v.url).hash==='#/home'&&!v.loading&&v.scenes.includes('MyPageScreen');},{signal,timeout:15000,interval:200,description:'首页场景加载完成'});
      if(options[0].label==='冒险'&&options[0].path.includes('MyPageFooter'))await waitUntil(async()=>{const v=await game.inspect();game.checkProblem(v);return new URL(v.url).hash==='#/quest'&&!v.loading&&v.scenes.includes('QuestScreen');},{signal,timeout:15000,interval:200,description:'冒险场景加载完成'});
      navigation.push({ step: index + 1, attempt: attempt + 1, label: options[0].label, path: options[0].path, skipped: false });
      if (!next) break;
      try {
        await restoreQuest(next, index + 2);
        await revealPage(next,index+2);
        await waitUntil(async () => { const v = await game.inspect(); game.checkProblem(v); return v.buttons.some(b => matches(b, next)); }, { signal, timeout: 6000, interval: 250, description: '下一步地图入口' });
        break;
      } catch (error) { if (signal?.aborted || !error.message.startsWith('等待') || attempt === 2) throw error; }
    }
  }
  return navigation;
}

module.exports = { matches, navigateRoute };
