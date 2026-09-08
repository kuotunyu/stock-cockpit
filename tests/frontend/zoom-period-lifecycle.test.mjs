import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAppWindow } from '../helpers/dom-harness.mjs';

function payload(code, period) {
  return { ok: true, code, name: `測試${code}`, period,
    candles: Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10), open: 100, high: 103, low: 99, close: 102, volume: 1000 })),
    signals: { checks: {}, risks: [] }, trendLines: {}, fibonacci: { active: false }, corporateActions: { events: [], notes: [] } };
}

async function fixture(t, initialPeriod = 'day') {
  const app = await createAppWindow();
  const requests = [];
  t.after(async () => {
    requests.forEach(request => request.reply({ ok: false, error: 'fixture cleanup' }));
    await setImmediate();
    app.cleanup();
  });
  app.win.localStorage.setItem('stock1.zoomHelpSeen.v1', '1');
  app.evalIn(`stocks.splice(0); stocks.push({code:'2330', name:'測試2330', price:102, change:2, changeText:'+2%', spark:[100,102], groups:[], strategies:[], sourceKind:'official'});
    state.screen='technical'; state.technicalCode='2330'; state.technicalPeriod=${JSON.stringify(initialPeriod)};
    state.selectedCode='2330'; technicalState.data=${JSON.stringify(payload('2330', initialPeriod))}; render();`);
  const fetch = app.win.fetch;
  app.win.fetch = (url, init) => {
    if (!String(url).startsWith('/api/technical-analysis?')) return fetch(url, init);
    return new Promise(resolve => requests.push({ url,
      reply: body => resolve({ ok: true, status: 200, json: async () => body, headers: { get: () => 'application/json' } }) }));
  };
  const click = selector => { const button = app.doc.querySelector(selector); button.focus(); button.click(); };
  click('#technicalZoomOpen');
  return { ...app, requests, click,
    async reply(index, body) { requests[index].reply(body); await setImmediate(); },
    display: () => ({ title: app.doc.querySelector('#zoomChartTitle').textContent,
      status: app.doc.querySelector('#zoomChartStatus').textContent,
      statusHidden: app.doc.querySelector('#zoomChartStatus').hidden,
      open: !app.doc.querySelector('#technicalZoomModal').hidden }),
  };
}

for (const sameStock of [false, true]) {
  for (const outcome of ['success', 'failure']) {
    test(`old period ${outcome} cannot repaint a ${sameStock ? 'same-stock' : 'different-stock'} reopened loading chart`, async t => {
      // Same-stock starts with weekly cache: the detail opener requests daily K,
      // so both openings have real pending requests without test-only invalidation.
      const initialPeriod = sameStock ? 'week' : 'day';
      const oldPeriod = sameStock ? 'day' : 'week';
      const newCode = sameStock ? '2330' : '2317';
      const app = await fixture(t, initialPeriod);
      app.click(`[data-zoom-period="${oldPeriod}"]`);
      app.click('#zoomChartClose');
      app.evalIn(`state.selectedCode=${JSON.stringify(newCode)}`);
      app.click('#detailZoomOpen');
      assert.equal(app.requests.length, 2);
      const before = app.display();
      assert.match(before.title, new RegExp(`${newCode}.*載入中`));
      await app.reply(0, outcome === 'success' ? payload('2330', oldPeriod) : { ok: false, error: 'obsolete period failed' });
      assert.deepEqual(app.display(), before, 'old continuation must not replace title or clear the current loading status');
      await app.reply(1, payload(newCode, 'day'));
      assert.match(app.display().title, new RegExp(`${newCode}.*日K`));
      assert.equal(app.display().statusHidden, true);
    });
  }
}

for (const outcome of ['success', 'failure']) {
  test(`same-stock cached reopening rejects the old period ${outcome} without corrupting its daily data`, async t => {
    const app = await fixture(t);
    app.click('[data-zoom-period="week"]');
    app.click('#zoomChartClose');
    app.click('#detailZoomOpen');
    assert.equal(app.requests.length, 1, 'daily cache is reused');
    const before = app.display();
    await app.reply(0, outcome === 'success' ? payload('2330', 'week') : { ok: false, error: 'obsolete week failed' });
    assert.deepEqual(app.display(), before);
    assert.equal(app.evalIn('technicalState.data?.period'), 'day');
    assert.equal(app.evalIn('technicalState.loading'), false);
    assert.equal(app.evalIn('technicalState.error'), '');
  });
}

test('switching period twice keeps the newer period loading until its own response arrives', async t => {
  const app = await fixture(t);
  app.click('[data-zoom-period="week"]');
  app.click('[data-zoom-period="month"]');
  const before = app.display();
  await app.reply(0, payload('2330', 'week'));
  assert.deepEqual(app.display(), before);
  await app.reply(1, payload('2330', 'month'));
  assert.match(app.display().title, /2330.*月K/);
  assert.equal(app.display().statusHidden, true);
});

test('a current period switch completes, displays failure and allows retrying that period', async t => {
  const app = await fixture(t);
  app.click('[data-zoom-period="week"]');
  await app.reply(0, payload('2330', 'week'));
  assert.match(app.display().title, /2330.*週K/);
  assert.equal(app.display().statusHidden, true);
  assert.equal(app.doc.querySelector('[data-zoom-period="week"]').getAttribute('aria-pressed'), 'true');
  app.click('[data-zoom-period="month"]');
  await app.reply(1, { ok: false, error: 'current month failed' });
  assert.match(app.display().status, /current month failed/);
  assert.equal(app.display().open, true);
  assert.equal(app.evalIn('technicalState.data'), null, 'current failure must not masquerade as old weekly data');
  app.click('[data-zoom-period="month"]');
  assert.equal(app.requests.length, 3, 'the selected failed period can be retried directly');
  await app.reply(2, payload('2330', 'month'));
  assert.match(app.display().title, /2330.*月K/);
  assert.equal(app.display().statusHidden, true);
  assert.equal(app.evalIn('technicalState.error'), '');
});

test('week → month → week uses request identity even when code and period match again', async t => {
  const app = await fixture(t);
  app.click('[data-zoom-period="week"]');
  app.click('[data-zoom-period="month"]');
  app.click('[data-zoom-period="week"]');
  const before = app.display();
  await app.reply(0, payload('2330', 'week'));
  assert.deepEqual(app.display(), before);
  await app.reply(1, { ok: false, error: 'obsolete month failed' });
  assert.deepEqual(app.display(), before);
  await app.reply(2, payload('2330', 'week'));
  assert.match(app.display().title, /2330.*週K/);
  assert.equal(app.display().statusHidden, true);
});
