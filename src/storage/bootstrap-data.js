'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 发行包只附带地图/卡池配置与只读记录；首次运行复制到可编辑目录，不覆盖用户修改。
function bootstrapData(resources, directory) {
  for (const name of ['maps', 'gacha']) {
    const source = path.join(resources, 'default-data', name), destination = path.join(directory, name);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-zA-Z0-9-]+\.(?:json|md)$/.test(entry.name)) continue;
      const target = path.join(destination, entry.name);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(source, entry.name), target, fs.constants.COPYFILE_EXCL);
    }
  }
}

module.exports = { bootstrapData };
