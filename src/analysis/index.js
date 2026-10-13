'use strict';

// 后续接收 CSV 数据实现；当前版本不启动模拟或数据分析。
function simulate(_data, _options) { throw new Error('模型模拟模块尚未实现。'); }
function analyze(_data, _options) { throw new Error('数据分析模块尚未实现。'); }

module.exports = { simulate, analyze, implemented: false };
