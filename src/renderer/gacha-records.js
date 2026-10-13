'use strict';

(() => {
  let signature, pendingId, submitting=false;
  const $ = id => document.getElementById(id), states = { spent: '已完成', reserved: '结果待核对', rejected: '未扣费' };
  const confirmation=document.createElement('dialog'),prompt=document.createElement('p'),buttons=document.createElement('div'),submit=document.createElement('button'),cancel=document.createElement('button');
  prompt.textContent='请先在游戏中核对此笔已经完成并扣费。确认只记录回执、解除暂停，不会重新抽卡。';buttons.className='market-actions';submit.textContent='已核对完成';cancel.textContent='取消';buttons.append(submit,cancel);confirmation.append(prompt,buttons);document.body.append(confirmation);
  confirmation.addEventListener('close',()=>{pendingId=null;});cancel.addEventListener('click',()=>confirmation.close());
  submit.addEventListener('click',async()=>{if(!pendingId||submitting)return;const id=pendingId;submitting=true;confirmation.close();try{await window.assistant.command('acknowledge-gacha',{id});}catch(e){$('gacha-record-note').textContent=e.message;}finally{submitting=false;}});
  window.gachaRecordsView = { update(status) {
    const data = status.gachaHistory; if (!data) return;
    const next = JSON.stringify(data); if (next === signature) return; signature = next;
    $('gacha-record-note').textContent = data.error || '悬停“抽卡结果”展开卡片信息；也可点击或用键盘打开。';
    const list = $('gacha-records'); list.replaceChildren();
    for (const record of data.records) {
      const row = document.createElement('div'); row.className = 'gacha-record';
      const text = document.createElement('span'); text.textContent = `${record.time ? new Date(record.time).toLocaleString('zh-CN', { hour12: false }) : '时间未记录'} · ${record.pool} · ${record.count}抽 · ${record.cost.toLocaleString()}艾莉丝 · ${states[record.state] || record.state}`;
      const details = document.createElement('details'), summary = document.createElement('summary'), menu = document.createElement('ul'); details.className = 'gacha-result-menu'; summary.textContent = `抽卡结果（${record.results.length}张卡 / ${record.items.length}项道具）`; details.append(summary, menu);
      for (const card of record.results) { const li = document.createElement('li'), name = document.createElement('strong'), meta = document.createElement('span'); name.textContent = card.name || `卡片 ${card.id}`; meta.textContent = `${Number.isFinite(card.rare) ? '★' + card.rare : '稀有度未提供'} · ${card.isNew ? '新获得' : '重复获得'} · ID ${card.id}`; li.append(name, meta); if (card.description) { const description = document.createElement('p'); description.textContent = card.description; li.append(description); } menu.append(li); }
      if (!record.results.length) { const li = document.createElement('li'); li.textContent = record.state === 'reserved' ? '尚未取得可核实结果，请核对游戏记录。' : record.manualConfirmed ? '已人工核对完成，旧版原始卡片信息没有保存。' : record.items.length ? '本次返回道具奖励，未返回角色卡片。' : '原站没有提供卡片/道具结果。'; menu.append(li); }
      for(const item of record.items||[]){const li=document.createElement('li'),name=document.createElement('strong'),meta=document.createElement('span');name.textContent=item.name||`道具类型${item.type} · ID ${item.id}`;meta.textContent=`数量 ${item.count}${Number.isFinite(item.rare)?' · ★'+item.rare:''} · ${[60,61].includes(item.type)?'重复卡转换奖励':'道具奖励'}`;li.append(name,meta);if(item.description){const desc=document.createElement('p');desc.textContent=item.description;li.append(desc);}menu.append(li);}
      if(record.state==='reserved'){const button=document.createElement('button');button.textContent='已在游戏中核对此笔完成，解除暂停';button.addEventListener('click',()=>{if(submitting)return;pendingId=record.id;confirmation.showModal();});menu.append(button);}
      details.addEventListener('pointerenter', () => { details.open = true; }); details.addEventListener('pointerleave', () => { if (!details.contains(document.activeElement)) details.open = false; });
      details.addEventListener('focusout', e => { if (!details.contains(e.relatedTarget)) details.open = false; }); row.append(text, details); list.append(row);
    }
    if (!list.children.length) list.textContent = '暂无抽卡记录。';
  } };
})();
