// 合成診斷的固定種子、樣本分位與正式資料拒絕：不以機器速度決定 CI 成敗。
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSamples, seededRandom, validateMeasurementOptions, withExpectedFixtureDiagnostic } from '../../scripts/verification-measurement.mjs';
import { buildSyntheticDb } from '../../scripts/verification-diagnostics.mjs';
import { importServer } from '../helpers/test-server.mjs';
import { prepareCompletedBenchmark, readBenchmarkEvidence } from '../../verification-evidence.mjs';
import { rm, mkdir, rmdir, readFile } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';

test('少量樣本不冒稱 p95，50 筆 nearest-rank 保留 raw 與離群值', () => {
  const small=describeSamples([3,1,2]);
  assert.equal(small.p95,undefined);assert.deepEqual(small.raw,[3,1,2]);assert.equal(small.mean,2);
  const enough=describeSamples(Array.from({length:50},(_,i)=>i+1));
  assert.equal(enough.p50,25);assert.equal(enough.p95,48);assert.equal(enough.max,50);
  assert.throws(()=>describeSamples([NaN]));assert.throws(()=>describeSamples([]));
});

test('相同種子可重現，不同種子不同；CLI 不接受 DB 路徑或任意規模', () => {
  const values=seed=>{const next=seededRandom(seed);return Array.from({length:10},next);};
  assert.deepEqual(values(8082026),values(8082026));assert.notDeepEqual(values(1),values(2));
  assert.deepEqual(validateMeasurementOptions('5','mixed'),{days:5,format:'mixed'});
  for(const args of [['.data/stock1-db.json','raw'],['0','raw'],['21','raw'],['5','sqlite']])assert.throws(()=>validateMeasurementOptions(...args));
});

test('同種子合成 cohort 身份可重現，來源／出版／完整月份／摘要窗口有一致先後且 codec 無損', async () => {
  const srv=await importServer();
  try {
    const m=srv.mod,db=await withExpectedFixtureDiagnostic(()=>m.loadDb(),{kind:'admin'});
    const first=structuredClone(db),second=structuredClone(first);
    await buildSyntheticDb(m,first,2,{random:seededRandom(8082026)});
    await buildSyntheticDb(m,second,2,{random:seededRandom(8082026)});
    assert.deepEqual(Object.keys(first.verificationCaptures),Object.keys(second.verificationCaptures));
    for(const memo of Object.values(first.verificationBenchmarks.memos)) {
      const capture=first.verificationPublications.captures[memo.captureId];
      // 證據只存在擷取清單的 outcomes（發布紀錄自 2026-09-12 起只留 inputEvidenceRef）
      const evidence=first.verificationCaptures[memo.captureId]?.outcomes||capture.inputEvidence;
      assert.ok(evidence.every(row=>row.observedAt<=capture.publishedAt));
      for(const month of Object.values(memo.calendar.monthEvidence)) {
        assert.ok(month.coveredThrough<=month.observedAt.slice(0,10).replaceAll('-',''));
        assert.ok(month.observedAt<=memo.completedAt);
      }
      assert.deepEqual(readBenchmarkEvidence(prepareCompletedBenchmark(memo)),readBenchmarkEvidence(memo));
    }
    for(const strategy of ['overnight','swing']) {
      const summary=m.summarizeVerificationBenchmarks(first,strategy,{asOf:'20260301'});
      assert.equal(summary.window.asOf,'2026-03-01');assert.equal(summary.cohorts.length,2);
      assert.ok(summary.window.fromDate>='2026-01-01');
    }
    const blocker=join(srv.dataDir,'stock1-db.json.tmp');
    const before=await readFile(join(srv.dataDir,'stock1-db.json'),'utf8');
    await mkdir(blocker);
    try {
      await withExpectedFixtureDiagnostic(()=>assert.rejects(m.commitDbMutation(draft=>{draft.sharedRevs.synthetic=1;}),{code:'PERSISTENCE_FAILED'}),{kind:'atomic',blocker});
      assert.strictEqual(await m.loadDb(),db);
      assert.equal(db.sharedRevs.synthetic,undefined);
      assert.equal(await readFile(join(srv.dataDir,'stock1-db.json'),'utf8'),before);
    } finally {await rmdir(blocker);}
  }finally{
    await srv.mod.shutdownServer();srv.mock.restore();
    const path=resolve(srv.dataDir);assert.equal(dirname(path),resolve(tmpdir()));assert.ok(basename(path).startsWith('stock1-test-'));await rm(path,{recursive:true,force:true});
  }
});
