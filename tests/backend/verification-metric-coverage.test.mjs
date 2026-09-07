// 合法已存final觀察的逐欄缺值分母、有效日期與正式history接線。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { importServer } from '../helpers/test-server.mjs';
import { compactTradingDay, stockDayAllRow } from '../helpers/fixtures.mjs';
const { mod, mock, dataDir } = await importServer({ routes: [
  { match: /STOCK_DAY_ALL/, reply: () => [stockDayAllRow({ code: '2330' })] },
  { match: () => true, reply: () => [] },
] });
after(async () => { await mod.shutdownServer(); mock.restore(); await rm(dataDir, { recursive: true, force: true }); });
const initLogs = []; const originalLog = console.warn;
try {
  console.warn = (...args) => initLogs.push(args.join(' '));
  await mod.loadDb();
} finally { console.warn = originalLog; }
assert.equal(initLogs.length, 1);
assert.match(initLogs[0], /^\[Stock1\] Created initial admin user "admin"\./);
const iso = x => `${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6,8)}`;

test('I2：未知成本原true/false不升格有效淨勝負，原memo不改寫', async () => {
  const snapshots=[true,false].map((win,i)=>({asOf:iso(compactTradingDay(-8+i)),formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,
    picks:[{code:'2330',exchange:'TWSE',price:100}],observed:{complete:true,status:'final',formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,
      observationDate:iso(compactTradingDay(-7+i)),warnings:[],rows:[{code:'2330',verified:true,openReturn:win?10:0,currentReturn:win?10:0,
        highReturn:12,lowReturn:-1,winAtOpen:win,winAtClose:win,hitPlus2:true,brokeMinus2:false}]}}));
  await mod.commitDbMutation(db=>{db.signalSnapshots=structuredClone(snapshots);});
  assert.ok(snapshots.every(snapshot=>mod.storedObservationFor(snapshot)));
  const summary=await mod.buildVerificationHistory();
  for (const field of ['winAtOpen','winAtClose','avgOpenReturnNet','avgCloseReturnNet']) {
    const coverage=summary.totals.metricCoverage[field];
    assert.equal(coverage.value,null);
    assert.equal(coverage.validCount,0);
    assert.equal(coverage.validDays,0);
    assert.equal(coverage.reason,'legacy-unknown-cost-model');
  }
  assert.equal(summary.totals.ci.winAtOpen,null);
  assert.equal(summary.totals.ci.winAtClose,null);
  assert.deepEqual((await mod.loadDb()).signalSnapshots.map(s=>s.observed),snapshots.map(s=>s.observed));
});

test('finite metric 保留0，缺值不轉0，完整揭露逐欄分母', () => {
  assert.equal(typeof mod.summarizeFiniteMetric, 'function');
  assert.deepEqual(mod.summarizeFiniteMetric([0, 10, null]), { value: 5, validCount: 2, totalCount: 3, missingCount: 1, reason: 'partial-field-coverage' });
  assert.deepEqual(mod.summarizeFiniteMetric([null, undefined, '', NaN, Infinity, false]), { value: null, validCount: 0, totalCount: 6, missingCount: 6, reason: 'no-valid-values' });
  assert.equal(mod.summarizeFiniteMetric([0]).value, 0);
});

test('合法已存final：不同日/欄位有效筆數加權，缺開盤不是輸且不借收盤日期做CI', async () => {
  const db = await mod.loadDb();
  db.signalSnapshots = [[10, 0], [null]].map((values, i) => ({
    asOf: iso(compactTradingDay(i - 5)), formulaVersion: mod.OVERNIGHT_FORMULA_VERSION,
    identity: mod.currentVerificationIdentity('overnight'),
    picks: values.map((_, j) => ({ code: String(2330 + j), exchange: 'TWSE', price: 100 })),
    observed: { complete: true, status: 'final', formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, identity: mod.currentVerificationIdentity('overnight'),
      observationDate: iso(compactTradingDay(i - 4)), warnings: [], rows: values.map((value,j) => ({
        code: String(2330+j), verified: true, openReturn: value, highReturn: 12, currentReturn: 1,
        hitPlus2: true, brokeMinus2: false, winAtOpen: value > 0, winAtClose: true,
      })) },
  }));
  await mod.saveDb(db);
  assert.ok(db.signalSnapshots.every(s => mod.storedObservationFor(s)));
  const result = await mod.buildVerificationHistory();
  assert.equal(result.totals.avgOpenReturn, 5, '原實作以整日verified=3除而得到3.333');
  assert.equal(result.totals.metricCoverage.avgOpenReturn.validCount, 2);
  assert.equal(result.totals.metricCoverage.winAtOpen.validCount, 2);
  assert.equal(result.totals.metricCoverage.winAtOpen.validDays, 1);
  assert.equal(result.totals.ci.winAtOpen, null);
  assert.equal(result.totals.ci.winAtClose.n, 2);
});

test('真history主成績只接正式manifest；完整0訊號算採集但不算收益CI日', async () => {
  await mod.commitDbMutation(db => {
    for (const [offset, values] of [[-3,[10,null]],[-2,[]]]) {
      const date=iso(compactTradingDay(offset));
      const p=mod.publishVerification(db,'overnight',{asOf:date,formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,
        requestScope:{maxCandidates:260,maxPerGroup:20},coverage:{complete:true,markets:{twse:{asOf:date},tpex:{asOf:date}}},
        scanQuality:{candidateCount:values.length,completedCount:values.length,reliable:true},
        candidatePool:values.map((_,i)=>({code:String(2330+i),exchange:'TWSE',candidateRank:i+1,price:100,source:'official-close',sourceAsOf:date})),
        inputEvidence:values.map((_,i)=>({code:String(2330+i),exchange:'TWSE',outcome:'selected'})),
        groups:{strongContinuation:values.map((_,i)=>({code:String(2330+i),exchange:'TWSE',price:100,group:'strongContinuation'}))} });
      const snapshot=db.signalSnapshots.find(s=>s.captureId===p.captureId);
      snapshot.observed={complete:true,status:'final',formulaVersion:p.identity.selectionVersion,identity:p.identity,inputFingerprint:p.inputFingerprint,
        observationDate:iso(compactTradingDay(offset+1)),warnings:[],rows:values.map((value,i)=>({code:String(2330+i),verified:true,
          openReturn:value,currentReturn:0,highReturn:12,lowReturn:-1,hitPlus2:true,brokeMinus2:false,winAtOpen:value===10,winAtClose:false}))};
    }
  });
  const result=await mod.buildVerificationHistory();
  assert.equal(result.cohort.headline.issued,2);
  assert.equal(result.cohort.headline.days,1);
  assert.equal(result.captureCoverage.completeCount,2);
  assert.equal(result.metricCoverage.avgOpenReturn.value,10);
  assert.equal(result.metricCoverage.avgOpenReturn.validCount,1);
  assert.equal(result.metricCoverage.winAtOpen.validCount,1);
  assert.equal(result.metricCoverage.avgCloseReturn.value,0);
  assert.equal(result.cohort.headline.ci.winAtOpen,null);
  assert.equal(result.population.legacy.samples,2);
  assert.equal('db' in result,false);
});
