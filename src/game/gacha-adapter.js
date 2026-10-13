'use strict';

const { GameAdapter } = require('./adapter');
const { waitUntil } = require('../automation/wait');
const { readGachaPools } = require('./gacha-pools');

const selectors = Object.freeze({
  single: { labels: ['召唤1次'], pathIncludes: 'GachaScreen/MainArea/RightSide/' },
  ten: { labels: ['召唤10次'], pathIncludes: 'GachaScreen/MainArea/RightSide/' },
  confirm: { labels: ['确定召唤'], pathIncludes: 'GachaConfirmDialog/Footer/ButtonArea/OKButton' },
  cancel: { labels: ['取消'], pathIncludes: 'GachaConfirmDialog/Footer/ButtonArea/CancelButton' },
  skip: { labels: ['SKIP'], pathIncludes: '/GachaEffectUI/SafeArea/SkipButton' },
  result: { labels: ['确定'], pathIncludes: '/ResultUI/ButtonPanel/CloseButton' },
});

class GachaAdapter extends GameAdapter {
  async openList() {
    const snapshot = await this.inspect();
    this.checkProblem(snapshot);
    if (snapshot.buttons.some(button => ['自动', 'AUTO'].includes(button.label))) throw new Error('战斗正在进行，请先完成战斗再召唤。');
    if (snapshot.buttons.some(button => button.path.includes('Login'))) throw new Error('请先在游戏窗口手动登录。');
    if (await this.has(selectors.confirm)) await this.click(selectors.cancel, '取消未提交的召唤确认');
    if (snapshot.buttons.some(button => button.path.includes('GachaListArea/') && !button.label.startsWith('关闭'))) return;
    if (!await this.has(['卡池一览'])) await this.navigate({ labels: ['召唤'], pathIncludes: 'MyPageFooter' }, ['卡池一览'], '进入召唤');
    await this.navigate(['卡池一览'], ['关闭卡池一览'], '打开卡池一览');
  }

  async openPool(pool = { id: '100001', name: '高级召唤' }, mode = 'single') {
    const pools = await readGachaPools(this.page), live = pools.find(p => p.id === pool.id);
    const button = live?.buttons.find(b => !b.ticket && b.count === (mode === 'single' ? 1 : 10) && b.cost > 0);
    if (!live || live.name !== pool.name || live.kind === 'assist' || !button) throw new Error('卡池已结束、名称改变或不支持艾莉丝召唤，请重新录入。');
    this.pool = live; this.button = button;
    await this.openList();
    await this.navigate({ labels: [live.name], pathIncludes: 'GachaListArea/' }, selectors[mode], `选择${live.name}`);
  }

  async quote(mode) {
    await this.click(selectors[mode], mode === 'single' ? '单抽报价' : '十连报价');
    await this.waitFor(selectors.confirm, '付费召唤确认');
    const fields = await this.page.evaluate(() => {
      const find = (node, name) => {
        if (!node?.active) return null;
        if (node.name === name) return node;
        for (const child of node.children || []) { const found = find(child, name); if (found) return found; }
        return null;
      };
      const root = find(window.stage?.window, 'GachaConfirmDialog');
      const read = path => root?.find(path)?.text?.text ?? '';
      return { pool: read('Title'), description: read('MainArea/DescriptionText'), cost: read('MainArea/MoneyNumBase/BuyRealmoneyNum/ValueText'), balance: read('MainArea/MoneyNumBase/NowRealmoneyNum/ValueText') };
    });
    const integer = text => /^\d[\d,]*$/.test(text.trim()) ? Number(text.replace(/,/g, '')) : NaN;
    const count = Number(fields.description.match(/消耗艾莉丝召唤\s+(\d+)\s+次/)?.[1]);
    const cost = integer(fields.cost), balance = integer(fields.balance);
    if (fields.pool !== this.pool?.name || count !== (mode === 'single' ? 1 : 10) || !Number.isSafeInteger(cost) || cost <= 0 || !Number.isSafeInteger(balance) || balance < cost) {
      await this.cancelQuote();
      throw new Error('召唤确认框的卡池、次数、价格或余额未通过核验，已取消。');
    }
    return { pool: fields.pool, poolId: this.pool.id, button: this.button.button, count, cost };
  }

  async cancelQuote() {
    if (!this.signal?.aborted && await this.has(selectors.cancel)) await this.click(selectors.cancel, '取消召唤确认');
  }

  async finish() {
    let skipped = false;
    await waitUntil(async () => {
      const snapshot = await this.inspect();
      this.checkProblem(snapshot);
      const popup = snapshot.buttons.find(button => button.label === '关闭（新成员加入）' ||
        (/Get(Character|Costume)Dialog\/.+(Close|Ok|OK|Back|Decide)Button(?:\/|$)/.test(button.path)));
      if (popup) await this.click({ labels: [popup.label], pathIncludes: popup.path }, '关闭新成员介绍');
      else if (snapshot.buttons.some(button => button.label === '确定' && button.path.includes(selectors.result.pathIncludes))) return true;
      else if (!skipped && snapshot.buttons.some(button => button.label === 'SKIP' && button.path.includes(selectors.skip.pathIncludes))) {
        await this.click(selectors.skip, '跳过召唤动画'); skipped = true;
      }
      return false;
    }, { signal: this.signal, timeout: 180000, interval: 300, description: '召唤结果页面' });
  }
}

module.exports = { GachaAdapter, selectors };
