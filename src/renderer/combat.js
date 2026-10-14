'use strict';

(() => {
  const $=id=>document.getElementById(id);let catalog,signature,status,timer,inFlight=false,checkedKey,lastBusy=false,attempt=0;
  const fill=(id,records)=>{const select=$(id),current=select.value;select.replaceChildren();for(const r of records){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;select.append(o);}if(records.some(r=>r.id===current))select.value=current;};
  const selection=()=>$('battle-kind').value==='main'?{kind:'main',part:$('battle-part').value,mode:$('battle-mode').value,chapter:$('battle-chapter').value}:{kind:$('battle-kind').value,entry:$('battle-entry').value};
  const busy=()=>Boolean(status?.battle.active||status?.battle.restarting||status?.sweep?.active||status?.actions?.busy?.length);
  function schedule(force=false,delay=200){if(force)checkedKey=null;clearTimeout(timer);timer=null;if(!catalog||window.assistantView.current()!=='battle')return;timer=setTimeout(()=>{timer=null;verify().catch(()=>{});},delay);}
  async function verify(){
    if(!catalog||window.assistantView.current()!=='battle')return;
    const key=$('battle-route').value;if(inFlight)return;
    if(!status?.actions?.account||busy()){$('stage-verification').textContent=busy()?'任务结束后自动核对当前章节。':'等待登录后自动核对。';schedule(false,10000);return;}
    if(checkedKey===key)return;
    const selected=selection(),current=++attempt;inFlight=true;window.combatView.verifying=true;$('stage-verification').textContent='正在自动核对解锁、三冠、今日次数和体力…';window.assistant.command('sync-status').catch(()=>{});
    let success=false;
    try{const account=await window.assistant.command('refresh-game-stats',{selection:selected});if(key!==$('battle-route').value||current!==attempt)return;
      if(account?.routeId===key&&!account.stageError){checkedKey=key;success=true;$('stage-verification').textContent=`已自动核对 ${account.stages.length} 个关卡 · ${new Date(account.stageCapturedAt||account.capturedAt).toLocaleTimeString('zh-CN',{hour12:false})}`;}
      else $('stage-verification').textContent=account?.stageError||'当前忙碌，空闲后自动重试。';
    }catch(e){if(key===$('battle-route').value)$('stage-verification').textContent=`${e.message} · 十秒后重试`;}finally{inFlight=false;window.combatView.verifying=false;window.assistant.command('sync-status').catch(()=>{});if(!success)schedule(false,key===$('battle-route').value?10000:200);}
  }
  function changed(){rebuild();checkedKey=null;$('battle-route').dispatchEvent(new Event('change'));$('run-battle').disabled=true;$('sweep-prepare').disabled=true;$('stage-verification').textContent='章节已切换，将自动核对账号状态。';schedule(true);window.assistant.command('sync-status').catch(()=>{});}
  function rebuild(){
    if(!catalog)return;
    const main=$('battle-kind').value==='main';$('main-selectors').hidden=!main;$('activity-selectors').hidden=main;
    if(main){fill('battle-part',catalog.parts.map(p=>({id:p.id,name:p.name})));const chapters=catalog.chapters.filter(c=>c.part===$('battle-part').value),modes=[...new Set(chapters.flatMap(c=>c.modes.map(m=>m.id)))];fill('battle-mode',modes.map(id=>({id,name:{1:'NORMAL',2:'HARD',3:'EXPERT'}[id]||id})));fill('battle-chapter',chapters.filter(c=>c.modes.some(m=>m.id===$('battle-mode').value)).map(c=>({id:c.id,name:`第${c.id}章 · ${c.title}`})));}
    else fill('battle-entry',catalog.activities.filter(e=>e.kind===$('battle-kind').value).map(e=>({id:e.id,name:e.name})));
    const s=selection(),key=main?`main-p${s.part}-m${s.mode}-c${s.chapter}`:catalog.activities.find(e=>e.id===s.entry)?.routeId||s.entry;
    $('battle-route').replaceChildren();const option=document.createElement('option');option.value=key;$('battle-route').append(option);
    const chapter=main?catalog.chapters.find(c=>c.part===s.part&&c.id===s.chapter):null;
    window.combatView.available=main?chapter?.modes.find(m=>m.id===s.mode)?.stages||[]:catalog.activities.find(e=>e.id===s.entry)?.stages||[];
  }
  for(const id of ['battle-kind','battle-part','battle-mode','battle-chapter','battle-entry'])$(id).addEventListener('change',changed);
  $('refresh-stages').addEventListener('click',()=>schedule(true,0));
  $('reload-battle-catalog').addEventListener('click',()=>window.assistant.command('refresh-battle-catalog').catch(e=>{$('stage-verification').textContent=e.message;}));
  $('open-selected-entry').addEventListener('click',()=>window.assistant.command('open-battle-entry',{selection:selection()}).catch(e=>{$('sweep-message').textContent=e.message;}));
  window.addEventListener('assistant-view-changed',()=>schedule());
  window.combatView={selection,available:[],verifying:false,verify:()=>schedule(true,0),update(snapshot){status=snapshot;const data=status.battleCatalog;if(!data)return;const next=JSON.stringify(data);if(signature!==next){signature=next;catalog=data;rebuild();$('battle-catalog-note').textContent=data.error||data.adapterError||`原站目录：${data.parts.length}部、${data.chapters.length}章，包含未解锁关卡。`;schedule(true);}
    const isBusy=busy();if((lastBusy&&!isBusy)||!status.actions?.account)checkedKey=null;lastBusy=isBusy;
    if(!isBusy&&checkedKey!==$('battle-route').value&&!inFlight&&!timer)schedule();
  },showSelection(s){$('battle-kind').value=s.kind;rebuild();if(s.kind==='main'){$('battle-part').value=s.part;rebuild();$('battle-mode').value=s.mode;rebuild();$('battle-chapter').value=s.chapter;rebuild();}else{$('battle-entry').value=s.entry;rebuild();}checkedKey=null;schedule();}};
})();
