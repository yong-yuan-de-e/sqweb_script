'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { tradeTolerance }=require('../shared/trade-tolerance');

class Settings {
  constructor(userData, defaultDirectory) {
    this.filename = path.join(userData, 'settings.json');
    this.values = { marketDirectory: path.resolve(defaultDirectory), intervalSeconds: 10, tradeTolerance:{spot:tradeTolerance(),futures:tradeTolerance(),gacha:tradeTolerance()} };
    if (fs.existsSync(this.filename)) {
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (typeof saved.marketDirectory === 'string' && path.isAbsolute(saved.marketDirectory)) this.values.marketDirectory = saved.marketDirectory;
      for(const kind of ['spot','futures','gacha'])if(saved.tradeTolerance?.[kind]){try{this.values.tradeTolerance[kind]=tradeTolerance(saved.tradeTolerance[kind]);}catch{ /* 旧配置损坏时保持默认接受度。 */ }}
    }
  }

  setDirectory(directory) {
    this.values.marketDirectory = path.resolve(directory);
    this.save();
    return this.values.marketDirectory;
  }
  save(){fs.writeFileSync(this.filename,JSON.stringify(this.values,null,2),{encoding:'utf8',flush:true});}
  setTradeTolerance(kind,value){
    if(!['spot','futures','gacha'].includes(kind))throw Error('未知价格接受度类型。');
    const tolerance=tradeTolerance(value),previous=this.values.tradeTolerance;this.values.tradeTolerance={...previous,[kind]:tolerance};
    try{this.save();}catch(e){this.values.tradeTolerance=previous;throw e;}return {...tolerance};
  }
}

module.exports = { Settings };
