'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const sourceArgument=process.argv.slice(2).find(value=>!value.startsWith('--'));
const source = sourceArgument ? path.resolve(root,sourceArgument) : path.join(root, 'dist/win-unpacked'), destination = path.join(root, `dist/SQWeb-Assistant-v${version}`);
if (!fs.existsSync(path.join(source, 'SQWeb Assistant.exe'))) throw Error('请先构建文件夹版。');
const update=process.argv.includes('--update');
if (fs.existsSync(destination)&&!update) throw Error('发行目录已存在，保留已有文件；更新本次发行可显式添加--update。');
fs.cpSync(source, destination, { recursive: true, errorOnExist: !update, force: update });
for (const name of ['maps', 'gacha']) {
  const seed = path.join(root, '.release-data', name);
  if (fs.existsSync(seed)) fs.cpSync(seed, path.join(destination, 'data', name), { recursive: true, errorOnExist: !update, force: update });
}
fs.copyFileSync(path.join(root, 'README.md'), path.join(destination, 'README.md'));
const usage=path.join(root,'docs/USAGE.md');
fs.copyFileSync(fs.existsSync(usage)?usage:path.join(root,'README.md'),path.join(destination,'使用说明.md'));
fs.writeFileSync(path.join(destination, '开始使用.txt'), `SQWeb Assistant v${version}\r\n\r\n解压整个文件夹到可写目录，双击 SQWeb Assistant.exe。保留 resources 与所有 DLL；无需 Node.js 或 Chrome。\r\n地图与卡池在 data/maps 和 data/gacha，可编辑并热加载。CSV 默认生成到 data/market-api。\r\n首次在新的电脑运行请在唯一游戏窗口手动登录。相同电脑继续使用原有登录分区、操作回执与计划记录。\r\n计划按系统日期时间执行，助手需要保持运行；本发行包不附带待执行计划。扫荡自动回复会按上限、余额和每日次数补至最大可购买值。\r\n关闭最后一个主控退出助手。详细说明见 README.md 与使用说明.md。\r\n`, 'utf8');
console.log(destination);
