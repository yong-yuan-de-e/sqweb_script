'use strict';

// 画面文字与 aria-label 有区别，以下名称来自游戏当前的透明 DOM 控件。
module.exports = Object.freeze({
  adventure: ['冒险'],
  mainQuest: ['主线任务'],
  part: ['第1部', '1部'],
  normal: ['NORMAL'],
  chapter: /^第?1章(?:\s|$)/,
  stage: ['1章-1'],
  challenge: ['出发', '挑战'],
  start: ['战斗开始'],
  auto: ['自动', 'AUTO'],
  speed: ['加速', '快进'],
  result: ['再战', '返回列表', '下一步'],
  growthNext: { labels: ['下一步'], pathIncludes: '/WinResult/FirstView/Footer/NextButton' },
});
