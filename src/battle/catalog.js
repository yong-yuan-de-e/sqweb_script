'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { nativeContext } = require('../game/native-bridge');
const labels = { '1': 'NORMAL', '2': 'HARD', '3': 'EXPERT' };

class BattleCatalog {
  constructor({ directory, maps, getPage, report }) {
    Object.assign(this, { directory, maps, getPage, report }); this.file = path.join(directory, 'main-catalog.json'); this.adaptersFile = path.join(directory, 'combat-adapters.json');
    this.data = { version: 1, capturedAt: null, parts: [], chapters: [] }; this.loading = false; this.error = null; this.nextTry = 0;
    try { if (fs.existsSync(this.file)) { if (fs.statSync(this.file).size > 16777216) throw Error('缓存过大'); const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (data.version !== 1 || !Array.isArray(data.parts) || !Array.isArray(data.chapters)) throw Error('格式无效'); this.data = data; } } catch { this.error = '主线目录缓存不可读，可重新读取原站目录。'; }
  }
  ensureAdapters() {
    if (!fs.existsSync(this.adaptersFile)) fs.writeFileSync(this.adaptersFile, JSON.stringify({version:1,entries:[]},null,2)+'\n',{flush:true});
  }
  activities() {
    this.adapterError = null;
    const result = this.maps.snapshot().routes.filter(r => r.recorded && /活动|event/.test(r.name + r.id)).map(r => {
      let stages = []; try { const data = JSON.parse(fs.readFileSync(path.join(this.directory, r.id + '.json'), 'utf8')); stages = data.levels.filter(s => /Quest(?:Boss)?StageItemCell/.test(s.path || '') && !/^(?:播放|剧情|故事)/.test(s.label)).map(s => ({ id: s.id || null, label: s.label, stamina: s.stamina ?? null, selector:{labels:[s.label],pathIncludes:s.path} })); } catch {}
      return { id: r.id, name: r.name, kind: /世界/.test(r.name) ? 'worldboss' : /首领|boss/i.test(r.name) ? 'event-boss' : 'activity', routeId: r.id, stages };
    });
    try {
      if (fs.existsSync(this.adaptersFile)) {
        if (fs.statSync(this.adaptersFile).size > 16777216) throw Error('活动适配文件超过16MB。');
        const data = JSON.parse(fs.readFileSync(this.adaptersFile, 'utf8'));
        if (data.version !== 1 || !Array.isArray(data.entries)) throw Error('活动适配文件格式无效。');
        const ids=new Set();
        for (const entry of data.entries) {
          if (!/^[a-z0-9-]{1,80}$/.test(entry.id) || !['activity', 'event-boss', 'worldboss'].includes(entry.kind) || typeof entry.name !== 'string' || !Array.isArray(entry.stages)) throw Error('活动适配条目无效。');
          if(ids.has(entry.id))throw Error('活动适配ID重复。');ids.add(entry.id);
          const stageIds=new Set();
          for(const s of entry.stages){
            if(!s||typeof s.id!=='string'||!(entry.kind==='worldboss'?/^[a-zA-Z0-9-]{1,64}$/:/^\d{1,32}$/).test(s.id)||stageIds.has(s.id)||typeof s.label!=='string'||!s.label.trim())throw Error('活动关卡需要唯一真实ID和按钮名称。');stageIds.add(s.id);
            const selector=s.selector||entry.stageSelector;if(selector&&(!Array.isArray(selector.labels)||selector.labels.length!==1||selector.labels[0]!==s.label||typeof selector.pathIncludes!=='string'||!/StageItemCell/.test(selector.pathIncludes)))throw Error('活动关卡选择器必须精确匹配已录入的关卡按钮路径。');
          }
          if (entry.routeId) this.maps.get(entry.routeId);
          let adapted=entry;
          if(entry.kind==='worldboss'&&entry.routeId){try{const record=JSON.parse(fs.readFileSync(path.join(this.directory,entry.routeId+'.json'),'utf8')),boss=record.mode==='route'&&record.levels?.find(s=>s.kind==='worldboss');if(boss)adapted={...entry,name:`世界Boss · ${boss.label}`,stages:[{id:boss.id,label:boss.label,stamina:0,manualBattle:true,public:boss.public}]};}catch{}}
          const found = result.findIndex(r => r.id === entry.id); if (found >= 0) result.splice(found, 1); result.push(adapted);
        }
      }
    } catch (e) { this.adapterError = e.message; }
    for (const kind of ['event-boss', 'worldboss']) if (!result.some(e => e.kind === kind)) result.push({ id: kind, name: kind === 'event-boss' ? '活动首领战（待人工录入入口）' : '世界Boss（待人工录入入口）', kind, stages: [], routeId: null });
    return result;
  }
  snapshot() { const activities=this.activities();return { ...this.data, error: this.error, adapterError: this.adapterError || null, activities, adaptersFile: this.adaptersFile }; }
  async refresh(force = false) {
    if (this.loading || (!force && this.data.capturedAt) || Date.now() < this.nextTry) return;
    this.loading = true;
    try {
      const page = await this.getPage(), info = await nativeContext(page);
      const data = await page.evaluate(async info => {
        const io = await import(info.io), source = await io.i('master/quest59.json');
        if (!Array.isArray(source.parts) || !Array.isArray(source.areas)) throw Error('原站主线目录结构改变。');
        return { version: 1, capturedAt: new Date().toISOString(), parts: source.parts.map(p => ({ id: String(p.part), name: `第${p.part}部`, unlock: String(p.unlock || '0') })),
          chapters: source.areas.map(a => ({ part: String(a.part), id: String(a.area), title: a.title, modes: Object.entries(a.modes).map(([id, m]) => ({ id, stages: m.stages.map(s => ({ id: String(s.id), label: s.title, stamina: s.stamina, unlock: String(s.unlock || '0') })) })) })) };
      }, info);
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(data, null, 2) + '\n', { flush: true }); fs.renameSync(this.file + '.tmp', this.file); this.data = data; this.error = null; this.report();
    } catch (e) { this.error = String(e.message).split('\n')[0]; this.nextTry = Date.now() + 10000; this.report(); }
    finally { this.loading = false; }
  }
  resolve(selection) {
    if (!selection || !['main', 'activity', 'event-boss', 'worldboss'].includes(selection.kind)) throw Error('请选择关卡类别。');
    if (selection.kind === 'main') {
      const chapter = this.data.chapters.find(c => c.part === selection.part && c.id === selection.chapter), mode = chapter?.modes.find(m => m.id === selection.mode);
      if (!chapter || !mode || !this.data.parts.some(p => p.id === chapter.part) || !labels[mode.id]) throw Error('请选择原站目录中的部、难度与章。');
      const id = `main-p${chapter.part}-m${mode.id}-c${chapter.id}`;
      return { id, name: `第${chapter.part}部 · ${labels[mode.id]} · 第${chapter.id}章`, steps: [
        { labels: ['首页'], pathIncludes: 'MyPageFooter/Footer/Tab/MypageButton' }, { labels: ['冒险'] }, { labels: ['主线任务'] },
        { labels: [`第${chapter.part}部`, `${chapter.part}部`] }, { labels: [labels[mode.id]], optional: mode.id === '1' }, { labelPrefix: `第${chapter.id}章`, boundary: true }],
        levelSelector: {}, stages: mode.stages, selection: { ...selection } };
    }
    const entry = this.activities().find(e => e.id === selection.entry && e.kind === selection.kind);
    if (!entry?.routeId) throw Error('此入口需要人工适配，请在录入页配置真实入口与关卡ID。');
    const { route } = this.maps.get(entry.routeId);
    return { ...route, stages: entry.stages || [], selection: { ...selection }, activity: entry };
  }
  next(selection, stageId) {
    const route = this.resolve(selection), index = route.stages.findIndex(s => s.id === stageId);
    if (index < 0) return null;
    if (index + 1 < route.stages.length) return { route, stage: route.stages[index + 1], selection };
    if (selection.kind !== 'main') return null;
    const chapters = this.data.chapters.filter(c => c.part === selection.part && c.modes.some(m => m.id === selection.mode)).sort((a, b) => Number(a.id) - Number(b.id));
    let chapter = chapters[chapters.findIndex(c => c.id === selection.chapter) + 1], part = selection.part;
    if (!chapter) { const parts = this.data.parts.slice().sort((a, b) => Number(a.id) - Number(b.id)), nextPart = parts[parts.findIndex(p => p.id === selection.part) + 1]; if (!nextPart) return null; part = nextPart.id; chapter = this.data.chapters.filter(c => c.part === part && c.modes.some(m => m.id === selection.mode)).sort((a,b) => Number(a.id) - Number(b.id))[0]; }
    if (!chapter) return null;
    const nextSelection = { ...selection, part, chapter: chapter.id }, nextRoute = this.resolve(nextSelection);
    return nextRoute.stages.length ? { selection: nextSelection, route: nextRoute, stage: nextRoute.stages[0] } : null;
  }
}

module.exports = { BattleCatalog };
