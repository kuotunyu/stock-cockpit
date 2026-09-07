// issued母體包含不進場，模型與場景獨立；未知資料保留pending且不重複加stalled。
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {importServer} from '../helpers/test-server.mjs';
const {mod,mock,dataDir}=await importServer();
after(async()=>{await mod.flushPersistence();mock.restore();await rm(dataDir,{recursive:true,force:true});});
function publish(db,{locked=false}={}) {
  const date='2026-09-04';
  return mod.publishVerification(db,'swing',{asOf:date,formulaVersion:mod.SWING_FORMULA_VERSION,requestScope:{maxCandidates:240,scenarioKey:'',limit:40},
    coverage:{complete:true,markets:{twse:{asOf:date},tpex:{asOf:date}}},scanQuality:{candidateCount:1,completedCount:1,reliable:true},
    candidatePool:[{code:'2330',exchange:'TWSE',candidateRank:1,price:100,source:'official-close',sourceAsOf:date}],
    inputEvidence:[{code:'2330',exchange:'TWSE',outcome:'matched'}],
    picks:['one','two'].map(key=>({code:'2330',exchange:'TWSE',scenario:{key},fillRisk:locked?'limit-up-locked':null,plan:{entry:100,structuralStop:95,target:110}}))});
}
test('先記issued再保守鎖死skip；同股跨場景兩身份、同模型重跑不重複',()=>{
 const db={};const p=publish(db,{locked:true});publish(db,{locked:true});
 assert.equal(typeof mod.summarizeVerificationPopulation,'function');
 const result=mod.summarizeVerificationPopulation(db,'swing');
 assert.equal(result.models.length,2);
 for(const m of result.models){assert.equal(m.issued,2);assert.equal(m.noEntry,2);assert.equal(m.pending,0);assert.equal(m.rows[0].reason,'limit-up-locked');}
 assert.equal(db.swingVerification['20260904'].length,0);
 assert.equal(new Set(db.verificationCaptures[p.captureId].issued.map(x=>x.signalId)).size,2);
 assert.equal(db.verificationCaptures[p.captureId].populationModels[0].identity.cohortPolicyVersion,'first-canonical-issued-manifest-v1');
 assert.notEqual(db.verificationCaptures[p.captureId].populationModels[0].identity.cohortPolicyVersion,p.identity.cohortPolicyVersion);
});
test('真實推進保存首個實際交易日；缺開盤不借次日價、補證並發保留現有進度與模型',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-05T00:00:00Z')});
  try {
    const p=await mod.commitDbMutation(db=>publish(db));
    const identityBefore=structuredClone((await mod.loadDb()).verificationCaptures[p.captureId].populationModels);
    await mod.commitDbMutation(db=>{
      const [a,b]=db.swingVerification['20260904'];
      mod.advanceSwingVerificationEntry(a,{rawDate:'20260907',open:101,high:111,low:99,price:110});
      mod.advanceSwingVerificationEntry(b,{rawDate:'20260907',open:null,high:105,low:99,price:104});
      mod.advanceSwingVerificationEntry(b,{rawDate:'20260908',open:102,high:111,low:99,price:110});
      a.verificationRetry={reason:'kept'};
    });
    await Promise.all([mod.confirmVerificationPublication(p),mod.confirmVerificationPublication(p)]);
    const db=await mod.loadDb();
    assert.equal(db.swingVerification['20260904'][0].firstObservationDate,'20260907');
    assert.equal(db.swingVerification['20260904'][1].nextOpen,undefined);
    assert.deepEqual(db.swingVerification['20260904'][0].verificationRetry,{reason:'kept'});
    assert.deepEqual(db.verificationCaptures[p.captureId].populationModels,identityBefore);
    const next=mod.summarizeVerificationPopulation(db,'swing',{asOf:'20260908'}).models.find(m=>m.identity.entryModel==='next-open-price-observation');
    assert.equal(next.resolved,1);assert.equal(next.pending,1);assert.equal(next.rows[1].reason,'next-open-price-missing');
  } finally {t.mock.timers.reset();}
});
test('次開觀察獨立身份與時間上下界；晚確認不等於晚發布，missing不是unresolved',()=>{
 for(const [lower,upper,want,reason] of [
  ['2026-09-05T00:00:00Z','2026-09-05T00:00:01Z','resolved',null],
  ['2026-09-07T01:00:01Z','2026-09-07T01:00:02Z','noEntry','late-publication'],
  ['2026-09-07T00:59:59Z','2026-09-07T01:00:01Z','pending','timing-uncertain'],
  ['2026-09-05T00:00:00Z',null,'pending','timing-uncertain']]) {
  const db={};const p=publish(db);Object.assign(db.verificationPublications.captures[p.captureId],{publicationStartedAt:lower,availableConfirmedAt:upper});
  for(const e of db.swingVerification['20260904']){e.firstObservationDate='20260907';e.nextOpen=101;e.status='win';e.resultPct=10;e.resultPctNextOpen=8.91;e.resolvedAt='20260907';}
  const r=mod.summarizeVerificationPopulation(db,'swing');const close=r.models.find(x=>x.identity.entryModel==='signal-close-observation');
  const next=r.models.find(x=>x.identity.entryModel==='next-open-price-observation');
  assert.equal(close.resolved,2);assert.equal(next.rows[0].status,want);assert.equal(next.rows[0].reason,reason);assert.notEqual(close.modelKey,next.modelKey);
  assert.equal(next.issued,next.noEntry+next.pending+next.resolved+next.unresolved);
 }
});
test('gap noEntry、dataGap stalled只算pending；沒有entry證據仍pending',()=>{
 const db={};const p=publish(db);Object.assign(db.verificationPublications.captures[p.captureId],{publicationStartedAt:'2026-09-05T00:00:00Z',availableConfirmedAt:'2026-09-05T00:00:01Z'});
 const [a,b]=db.swingVerification['20260904'];a.firstObservationDate='20260907';a.nextOpenSkipped='gap';a.dataGap={from:'20260908'};a.lastChecked='20260907';b.evaluationUnavailable={reason:'unsupported-verification-model'};
 const result=mod.summarizeVerificationPopulation(db,'swing',{asOf:'20261001'});
 const next=result.models.find(x=>x.identity.entryModel==='next-open-price-observation');assert.equal(next.noEntry,1);assert.equal(next.pending,1);assert.equal(next.unresolved,0);
 const close=result.models.find(x=>x.identity.entryModel==='signal-close-observation');assert.equal(close.pending,2);assert.equal(close.issued,2);
 assert.equal(next.rows[0].reason,'gap');
});
test('只有明確行政結束才unresolved；缺估值不填0或resolved',()=>{
 const db={};publish(db);const [a,b]=db.swingVerification['20260904'];
 a.status='unresolved';a.unresolvedReason='valuation-impossible';b.status='win';b.resultPct=null;
 const close=mod.summarizeVerificationPopulation(db,'swing').models.find(m=>m.identity.entryModel==='signal-close-observation');
 assert.equal(close.issued,2);assert.equal(close.unresolved,1);assert.equal(close.pending,1);assert.equal(close.resolved,0);
 assert.equal(close.rows[0].reason,'valuation-impossible');
});
