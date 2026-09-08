import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAppWindow } from '../helpers/dom-harness.mjs';

test('分析新週期時，放大入口不能把保留的舊K線當成目前結果', async () => {
  let reply;
  const started = Promise.withResolvers();
  const app = await createAppWindow({ fetchRoutes: {
    '/api/technical-analysis': () => new Promise(resolve => { reply = resolve; started.resolve(); }),
  } });
  try {
    app.evalIn(`state.screen = 'technical'; state.technicalCode = '2330'; state.technicalPeriod = 'day';
      technicalState.data = { code: '2330', name: '測試', period: 'day', candles: [{ date: new Date().toISOString().slice(0, 10).replaceAll('-', ''), open: 100, high: 102, low: 99, close: 101 }] };`);
    app.doc.querySelector('[data-analysis-period="week"]').click();
    await started.promise;
    assert.equal(app.evalIn('technicalState.loading'), true);
    app.doc.getElementById('technicalZoomOpen').click();
    assert.equal(app.doc.getElementById('technicalZoomModal').hidden, true);
    assert.match(app.doc.getElementById('toastStack').textContent, /分析中/);
    app.doc.getElementById('technicalHelpOpen').click();
    assert.equal(app.doc.getElementById('zoomChartHelp').hidden, false, '分析中仍可閱讀操作說明');
    app.doc.getElementById('zoomChartHelpClose').click();
  } finally {
    reply?.({ ok: false, error: '受控結束' });
    await setImmediate();
    await app.settle();
    app.cleanup();
  }
});
