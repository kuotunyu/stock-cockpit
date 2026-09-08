import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAppWindow } from '../helpers/dom-harness.mjs';

// Control only the search debounce. Responses are released explicitly, with no
// elapsed-time assumptions and no requests outside the DOM harness.
async function searchFixture(t) {
  const requests = [];
  const app = await createAppWindow({ fetchRoutes: {
    '/api/symbols': (url) => new Promise((resolve, reject) => {
      requests.push({ query: new URL(url, 'http://127.0.0.1').searchParams.get('q'), resolve, reject });
    }),
  } });
  t.after(async () => {
    await setImmediate();
    app.cleanup();
  });
  const timers = new Map();
  const originalSet = app.win.setTimeout.bind(app.win);
  const originalClear = app.win.clearTimeout.bind(app.win);
  let nextId = -1;
  app.win.setTimeout = (fn, delay, ...args) => {
    if (delay !== 250) return originalSet(fn, delay, ...args);
    const id = nextId--;
    timers.set(id, () => fn(...args));
    return id;
  };
  app.win.clearTimeout = (id) => {
    if (!timers.delete(id)) originalClear(id);
  };
  app.evalIn('stocks.splice(0); state.selectedCode = "2330";');
  const input = app.doc.getElementById('searchInput');
  const results = app.doc.getElementById('searchResults');
  const open = () => app.doc.getElementById('searchOpen').click();
  open();
  return {
    ...app, requests, input, results, open,
    type(query) {
      input.value = query;
      input.dispatchEvent(new app.win.Event('input', { bubbles: true }));
    },
    debounce() {
      assert.equal(timers.size, 1, 'one current query is scheduled');
      const [id, run] = [...timers][0];
      timers.delete(id);
      run();
    },
    async reply(index, rows) {
      requests[index].resolve({ ok: true, results: rows });
      await setImmediate();
    },
    async fail(index, message) {
      requests[index].reject(new Error(message));
      await setImmediate();
    },
    codes: () => [...results.querySelectorAll('.search-result')].map((row) => row.dataset.code),
    state: () => JSON.parse(app.evalIn('JSON.stringify(searchState)')),
  };
}

const oldRows = [{ code: '9901', name: '舊甲公司', exchange: 'TWSE' }];
const newRows = [{ code: '9902', name: '新乙公司', exchange: 'TWSE' }];

test('new input removes completed remote results before debounce and Enter cannot select the old stock', async (t) => {
  const app = await searchFixture(t);
  app.type('舊甲');
  app.debounce();
  await app.reply(0, oldRows);
  assert.deepEqual(app.codes(), ['9901']);
  app.type('新乙');
  app.input.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(app.evalIn('state.selectedCode'), '2330');
  assert.deepEqual(app.codes(), []);
  assert.match(app.results.textContent, /正在搜尋/);
  app.debounce();
  await app.reply(1, newRows);
  assert.deepEqual(app.codes(), ['9902']);
});

for (const outcome of ['success', 'failure']) {
  test(`old ${outcome} during the next debounce cannot change its results, message or loading state`, async (t) => {
    const app = await searchFixture(t);
    app.type('舊甲');
    app.debounce();
    app.type('新乙');
    const html = app.results.innerHTML;
    if (outcome === 'success') await app.reply(0, oldRows);
    else await app.fail(0, '舊查詢失敗');
    assert.equal(app.results.innerHTML, html);
    assert.equal(app.state().error, '');
    assert.equal(app.state().loading, true);
    app.debounce();
    await app.reply(1, newRows);
    assert.deepEqual(app.codes(), ['9902']);
  });
  test(`old ${outcome} after a newer response cannot replace the current result`, async (t) => {
    const app = await searchFixture(t);
    app.type('舊甲');
    app.debounce();
    app.type('新乙');
    app.debounce();
    await app.reply(1, newRows);
    const html = app.results.innerHTML;
    if (outcome === 'success') await app.reply(0, oldRows);
    else await app.fail(0, '舊查詢失敗');
    assert.equal(app.results.innerHTML, html);
    assert.equal(app.state().error, '');
    assert.equal(app.state().loading, false);
  });
}

test('A → B → A creates a new request identity before the second A debounce', async (t) => {
  const app = await searchFixture(t);
  app.type('甲');
  app.debounce();
  app.type('乙');
  app.type('甲');
  await app.reply(0, oldRows);
  assert.deepEqual(app.codes(), []);
  assert.equal(app.state().loading, true);
  app.debounce();
  await app.reply(1, newRows);
  assert.deepEqual(app.codes(), ['9902']);
  assert.deepEqual(app.requests.map((request) => request.query), ['甲', '甲']);
});

for (const action of ['clear', 'close and reopen']) {
  for (const outcome of ['success', 'failure']) {
  test(`${action} invalidates an in-flight ${outcome} even when the next query is identical`, async (t) => {
    const app = await searchFixture(t);
    app.type('甲');
    app.debounce();
    if (action === 'clear') app.type('');
    else {
      app.doc.getElementById('searchClose').click();
      app.open();
    }
    assert.equal(app.state().query, '');
    assert.equal(app.state().loading, false);
    app.type('甲');
    if (outcome === 'success') await app.reply(0, oldRows);
    else await app.fail(0, '已關閉查詢失敗');
    assert.deepEqual(app.codes(), []);
    assert.equal(app.state().error, '');
    assert.equal(app.state().loading, true);
    app.debounce();
    await app.reply(1, newRows);
    assert.deepEqual(app.codes(), ['9902']);
  });
  }
  test(`${action} cancels a pending debounce without issuing a request`, async (t) => {
    const app = await searchFixture(t);
    app.type('甲');
    if (action === 'clear') app.type('');
    else {
      app.doc.getElementById('searchClose').click();
      app.open();
    }
    assert.equal(app.state().timer, null);
    assert.equal(app.requests.length, 0);
    app.type('乙');
    app.debounce();
    await app.reply(0, newRows);
    assert.deepEqual(app.requests.map((request) => request.query), ['乙']);
    assert.deepEqual(app.codes(), ['9902']);
  });
}

test('current error is visible and cleared immediately on new input; local matches remain available', async (t) => {
  const app = await searchFixture(t);
  app.type('失敗');
  app.debounce();
  await app.fail(0, '目前搜尋失敗');
  assert.match(app.results.textContent, /目前搜尋失敗/);
  assert.equal(app.state().loading, false);
  app.evalIn(`stocks.push({ code: '9903', name: '本機公司', exchange: 'TWSE', official: true, change: 0, changeText: '--' });`);
  app.type('本機');
  assert.deepEqual(app.codes(), ['9903']);
  assert.doesNotMatch(app.results.textContent, /目前搜尋失敗/);
  app.debounce();
  await app.reply(1, [{ code: '9903', name: '本機公司' }]);
  assert.deepEqual(app.codes(), ['9903'], 'remote/local duplicates are still removed');
});
