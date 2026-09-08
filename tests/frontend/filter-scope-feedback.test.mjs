import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

test('隔日沖局部重繪隱藏或恢復行情列表時，也同步篩選狀態', async () => {
  const app = await createAppWindow();
  try {
    app.evalIn(`state.screen = 'overnight'; state.overnightView = 'overview'; state.direction = 'up';
      overnightState.loaded = false; overnightState.loading = false; overnightState.error = ''; overnightState.groups = null; render();`);
    const button = app.doc.getElementById('filterOpen');
    assert.equal(button.classList.contains('has-active-filter'), true);
    await app.evalIn('loadOvernightSignals()');
    assert.equal(app.doc.querySelector('[data-screen-panel="overnight"] .quote-table').hidden, true);
    assert.equal(button.classList.contains('has-active-filter'), false, '載入失敗後不可宣稱作用中');
    app.evalIn(`overnightState.loaded = false; overnightState.loading = false; overnightState.error = ''; renderOvernightGroups();`);
    assert.equal(button.classList.contains('has-active-filter'), true, '恢復行情列表也要恢復狀態');
  } finally { await app.settle(); app.cleanup(); }
});

test('全域清單篩選在不適用的頁面說明範圍，不宣稱目前清單已被過濾', async () => {
  const app = await createAppWindow();
  try {
    app.doc.querySelector('.nav-action[data-screen="screener"]').click();
    app.doc.getElementById('filterOpen').click();
    app.doc.getElementById('directionFilter').value = 'up';
    app.doc.getElementById('filterApply').click();
    assert.equal(app.doc.getElementById('filterOpen').classList.contains('has-active-filter'), true);
    for (const screen of ['watchlist', 'strategy', 'technical', 'surveillance', 'more']) {
      app.doc.querySelector(`.nav-action[data-screen="${screen}"]`).click();
      const button = app.doc.getElementById('filterOpen');
      assert.equal(button.classList.contains('has-active-filter'), false, `${screen} 不應宣稱套用於本頁`);
      button.click();
      assert.match(app.doc.getElementById('filterScopeNote')?.textContent || '', /目前頁面不受/);
      assert.match(app.doc.getElementById('filterScopeNote').textContent, /盤中選股/);
      app.doc.getElementById('filterClose').click();
    }
    app.doc.querySelector('.nav-action[data-screen="screener"]').click();
    app.doc.getElementById('filterOpen').click();
    assert.equal(app.doc.getElementById('directionFilter').value, 'up', '保留明確設定，不偷偷清掉條件');
    assert.match(app.doc.getElementById('filterScopeNote').textContent, /目前的行情列表/);
    app.doc.getElementById('filterClose').click();
  } finally { await app.settle(); app.cleanup(); }
});
