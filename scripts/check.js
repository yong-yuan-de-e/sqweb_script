'use strict';

// 仅检查项目源码语法，不创建或运行独立测试用例。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) check(filename);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
    }
  }
}
check(path.join(__dirname, '../src'));
check(__dirname);
console.log('所有项目 JavaScript 源码语法检查通过。');
