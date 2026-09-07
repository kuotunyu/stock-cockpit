// 正式issued母體按官方15日窗口成熟，缺K、版本、分盤與補齊不改母體。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { importServer } from '../helpers/test-server.mjs';
const { mod, mock, dataDir } = await importServer();
after(async () => { await mod.shutdownServer(); mock.restore(); await rm(dataDir, { recursive: true, force: true }); });
const initLogs = []; const originalLog = console.warn;
try {
  console.warn = (...args) => initLogs.push(args.join(' '));
  await mod.loadDb();
} finally { console.warn = originalLog; }
assert.equal(initLogs.length, 1);
assert.match(initLogs[0], /^\[Stock1\] Created initial admin user "admin"\./);
// 固定歷史日期配顯式asOf，星期六/日及9/10合成颱風休市不在官方session fixture。
const days = ['20260901','20260902','20260903','20260904','20260907','20260908','20260909','20260911','20260914','20260915','20260916','20260917','20260918','20260921','20260922','20260923'];
const calendar = { tradingDays: days, coveredMonths: ['202609'], through: '20260923',monthEvidence:{202609:{source:'TWSE FMTQIK',requestedAt:'2026-09-24T08:00:00Z',observedAt:'2026-09-24T08:00:00Z',coveredFrom:'20260901',coveredThrough:'20260923',completeMonth:false,status:'fresh'}} };
test('成熟只看訊號後15官方交易日，快贏快輸不提前，日曆不足unknown', () => {
  assert.equal(typeof mod.classifyCohort, 'function');
  for (const status of ['win','loss','expired','pending']) {
    const capture = { tradeDate:'20260901', status, daysHeld:15 };
    assert.deepEqual(mod.classifyCohort(capture, { asOf:'20260922', tradingDates:calendar, maxSessions:15 }), { mature:false, ageSessions:14, reason:'window-not-complete' });
    assert.deepEqual(mod.classifyCohort(capture, { asOf:'20260923', tradingDates:calendar, maxSessions:15 }), { mature:true, ageSessions:15, reason:null });
    assert.equal(mod.classifyCohort(capture, { asOf:'20260923', tradingDates:[], maxSessions:15 }).mature, null);
  }
  assert.deepEqual(mod.classifyCohort({ tradeDate:'20260831' }, { asOf:'20260923', tradingDates:calendar, maxSessions:15 }),
    {mature:true,ageSessions:null,knownSessions:16,reason:'known-sessions-lower-bound'});
  assert.equal(mod.classifyCohort({tradeDate:'20260901'}, {asOf:'20260923',tradingDates:days,maxSessions:15}).ageSessions,null);
});

const holding = resultPct => mod.calculateHoldingOutcome({ initialPosition:{date:days[0],price:100,shares:1},exit:{date:days[1],price:100+resultPct},events:[],eventCoverage:'complete',costs:{model:'initial-notional-flat-total-v1',total:0.471} });
function fixture() {
  const db = {};
  const date = '2026-09-01';
  const p = mod.publishVerification(db, 'swing', { asOf:date, formulaVersion:mod.SWING_FORMULA_VERSION,
    requestScope:{maxCandidates:240,scenarioKey:'',limit:40}, coverage:{complete:true,markets:{twse:{asOf:date},tpex:{asOf:date}}},
    scanQuality:{candidateCount:1,completedCount:1,reliable:true},
    candidatePool:[{code:'2330',exchange:'TWSE',candidateRank:1,price:100,source:'official-close',sourceAsOf:date}],
    inputEvidence:[{code:'2330',exchange:'TWSE',outcome:'matched'}],
    picks:['fastWin','fastLoss','expiry','gap'].map(key=>({code:'2330',exchange:'TWSE',scenario:{key},plan:{entry:100,structuralStop:95,target:110}})) });
  const entries = db.swingVerification['20260901'];
  for (const [i,e] of entries.entries()) Object.assign(e, { status:['win','loss','expired','pending'][i], resultPct:[10,-5,2,null][i], holdingOutcome:i<3?holding([10,-5,2][i]):null, daysHeld:i===2?15:1, resolvedAt:days[i===2?15:1], fillModel:'continuous' });
  entries[3].dataGap={from:'20260902'};
  return {db,p};
}
test('同日已結案與缺K共享成熟窗口；expired正淨值是淨獲利，pending留分母', () => {
  assert.equal(typeof mod.summarizeMatureVerification, 'function');
  const {db} = fixture();
  const before = mod.summarizeMatureVerification(db,'swing',{asOf:'20260922',calendar});
  assert.equal(before.headline.eligibleCount,0);
  assert.equal(before.headline.issued, before.headline.noEntry + before.headline.pending + before.headline.resolved + before.headline.unresolved);
  const result = mod.summarizeMatureVerification(db,'swing',{asOf:'20260923',calendar});
  const headline = result.headline;
  assert.equal(headline.issued,4);
  assert.equal(headline.matureCount,4);
  assert.equal(headline.pending,1);
  assert.equal(headline.metricCoverage.avgResultPctNet.validCount,3);
  assert.equal(headline.metricCoverage.avgResultPctNet.totalCount,4);
  assert.equal(headline.metricCoverage.netProfitRate.value,200/3);
  assert.equal(headline.metricCoverage.targetHitRate.value,100/3);
  assert.equal(headline.rows.find(r=>r.scenario==='gap').reason,'data-gap');
  assert.equal(result.headline.identity.cohortPolicyVersion,'mature-issued-15-official-sessions-v1');
  const next = result.models.find(m=>m.identity.entryModel==='next-open-price-observation');
  assert.equal(next.metricCoverage.avgResultPctNet.validCount,0,'timing uncertain不能當resolved');
});

test('成熟缺資料補齊後只改有效coverage；分盤/未知regime/跨版本各自分層', () => {
  const {db,p}=fixture();
  const entries=db.swingVerification['20260901'];
  entries[0].fillModel='periodicCall20';
  entries[1].regime={aboveMa60:false};
  const before=mod.summarizeMatureVerification(db,'swing',{asOf:'20260923',calendar});
  assert.equal(before.headline.metricCoverage.avgResultPct.validCount,2);
  assert.equal(before.headline.periodicCallSamples,1);
  assert.equal(before.headline.scenarios.find(s=>s.scenario==='fastWin').withPeriodicCall.metricCoverage.avgResultPct.validCount,1);
  assert.equal(before.headline.scenarios.find(s=>s.scenario==='fastLoss').byRegime.belowMa60.metricCoverage.avgResultPct.validCount,1);
  assert.equal(before.headline.scenarios.find(s=>s.scenario==='expiry').byRegime.unknown.metricCoverage.avgResultPct.validCount,1);
  Object.assign(entries[3],{status:'expired',resultPct:0,holdingOutcome:holding(0),dataGap:null});
  const after=mod.summarizeMatureVerification(db,'swing',{asOf:'20260923',calendar});
  assert.equal(after.headline.issued,before.headline.issued);
  assert.equal(after.headline.metricCoverage.avgResultPct.validCount,3);
  assert.equal(after.headline.metricCoverage.avgResultPctNet.missingCount,0);
  const declaration=db.verificationCaptures[p.captureId].populationModels[0];
  declaration.identity={...declaration.identity,selectionVersion:'saved-other-selection'};
  declaration.modelKey=mod.verificationModelKey(declaration.identity);
  const split=mod.summarizeMatureVerification(db,'swing',{asOf:'20260923',calendar});
  assert.equal(split.headline.issued,0);
  assert.equal(split.models.find(m=>m.identity.selectionVersion==='saved-other-selection').issued,4);
});

test('真summary接正式母體，未知日曆不退回快速結案；DB不外洩', async t => {
  t.mock.timers.enable({ apis:['Date'], now:Date.parse('2026-09-23T08:00:00Z') });
  t.after(() => t.mock.timers.reset());
  const {db} = fixture();
  await mod.commitDbMutation(draft => Object.assign(draft,db));
  const summary = await mod.buildSwingVerificationSummary();
  assert.ok(summary.cohort, '不能只交pure helper');
  assert.equal(summary.cohort.headline.metricCoverage.avgResultPctNet.validCount,0);
  assert.equal(summary.metricCoverage.avgResultPctNet.validCount,0);
  assert.equal('db' in summary,false);
  assert.ok(summary.recent.length > 0,'保留最近快結案');
});

test('真summary在官方月日曆補齊後納入成熟窗，與population同一DB快照', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-24T08:00:00Z')});
  const remove=mock.override({match:url=>url.pathname.includes('/rwd/zh/afterTrading/FMTQIK'),reply:()=>({stat:'OK',data:days.map(day=>[`115/${day.slice(4,6)}/${day.slice(6)}`])})});
  t.after(()=>{remove();t.mock.timers.reset();});
  const summary=await mod.buildSwingVerificationSummary();
  assert.equal(summary.cohort.headline.matureCount,4);
  assert.equal(summary.metricCoverage.avgResultPctNet.validCount,3);
  assert.equal(summary.population.models.find(m=>m.identity.entryModel==='signal-close-observation').issued,summary.cohort.headline.issued);
  assert.ok(mock.callsFor(/rwd\/zh\/afterTrading\/FMTQIK/).length > 0);
  assert.equal(summary.cohort.headline.rows[0].cohort.ageSessions,null,'缺9/24截至日證據只宣稱已知15日下界');
});
