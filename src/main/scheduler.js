'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { sweepGoal } = require('../shared/sweep-goal');
const { tradeTolerance } = require('../shared/trade-tolerance');
const states = new Set(['pending', 'running', 'completed', 'failed', 'missed', 'cancelled', 'needs_review']);

// 按系统绝对时间检查；先持久化running再调用付费流程，崩溃后的任务不重放。
class Scheduler {
  constructor({ directory, report, execute, ready, resolvePool, resolveSweep }) {
    Object.assign(this, { report, execute, ready, resolvePool, resolveSweep }); this.file = path.join(directory, 'plans.json');
    this.plans = []; this.running = false; this.disposed = false; this.error = null;
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 1048576) throw Error('计划文件过大。');
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (data.version !== 1 || !Array.isArray(data.plans) || data.plans.length > 500) throw Error('计划文件格式无效。');
        const ids = new Set();
        for (const p of data.plans) {
          const shape=p.kind==='gacha'?['single','ten'].includes(p.mode)&&Number.isInteger(p.batches)&&p.batches>=1&&p.batches<=100&&typeof p.poolId==='string':p.kind==='sweep'&&typeof p.stageId==='string'&&typeof p.buyStamina==='boolean'&&p.selection&&Boolean(sweepGoal(p));
          if (typeof p.id !== 'string' || ids.has(p.id) || !shape || !states.has(p.state) || !Number.isSafeInteger(p.runAt)) throw Error('计划记录无效。');
          if (p.kind === 'gacha') p.tolerance = tradeTolerance(p.tolerance);
          ids.add(p.id);
          if (typeof p.message === 'string') p.message = p.message.replace(/\s*累计测试消耗 \d+ \/ \d+ 艾莉丝[。.]?/, '');
          if (p.state === 'running') { p.state = 'needs_review'; p.message = '上次退出时任务正在执行，请核对游戏与操作回执；不会自动重试。'; }
        }
        this.plans = data.plans; this.save();
      }
    } catch (error) { this.error = `计划暂停：${error.message}`; }
    this.timer = setInterval(() => this.tick().catch(error => { this.error = `计划暂停：${error.message}`; this.report(); }), 1000);
    this.timer.unref?.();
  }
  clock() { const now = Date.now(); return { now, nextMinute: (Math.floor(now / 60000) + 1) * 60000 }; }
  snapshot() { return { ...this.clock(), error: this.error, plans: this.plans.map(p => ({ ...p })) }; }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, plans: this.plans }, null, 2) + '\n', { flush: true }); fs.renameSync(this.file + '.tmp', this.file); }
  add(options) {
    if (this.error) throw Error(this.error);
    if (!options || !Number.isSafeInteger(options.runAt) || options.runAt <= Date.now() || options.runAt > Date.now() + 366 * 86400000) throw Error('请选择未来一年内的系统执行时间。');
    if (this.plans.length >= 500) throw Error('计划记录已达500条，请先删除已结束的记录。');
    let fields;
    if((options.kind||'gacha')==='gacha'){
      if(!['single','ten'].includes(options.mode)||!Number.isInteger(options.batches)||options.batches<1||options.batches>100)throw Error('请选择单抽/十连及1至100批。');
      const pool=this.resolvePool(options.poolId);if(!pool.modes.includes(options.mode))throw Error('该卡池未录入所选召唤模式。');fields={kind:'gacha',poolId:pool.id,poolName:pool.name,mode:options.mode,batches:options.batches,tolerance:tradeTolerance(options.tolerance)};
    }else if(options.kind==='sweep'){
      const goal=sweepGoal(options);if(typeof options.buyStamina!=='boolean')throw Error('请选择体力回复选项。');
      const target=this.resolveSweep(options);fields={kind:'sweep',selection:JSON.parse(JSON.stringify(options.selection)),stageId:target.stage.id,stageName:target.stage.label,routeName:target.route.name,...goal,buyStamina:options.buyStamina};
    }else throw Error('只支持召唤或扫荡计划。');
    const plan = { id: randomUUID(), ...fields, runAt: options.runAt,state: 'pending', createdAt: Date.now(), message: fields.kind==='sweep'?'到点按资源取最大批次，体力不足时按保存的回复渠道补充至可回复的最大值。':'到点首次报价为本次基准，后续费用受保存的涨跌接受幅度限制。' };
    this.plans.push(plan); try { this.save(); } catch (error) { this.plans.pop(); throw error; }
    this.report(); return { ...plan };
  }
  remove(id) {
    const plan = this.plans.find(p => p.id === id); if (!plan || plan.state === 'running') throw Error('运行中的计划不能删除。');
    const old = this.plans; this.plans = this.plans.filter(p => p.id !== id); try { this.save(); } catch (e) { this.plans = old; throw e; } this.report();
  }
  cancel(id) {
    const p = this.plans.find(p => p.id === id); if (!p || p.state !== 'pending') throw Error('只能取消待执行计划。');
    p.state = 'cancelled'; p.message = '用户取消。'; this.save(); this.report();
  }
  async tick() {
    if (this.disposed || this.error) return;
    const now = Date.now(), due = this.plans.filter(p => p.state === 'pending' && p.runAt <= now).sort((a, b) => a.runAt - b.runAt);
    if (!due.length) return;
    for (const p of due) {
      if (this.disposed) return;
      if(now-p.runAt>30000){p.state='missed';p.message='已错过执行时间超过30秒，不补执行付费任务。';p.finishedAt=Date.now();this.save();this.report();continue;}
      const problem=this.ready(p);
      if(problem){if(p.message!==problem){p.message=problem;this.save();this.report();}continue;}
      p.state='running';p.startedAt=Date.now();p.message=`已按系统时间启动${p.kind==='sweep'?'扫荡':'召唤'}。`;this.save();this.report();
      this.executePlan(p).catch(error=>{this.error=`计划暂停：${error.message}`;this.report();});
    }
  }
  async executePlan(p){
    try{const result=await this.execute({...p});p.state=result?.phase==='completed'?'completed':'failed';p.message=result?.message||'任务已停止，请核对游戏记录。';}
    catch(error){p.state='failed';p.message=String(error.message).split('\n')[0];}
    finally{p.finishedAt=Date.now();this.save();this.report();}
  }
  dispose() { this.disposed = true; clearInterval(this.timer); }
}

module.exports = { Scheduler };
