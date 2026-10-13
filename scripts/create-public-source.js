'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,target=path.join(root,`dist/SQWeb-Assistant-v${version}-source`);
if(fs.existsSync(target))throw Error('源码发行目录已存在，请先检查原文件，不自动覆盖。');
fs.mkdirSync(target,{recursive:true});
for(const name of ['src','scripts','assets'])fs.cpSync(path.join(root,name),path.join(target,name),{recursive:true});
for(const name of ['README.md','package.json','package-lock.json','.gitignore'])fs.copyFileSync(path.join(root,name),path.join(target,name));
fs.writeFileSync(path.join(target,'源码版本说明.txt'),'此目录可作为GitHub仓库根目录。包含自有源码、README与公共地图/卡池记录；安装与构建见README.md。\r\n不含docs、AGENTS.md、账号、运行账本、CSV、游戏原始资源缓存或node_modules。\r\n','utf8');
console.log(target);
