'use strict';

const fs = require('node:fs');
const path = require('node:path');

class Settings {
  constructor(userData, defaultDirectory) {
    this.filename = path.join(userData, 'settings.json');
    this.values = { marketDirectory: path.resolve(defaultDirectory), intervalSeconds: 10 };
    if (fs.existsSync(this.filename)) {
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (typeof saved.marketDirectory === 'string' && path.isAbsolute(saved.marketDirectory)) this.values.marketDirectory = saved.marketDirectory;
    }
  }

  setDirectory(directory) {
    this.values.marketDirectory = path.resolve(directory);
    fs.writeFileSync(this.filename, JSON.stringify(this.values, null, 2), { encoding: 'utf8', flush: true });
    return this.values.marketDirectory;
  }
}

module.exports = { Settings };
