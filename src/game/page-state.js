'use strict';

const PageState = Object.freeze({ READY: 'ready', LOADING: 'loading', SERVER_UPDATING: 'server_updating', OTHER_TAB: 'other_tab' });

function classifyPageState(snapshot) {
  if (snapshot.otherTabVisible) return { code: PageState.OTHER_TAB, message: '账号已在其他窗口打开，请在游戏窗口手动确认当前会话。' };
  if (snapshot.maintenanceVisible || snapshot.texts?.some(text => /服务器更新中/.test(text))) {
    return { code: PageState.SERVER_UPDATING, message: '服务器更新中，等待网站自动重新进入游戏。' };
  }
  if (snapshot.loading || snapshot.splashVisible) return { code: PageState.LOADING, message: '游戏正在加载。' };
  return { code: PageState.READY, message: '游戏页面可用。' };
}

class PageStateError extends Error {
  constructor(state) { super(state.message); this.name = 'PageStateError'; this.code = state.code; }
}

const isReloadError = error => /Execution context was destroyed|Cannot find context|detached Frame|frame was detached|Inspected target navigated/.test(error.message);

module.exports = { PageState, PageStateError, classifyPageState, isReloadError };
