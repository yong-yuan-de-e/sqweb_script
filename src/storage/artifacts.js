'use strict';

const fs = require('node:fs');
const path = require('node:path');

class Artifacts {
  constructor(userData) {
    this.root = path.join(userData, 'runs');
    fs.mkdirSync(this.root, { recursive: true });
    this.file = path.join(this.root, 'assistant.jsonl');
  }

  log(event) {
    fs.appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n', 'utf8');
  }

  async capture(page, label) {
    const filename = path.join(this.root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.png`);
    await page.screenshot({ path: filename });
    return filename;
  }
}

module.exports = { Artifacts };
