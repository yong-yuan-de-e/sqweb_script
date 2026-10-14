'use strict';

(() => {
  const $=id=>document.getElementById(id),dirty={spot:false,futures:false,gacha:false},revision={spot:0,futures:0,gacha:0},awaiting={};
  const read=kind=>window.tradeTolerance(Object.fromEntries([['upPct','up'],['downPct','down']].map(([key,side])=>{const text=$(`${kind}-tolerance-${side}`).value.trim();return [key,text===''?NaN:Number(text)];})));
  for(const kind of ['spot','futures','gacha'])for(const side of ['up','down']){
    const input=$(`${kind}-tolerance-${side}`);
    input.addEventListener('input',()=>{dirty[kind]=true;revision[kind]++;});
    input.addEventListener('change',async()=>{
      const current=revision[kind];
      try{const saved=await window.assistant.command('set-trade-tolerance',{kind,tolerance:read(kind)});if(current===revision[kind]){dirty[kind]=false;awaiting[kind]=JSON.stringify(saved);}}
      catch(e){$(kind==='gacha'?'gacha-message':`${kind}-action-message`).textContent=e.message;}
    });
  }
  window.tradeSettings={read,update(snapshot){
    for(const kind of ['spot','futures','gacha']){
      const saved=snapshot.tradeTolerance?.[kind];if(!saved||dirty[kind])continue;
      if(awaiting[kind]&&awaiting[kind]!==JSON.stringify(saved))continue;delete awaiting[kind];
      for(const [key,side] of [['upPct','up'],['downPct','down']]){const input=$(`${kind}-tolerance-${side}`);if(input!==document.activeElement)input.value=String(saved[key]);}
    }
  }};
})();
