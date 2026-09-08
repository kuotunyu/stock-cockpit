// DOM 互動與作用域契約；teardown 排空已完成回應再關閉視窗。
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

async function screenerFixture(t) {
  const app = await createAppWindow();
  t.after(async () => { await setImmediate(); app.cleanup(); });
  app.evalIn(`
    stocks.splice(0);
    stocks.push(...[
      { code: '1101', name: '量能樣本', strategies: ['量能熱區'] },
      { code: '1102', name: '高危樣本', strategies: ['換手高危'] },
    ].map(stock => ({ ...stock, groups: ['turnover'], price: 10, change: 1,
      changeText: '+1%', total: 100, spark: [9, 10] })));
    state.selectedCode = '';
  `);
  const click = (selector) => app.doc.querySelector(selector).click();
  click('.nav-action[data-screen="screener"]');
  click('[data-universe="turnover"]');
  return { ...app, click };
}

function assertMode(app, mode, strategy, code) {
  assert.equal(app.evalIn('state.strategy'), strategy);
  assert.deepEqual([...app.doc.querySelectorAll('#screenerRows .stock-row')].map(row => row.dataset.code), [code]);
  assert.deepEqual([...app.doc.querySelectorAll('.focus-switch .is-active')].map(button => button.dataset.focus), [mode]);
  assert.deepEqual([...app.doc.querySelectorAll('.focus-switch [aria-selected="true"]')].map(button => button.dataset.focus), [mode]);
  assert.equal(app.doc.querySelector(`[data-focus="${mode}"]`).tabIndex, 0);
}

for (const universe of ['strong', 'weak', 'intraday']) {
  test(`leaving danger for ${universe} and returning to turnover shows the actual selected mode`, async (t) => {
    const app = await screenerFixture(t);
    app.click('[data-focus="danger"]');
    assertMode(app, 'danger', '換手高危', '1102');
    app.click(`[data-universe="${universe}"]`);
    app.click('[data-universe="turnover"]');
    assertMode(app, 'capital', '量能熱區', '1101');
    app.evalIn('renderLiveDataUpdate()');
    assertMode(app, 'capital', '量能熱區', '1101');
  });
}

test('mode buttons and navigation preserve the selected strategy and its results together', async (t) => {
  const app = await screenerFixture(t);
  app.click('[data-focus="danger"]');
  app.click('.nav-action[data-screen="watchlist"]');
  app.click('.nav-action[data-screen="screener"]');
  assertMode(app, 'danger', '換手高危', '1102');
  app.click('[data-focus="capital"]');
  assertMode(app, 'capital', '量能熱區', '1101');
});
