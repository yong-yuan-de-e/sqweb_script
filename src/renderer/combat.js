'use strict';

(() => {
  const $ = id => document.getElementById(id); let catalog, signature;
  const fill = (id, records) => { const select = $(id), current = select.value; select.replaceChildren(); for (const r of records) { const o = document.createElement('option'); o.value = r.id; o.textContent = r.name; select.append(o); } if (records.some(r => r.id === current)) select.value = current; };
  const selection = () => $('battle-kind').value === 'main' ? { kind: 'main', part: $('battle-part').value, mode: $('battle-mode').value, chapter: $('battle-chapter').value } : { kind: $('battle-kind').value, entry: $('battle-entry').value };
  const changed = () => { rebuild(); $('battle-route').dispatchEvent(new Event('change')); $('sweep-stage').replaceChildren(); $('run-battle').disabled = true; $('sweep-prepare').disabled = true; $('sweep-message').textContent = '已切换选关，点击读取关卡核对实时状态。'; window.assistant.command('sync-status').catch(() => {}); };
  function rebuild() {
    if (!catalog) return;
    const main = $('battle-kind').value === 'main'; $('main-selectors').hidden = !main; $('activity-selectors').hidden = main;
    if (main) {
      fill('battle-part', catalog.parts.map(p => ({ id: p.id, name: p.name })));
      const chapters = catalog.chapters.filter(c => c.part === $('battle-part').value), modes = [...new Set(chapters.flatMap(c => c.modes.map(m => m.id)))];
      fill('battle-mode', modes.map(id => ({ id, name: {1:'NORMAL',2:'HARD',3:'EXPERT'}[id] || id })));
      fill('battle-chapter', chapters.filter(c => c.modes.some(m => m.id === $('battle-mode').value)).map(c => ({ id:c.id,name:`第${c.id}章 · ${c.title}` })));
    } else fill('battle-entry', catalog.activities.filter(e => e.kind === $('battle-kind').value).map(e => ({ id:e.id,name:e.name })));
    const s = selection(), key = main ? `main-p${s.part}-m${s.mode}-c${s.chapter}` : catalog.activities.find(e => e.id === s.entry)?.routeId || s.entry;
    $('battle-route').replaceChildren(); const option = document.createElement('option'); option.value = key; $('battle-route').append(option);
    const chapter = main ? catalog.chapters.find(c => c.part === s.part && c.id === s.chapter) : null;
    const stages = main ? chapter?.modes.find(m => m.id === s.mode)?.stages || [] : catalog.activities.find(e => e.id === s.entry)?.stages || [];
    window.combatView.available = stages;
    if (!main && !stages.length) $('sweep-message').textContent = '此活动入口待人工适配，请在录入页配置入口与真实关卡ID。';
  }
  for (const id of ['battle-kind','battle-part','battle-mode','battle-chapter','battle-entry']) $(id).addEventListener('change', changed);
  $('reload-battle-catalog').addEventListener('click', () => window.assistant.command('refresh-battle-catalog').catch(e => { $('sweep-message').textContent=e.message; }));
  $('open-selected-entry').addEventListener('click',()=>window.assistant.command('open-battle-entry',{selection:selection()}).catch(e=>{$('sweep-message').textContent=e.message;}));
  window.combatView = { selection, available: [], update(status) { const data=status.battleCatalog;if(!data)return;const next=JSON.stringify(data);if(signature===next)return;signature=next;catalog=data;rebuild();$('battle-catalog-note').textContent=data.error||`原站目录：${data.parts.length}部、${data.chapters.length}章，包含未解锁关卡。`; }, showSelection(s) { $('battle-kind').value=s.kind;rebuild();if(s.kind==='main'){ $('battle-part').value=s.part;rebuild();$('battle-mode').value=s.mode;rebuild();$('battle-chapter').value=s.chapter;rebuild(); }else{ $('battle-entry').value=s.entry;rebuild(); } } };
})();
