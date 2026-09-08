import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());
const tabs = ['aboutToDispose', 'inDisposition', 'aboutToRelease', 'blockTrades', 'attention', 'changedTrading'];

for (const tab of tabs) {
  test(`${tab}：自選股確實在公告內，但被市場或搜尋條件排除時，不可宣稱不存在`, () => {
    app.evalIn(`
      state.screen = 'surveillance';
      state.surveillanceTab = ${JSON.stringify(tab)};
      state.survMineOnly = true; state.survMarket = 'all'; state.survQuery = ''; state.survInterval = 'all';
      watchLists[1] = new Set(['9901']); watchLists[2] = new Set(); watchLists[3] = new Set();
      surveillanceBoardState.loading = false; surveillanceBoardState.error = '';
      surveillanceBoardState.data = { counts: {}, warnings: [], [state.surveillanceTab]: [
        { code: '9901', name: '測試自選股', exchange: 'TPEx', interval: 5 }
      ] };
      renderSurveillanceScreen();
    `);
    assert.equal(app.doc.querySelectorAll('#survBoard .surv-card').length, 1);
    app.doc.querySelector('[data-surv-market="TWSE"]').click();
    assert.match(app.doc.querySelector('#survBoard .surv-empty').textContent, /自選股.*被.*篩選/);
    app.doc.querySelector('[data-surv-market="all"]').click();
    const search = app.doc.getElementById('survSearch');
    search.value = '不符合的名稱';
    search.dispatchEvent(new app.win.Event('input', { bubbles: true }));
    assert.match(app.doc.querySelector('#survBoard .surv-empty').textContent, /自選股.*被.*篩選/);
    search.value = '';
    search.dispatchEvent(new app.win.Event('input', { bubbles: true }));
    assert.equal(app.doc.querySelectorAll('#survBoard .surv-card').length, 1);
    app.evalIn('watchLists[1].clear(); renderSurveillanceScreen();');
    assert.match(app.doc.querySelector('#survBoard .surv-empty').textContent, /你的自選股目前沒有在這個分頁/);
  });
}
