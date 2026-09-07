// T08 P1：跨月last-good不能擴大原始日曆覆蓋；恢復後固定正確期間並保留完成證據。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readBenchmarkEvidence} from '../../verification-evidence.mjs';
import {createHash} from 'node:crypto';
import {bootServer} from '../helpers/test-server.mjs';
test('月底早上cache→跨月失敗保持pending，恢復完整來源才估值；慢請求不以返回日封月',async()=>{
  const RealDate=Date;let now=RealDate.parse('2026-08-31T02:00:00Z'),augustCalls=0,recovered=false;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const price=(date,close,change)=>[date,'1000000','100000000','100','110','99',String(close),String(change),'100'];
  let srv;
  try{
    srv=await bootServer({routes:[
      {match:/rwd\/zh\/afterTrading\/FMTQIK/,reply:url=>{
        if(url.searchParams.get('date').startsWith('202608')){augustCalls++;return augustCalls===1?{stat:'OK',data:[['115/08/28']]}:recovered?{stat:'OK',data:[['115/08/28'],['115/08/31']]}:{__error:'August calendar outage'};}
        if(url.searchParams.get('date').startsWith('202610')){now=RealDate.parse('2026-10-31T16:00:01Z');return {stat:'OK',data:[['115/10/30']]};}
        return {stat:'OK',data:[['115/09/01']]};}},
      {match:/TWT49U/,reply:{stat:'OK',data:[]}},
      {match:/STOCK_DAY\?/,reply:url=>({stat:'OK',data:url.searchParams.get('date').startsWith('202608')?[price('115/08/28',100,0),price('115/08/31',100,0)]:[price('115/09/01',110,10)]})},
    ]});
    const m=srv.mod;
    const c={captureId:'calendar-stale',inputFingerprint:'same',strategy:'overnight',tradeDate:'20260828',identity:m.currentVerificationIdentity('overnight'),kind:'formal',fullRecord:true,canonical:true,
      candidates:[{code:'2330',exchange:'TWSE',price:100,source:'TWSE OpenAPI',sourceAsOf:'20260828'}],issued:[{signalId:'s',code:'2330',exchange:'TWSE'}]};
    const oldSpec={...m.fixedBenchmarkSpec('overnight'),calendarVersion:'TWSE-FMTQIK-official-monthly-sessions'};
    const oldModelKey=m.benchmarkModelKey(c,oldSpec);
    const oldKey=createHash('sha256').update(JSON.stringify({captureId:c.captureId,inputFingerprint:c.inputFingerprint,modelKey:oldModelKey})).digest('hex');
    const oldMemo={captureId:c.captureId,inputFingerprint:c.inputFingerprint,benchmarkSpec:oldSpec,modelKey:oldModelKey,status:'complete',result:{pairedCount:1,meanDifference:9.529}};
    const currentMemo=db=>{const memo=Object.values(db.verificationBenchmarks.memos).find(row=>row.benchmarkSpec.calendarVersion.endsWith('-v2'));return {...memo,...readBenchmarkEvidence(memo)};};
    await m.commitDbMutation(db=>{db.verificationBenchmarks={memos:{[oldKey]:oldMemo},cursor:oldKey};db.verificationCaptures={[c.captureId]:c};db.verificationPublications={current:{key:c.captureId},captures:{[c.captureId]:c}};return true;});
    assert.equal(m.summarizeVerificationBenchmarks(await m.loadDb(),'overnight').cohorts[0].status,'pending');
    assert.equal((await m.runVerificationBenchmarkBatch()).status,'pending');
    now=RealDate.parse('2026-09-01T06:00:00Z');
    const second=await m.runVerificationBenchmarkBatch();assert.equal(second.status,'pending');
    let memo=currentMemo(await m.loadDb());
    assert.equal(memo.observations.length,0);assert.equal(memo.calendar,undefined);assert.equal(srv.mock.callsFor(/STOCK_DAY\?/).length,0);
    const stale=memo.calendarAttempt.monthEvidence['202608'];
    assert.equal(stale.observedAt,'2026-08-31T02:00:00.000Z');assert.equal(stale.requestedAt,stale.observedAt);assert.equal(stale.coveredThrough,'20260828');assert.equal(stale.completeMonth,false);assert.equal(stale.status,'stale');
    recovered=true;now=RealDate.parse('2026-09-01T06:11:00Z');
    assert.equal((await m.runVerificationBenchmarkBatch()).status,'complete');
    memo=currentMemo(await m.loadDb());
    assert.deepEqual(memo.observations[0].period,{entryDate:'20260828',exitDate:'20260831'});assert.equal(memo.observations[0].returnPct,-0.471);assert.equal(augustCalls,3);
    assert.equal(memo.calendar.monthEvidence['202608'].completeMonth,true);assert.equal(memo.calendar.monthEvidence['202608'].coveredThrough,'20260831');
    assert.deepEqual((await m.loadDb()).verificationBenchmarks.memos[oldKey],oldMemo);
    const summary=m.summarizeVerificationBenchmarks(await m.loadDb(),'overnight');
    assert.deepEqual(summary.models[0].captureIdentity,c.identity);assert.deepEqual(summary.cohorts[0].captureIdentity,c.identity);
    const saved=structuredClone(memo),calls=srv.mock.calls.length;
    recovered=false;now=RealDate.parse('2026-09-03T06:00:00Z');assert.equal((await m.runVerificationBenchmarkBatch()).status,'idle');
    assert.deepEqual(currentMemo(await m.loadDb()),saved);assert.equal(srv.mock.calls.length,calls);
    // 共享helper舊callers仍取得原三欄，不取得以現在時間重蓋的month證據。
    const legacy=await m.getSwingHistoricalCalendar('20260801','20260801');
    assert.deepEqual(legacy,{tradingDays:['20260828','20260831'],holidayRows:[],coveredMonths:['202608']});
    now=RealDate.parse('2026-10-31T15:59:59Z');
    const slow=await m.getSwingHistoricalCalendar('20261001','20261001',{includeSourceEvidence:true});
    const evidence=slow.monthEvidence['202610'];
    assert.equal(evidence.requestedAt,'2026-10-31T15:59:59.000Z');assert.equal(evidence.observedAt,'2026-10-31T16:00:01.000Z');assert.equal(evidence.completeMonth,false);assert.equal(evidence.coveredThrough,'20261030');
    console.log(JSON.stringify({stale,restored:saved.calendar.monthEvidence['202608'],crossMonthSlow:evidence,calls:srv.mock.calls.length}));
  }finally{try{if(srv)await srv.close();}finally{globalThis.Date=RealDate;}}
});
