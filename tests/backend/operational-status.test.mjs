// 保存與採集診斷只讀已提交摘要；正式零訊號、來源不足與補驗失敗各自保留語意。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { bootServer } from '../helpers/test-server.mjs';
import { compactToday } from '../helpers/fixtures.mjs';

const srv = await bootServer({ env: { SCHEDULER: 'off' } });
after(() => srv.close());
const today = compactToday();
const iso = `${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}`;
function formal(db, strategy = 'overnight') {
  return srv.mod.publishVerification(db, strategy, { asOf: iso,
    formulaVersion: strategy === 'overnight' ? srv.mod.OVERNIGHT_FORMULA_VERSION : srv.mod.SWING_FORMULA_VERSION,
    requestScope: srv.mod.canonicalVerificationScope(strategy), coverage: { complete: true, markets: { twse: { asOf: iso }, tpex: { asOf: iso } } },
    candidatePool: [], inputEvidence: [], scanQuality: { candidateCount: 0, completedCount: 0, reliable: true }, groups: {}, picks: [] });
}

test('正式零訊號優先於來源不足與後續失敗，舊正式紀錄缺 manifest 仍是發布事實', () => {
  const db = {}; const pub = formal(db);
  srv.mod.recordCaptureAttempt(db, null, today, { stage: 'reference', status: 'incomplete', reason: 'reference-not-today' });
  srv.mod.recordCaptureAttempt(db, 'overnight', today, { status: 'failed', reason: 'secret/path/token' });
  const result = srv.mod.summarizeOperationalStatus(db, { today });
  assert.equal(result.captures.overnight.today.status, 'published');
  assert.equal(result.captures.overnight.today.signalCount, 0);
  assert.equal(result.captures.overnight.latest?.tradeDate, iso);
  assert.equal(result.captures.swing.today.status, 'unknown');
  assert.equal(result.input.status, 'incomplete');
  assert.equal(result.input.reason, 'reference-not-today');
  delete db.verificationCaptures[pub.captureId];
  assert.equal(srv.mod.summarizeOperationalStatus(db, { today }).captures.overnight.today.status, 'published');
});

test('只讀白名單 metadata，待補分單位且不解壓、不輸出原原因或私人資料', () => {
  const db = { users: [{ secret: 'private-account' }] }; const pub = formal(db);
  const capture = db.verificationCaptures[pub.captureId];
  db.verificationBenchmarks = { memos: { [srv.mod.benchmarkMemoKey(capture)]: { status: 'unavailable', reason: 'secret/path/token', retryAt: Date.now() + 60000 } } };
  const memo = Object.values(db.verificationBenchmarks.memos)[0];
  for (const key of ['observations', 'evidenceBlob', 'result']) Object.defineProperty(memo, key, { get() { throw Error(`forbidden ${key}`); } });
  db.swingVerification = { older: [{ status: 'pending' }, { status: 'win' }] };
  srv.mod.recordCaptureAttempt(db, 'swing', today, { status: 'failed', reason: 'secret/path/token' });
  const result = srv.mod.summarizeOperationalStatus(db, { today });
  assert.deepEqual(result.history, { scope: 'all-stored-versions', overnight: { total: 1, withoutFinal: 1 }, swing: { total: 2, pending: 1 }, benchmarks: { total: 1, pending: 0, unavailable: 1, complete: 0 } });
  assert.equal(result.captures.swing.today.status, 'failed');
  assert.equal(result.captures.swing.today.reason, 'source-unavailable');
  assert.doesNotMatch(JSON.stringify(result), /secret|private-account|observations|evidenceBlob/);
  memo.status = 'pending'; memo.reason = 'official-calendar-source-unavailable';
  assert.equal(srv.mod.summarizeOperationalStatus(db, { today }).history.benchmarks.unavailable, 1, '日曆來源失敗也是補驗受阻');
  memo.reason = 'official-session-horizon-unavailable';
  assert.equal(srv.mod.summarizeOperationalStatus(db, { today }).history.benchmarks.pending, 1, '尚未到期不能染成來源錯誤');
});

test('公開診斷重複 GET 不寫入、不排背景工作且只看已提交 RAM', async () => {
  await srv.mod.commitDbMutation(db => { formal(db); return true; });
  await srv.mod.flushPersistence();
  const dbPath = join(srv.dataDir, 'stock1-db.json');
  const before = await readFile(dbPath, 'utf8'); const calls = srv.mock.calls.length;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const writing = srv.mod.commitDbMutation(async draft => { formal(draft, 'swing'); await gate; return true; });
  try {
    for (let i = 0; i < 2; i++) {
      const response = await srv.raw('/api/operational-status'); assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.captures.overnight.today.signalCount, 0);
      assert.equal(body.captures.swing.today.status, 'unknown');
      assert.equal(body.scheduler.enabled, false);
      assert.equal(body.persistence.basis, 'known-failures-this-process');
      assert.doesNotMatch(JSON.stringify(body), /test-admin|password|stock1-db|stock1-test-|APP_SECRET/);
    }
    assert.equal(await readFile(dbPath, 'utf8'), before);
    assert.equal(srv.mock.calls.length, calls, '診斷不抓上游／不間接排 benchmark');
  } finally { release(); await writing; }
  const method = await srv.raw('/api/operational-status', { method: 'POST' });
  assert.equal(method.status, 405); await method.text();
});

test('已發布後補驗失敗只反映排程受阻；保存失敗與 health ready 分開，恢復後清除', async () => {
  const db = await srv.mod.loadDb();
  await assert.rejects(srv.mod.runScheduledCloseTasks({ now: new Date(), loadDb: async () => db,
    getReferenceData: async () => ({ coverageComplete: true, markets: { twse: { asOf: iso }, tpex: { asOf: iso } } }),
    advanceSwingVerification: async () => { throw Error('secret/path/token'); } }));
  let body = await (await srv.raw('/api/operational-status')).json();
  assert.equal(body.captures.swing.today.status, 'published');
  assert.equal(body.scheduler.failures, 1);
  const blocker = join(srv.dataDir, 'stock1-db.json.tmp'); await mkdir(blocker);
  try {
    await assert.rejects(srv.mod.commitDbMutation(draft => { draft.sharedRevs.operationalTest = 1; }));
    body = await (await srv.raw('/api/operational-status')).json();
    assert.equal(body.persistence.writable, false);
    const health = await srv.raw('/api/health'); assert.equal(health.status, 200); await health.json();
  } finally { await rmdir(blocker); }
  const repairedBytes = await readFile(join(srv.dataDir, 'stock1-db.json'), 'utf8');
  for (let i = 0; i < 2; i++) {
    const known = (await (await srv.raw('/api/operational-status')).json()).persistence;
    assert.equal(known.writable, false, '解除磁碟故障後，唯讀 GET 不試寫或清除已知失敗');
    assert.equal(known.lastFailureAt, body.persistence.lastFailureAt);
  }
  assert.equal(await readFile(join(srv.dataDir, 'stock1-db.json'), 'utf8'), repairedBytes);
  await srv.mod.commitDbMutation(draft => { draft.sharedRevs.operationalTest = 2; });
  assert.equal((await (await srv.raw('/api/operational-status')).json()).persistence.writable, true);
});

test('台北午夜前今日達上限，午夜後只保留前日紀錄，GET 不重設排程或寫入', async t => {
  const m = srv.mod;
  m.resetCloseSchedulerStateForTest();
  const midnight = Date.parse(`${iso}T16:00:00Z`);
  try {
    for (const hours of [4, 3, 2]) await assert.rejects(m.runScheduledCloseTasks({
      now: new Date(midnight - hours * 3600000), loadDb: async () => ({}),
      getReferenceData: async () => { throw Error('synthetic source unavailable'); },
    }), /synthetic source unavailable/);
    const original = m.closeSchedulerStateForTest();
    assert.equal(original.failures, m.SCHEDULER_MAX_FAILURES_PER_DAY);
    assert.equal(original.failureDay, today);
    const before = await readFile(join(srv.dataDir, 'stock1-db.json'), 'utf8');
    const calls = srv.mock.calls.length;
    t.mock.timers.enable({ apis: ['Date'], now: midnight - 1 });
    let result = await (await srv.raw('/api/operational-status')).json();
    assert.equal(result.asOf, iso);
    assert.equal(result.scheduler.dailyLimitReached, true);
    t.mock.timers.setTime(midnight);
    for (let i = 0; i < 2; i++) {
      result = await (await srv.raw('/api/operational-status')).json();
      assert.notEqual(result.asOf, iso);
      assert.equal(result.scheduler.dailyLimitReached, false);
      assert.equal(result.scheduler.failures, original.failures);
      assert.equal(result.scheduler.failureDay, today);
      assert.equal(result.scheduler.retryAt, new Date(original.retryAt).toISOString());
      assert.equal(result.scheduler.lastRunDay, null, '不能虛構新日成功');
      assert.deepEqual(m.closeSchedulerStateForTest(), original);
    }
    assert.equal(await readFile(join(srv.dataDir, 'stock1-db.json'), 'utf8'), before);
    assert.equal(srv.mock.calls.length, calls);
  } finally { t.mock.timers.reset(); m.resetCloseSchedulerStateForTest(); }
});
