'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MapCatalog } = require('../src/maps/catalog');
const { GachaCatalog } = require('../src/gacha/catalog');
const root = path.resolve(__dirname, '..'), target = path.join(root, '.release-data');
const maps = new MapCatalog(path.join(root,fs.existsSync(path.join(root,'dist/data/maps/routes.json'))?'dist/data/maps':'assets/default-data/maps'));
if (maps.error) throw Error(`发行地图配置无效：${maps.error}`);
const copy = (source, directory) => { fs.mkdirSync(directory, { recursive: true }); fs.copyFileSync(source, path.join(directory, path.basename(source))); };
const mapDirectory = path.join(target, 'maps'); copy(maps.file, mapDirectory);
for(const name of ['main-catalog.json','combat-adapters.json']){const file=path.join(maps.directory,name);if(fs.existsSync(file))copy(file,mapDirectory);}
let mapRecords = 0;
for (const { id } of maps.snapshot().routes) for (const suffix of ['.json', '-workflow.md']) {
  const source = path.join(maps.directory, id + suffix);
  if (fs.existsSync(source)) { copy(source, mapDirectory); if (suffix === '.json') mapRecords += 1; }
}
const pools = new GachaCatalog(path.join(root,fs.existsSync(path.join(root,'dist/data/gacha/pools.json'))?'dist/data/gacha':'assets/default-data/gacha'));
if (pools.error) throw Error(`发行卡池数据无效：${pools.error}`);
if (fs.existsSync(pools.file)) copy(pools.file, path.join(target, 'gacha'));
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ version: require('../package.json').version, preparedAt: new Date().toISOString(), routes: maps.snapshot().routes.length, mapRecords, pools: pools.data.pools.length }, null, 2) + '\n');
console.log(`已准备发行数据：${maps.snapshot().routes.length}条地图路线、${mapRecords}份地图记录、${pools.data.pools.length}个卡池。`);
