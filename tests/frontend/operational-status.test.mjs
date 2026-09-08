// 更多頁保存診斷分清讀取、保存、正式零訊號與待補；錯誤未知可重新查詢且保持收合與焦點。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

const payload = { ok: true, generatedAt: new Date().toISOString(), asOf: '2026-09-08', persistence: { writable: true, pendingWrites: 2, basis: 'known-failures-this-process' }, sidecars: {},
  scheduler: { enabled: true, running: true, failures: 0 }, input: null,
  captures: { overnight: { today: { status: 'published', signalCount: 0 }, latest: null }, swing: { today: { status: 'unknown' }, latest: null } },
  history: { scope: 'all-stored-versions', overnight: { total: 3, withoutFinal: 1 }, swing: { total: 4, pending: 2 }, benchmarks: { total: 2, complete: 1, pending: 0, unavailable: 1 } } };
function show(app, value = payload, error = '') {
  app.evalIn(`Object.assign(operationalStatusState, { loaded: true, payload: ${JSON.stringify(value)}, error: ${JSON.stringify(error)}, loading: false });
    Object.assign(dataState, { failedSince: '', error: '', lastUpdated: '14:00:00' }); state.screen='more'; state.morePanel='source'; render();`);
  return app.doc.querySelector('.operational-status');
}
test('預設收合，行情正常但不可寫另提示；pending與零訊號不當失敗', async () => {
  const app = await createAppWindow();
  try {
    let panel = show(app); assert.equal(panel.open, false);
    assert.match(panel.textContent, /行情讀取[\s\S]*最近一次讀取成功/);
    assert.match(panel.textContent, /尚無已知保存失敗/); assert.match(panel.textContent, /2 筆等待保存/);
    assert.match(panel.textContent, /正式發布・0 筆訊號/);
    assert.match(panel.textContent, /全部已保存版本/); assert.match(panel.textContent, /未知/);
    panel = show(app, { ...payload, persistence: { writable: false, lastFailureCode: 'ENOSPC' } });
    assert.match(panel.textContent, /保存受阻/); assert.match(panel.textContent, /磁碟空間與寫入權限/);
    const saveNext = [...panel.querySelectorAll('.operational-rows > div')].find(row => row.querySelector('dt').textContent === '資料保存').querySelector('p').textContent;
    assert.match(saveNext, /查詢只讀.*已知狀態/);
    assert.match(saveNext, /後續.*實際成功保存.*清除/);
    assert.match(panel.textContent, /最近一次讀取成功/);
    panel = show(app, { ...payload, sidecars: { fundamentals: { readOnly: true, reason: 'EACCES' } } });
    assert.match(panel.textContent, /部分資料唯讀/);
    panel = show(app, { ...payload, persistence: { writable: true }, history: null });
    assert.match(panel.textContent, /等待保存筆數未知/);
    assert.match(panel.textContent, /待補數量未知/);
  } finally { app.cleanup(); }
});
test('前日排程失敗留作歷史，不能稱今日受阻或承諾舊重試時間', async () => {
  const app = await createAppWindow();
  try {
    const scheduler = { enabled: true, running: true, failures: 3, failureDay: '20260907', retryAt: '2026-09-07T08:00:00Z', dailyLimitReached: false };
    let panel = show(app, { ...payload, scheduler });
    assert.match(panel.textContent, /前日.*紀錄/);
    assert.match(panel.textContent, /20260907/);
    assert.doesNotMatch(panel.textContent, /最近一輪排程受阻|今日重試已達上限|最早重試/);
    panel = show(app, { ...payload, scheduler: { ...scheduler, failureDay: '20260908', dailyLimitReached: true } });
    assert.match(panel.textContent, /今日重試已達上限/);
    panel = show(app, { ...payload, scheduler: { ...scheduler, failureDay: '20260908', failures: 1 } });
    assert.match(panel.textContent, /最近一輪排程受阻/);
    assert.match(panel.textContent, /最早重試/);
  } finally { app.cleanup(); }
});
test('來源暫缺、正式後補驗失敗、排程關閉和查不到各自說明，不臆測停機', async () => {
  const app = await createAppWindow();
  try {
    let panel = show(app, { ...payload, input: { status: 'incomplete', reason: 'reference-not-today' }, scheduler: { enabled: false, failures: 1 } });
    assert.match(panel.textContent, /最近保存的來源不足/); assert.match(panel.textContent, /排程已關閉/);
    assert.match(panel.textContent, /正式發布・0 筆訊號/); assert.match(panel.textContent, /補驗來源受阻 1 批/);
    assert.doesNotMatch(panel.textContent, /沒開程式|未開程式|採集失敗|全部驗證完成/);
    panel.open = true; panel.querySelector('summary').focus(); app.evalIn('renderLiveDataUpdate()');
    panel = app.doc.querySelector('.operational-status'); assert.equal(panel.open, true);
    assert.equal(app.doc.activeElement.id, 'operationalStatusToggle');
    panel = show(app, null, '<img src=x onerror=alert(1)>');
    assert.match(panel.textContent, /狀態未知/); assert.equal(panel.querySelector('img'), null);
  } finally { app.cleanup(); }
});
test('有界查詢 body 逾時後釋放 loading 並可重試，不沿用舊成功狀態', { timeout: 10000 }, async () => {
  const app = await createAppWindow();
  try {
    show(app);
    app.evalIn(`const operationalFetch = fetchApi; fetchApi = (path, options) => operationalFetch(path, { ...options, timeoutMs: 30 });`);
    let signal;
    app.win.fetch = async (_url, init) => { signal = init.signal; return { ok: true, status: 200, json: () => new Promise(() => {}) }; };
    await app.evalIn('loadOperationalStatus()');
    assert.equal(signal.aborted, true);
    assert.equal(app.evalIn('operationalStatusState.loading'), false);
    assert.match(app.doc.querySelector('.operational-status').textContent, /狀態未知/);
    assert.match(app.doc.querySelector('.operational-status').textContent, /上次成功查詢/);
    app.win.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
    await app.evalIn('loadOperationalStatus()');
    assert.equal(app.evalIn('operationalStatusState.error'), '');
    assert.match(app.doc.querySelector('.operational-status').textContent, /正式發布・0 筆訊號/);
  } finally { app.cleanup(); }
});
