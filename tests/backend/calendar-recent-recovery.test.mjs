// 近期跨月來源同日恢復必須再入runner，不被once-per-close節流吃掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {importServer} from '../helpers/test-server.mjs';
test('recent缺章pending不鎖當日；不重設advance key，同日來源恢復後仍按8/31停損',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-08-31T02:00:00Z')});
 let restored=false,augustCalls=0;
 const srv=await importServer({routes:[
  {match:/exchangeReport\/FMTQIK$/,reply:[{Date:'1150828'},{Date:'1150901'}]},
  {match:/holidaySchedule/,reply:[{Date:'1150101',Name:'休市'}]},
  {match:/rwd\/zh\/afterTrading\/FMTQIK/,reply:url=>{
   if(url.searchParams.get('date').startsWith('202608')){augustCalls++;if(augustCalls>1&&!restored)return {__error:'calendar outage'};return {stat:'OK',data:restored?[['115/08/28'],['115/08/31']]:[['115/08/28']]};}
   return {stat:'OK',data:[['115/09/01']]};}},
  {match:/TWT49U/,reply:{stat:'OK',data:[]}},
  {match:/STOCK_DAY\?/,reply:url=>{const month=url.searchParams.get('date').slice(0,6);return {stat:'OK',data:month==='202608'?[['115/08/28','1','100','100','101','99','100','0','1'],['115/08/31','1','100','100','101','94','100','0','1']]:month==='202609'?[['115/09/01','1','109','100','110','99','109','9','1']]:[]};}}
 ]});
 try{
  const m=srv.mod;await m.getSwingHistoricalCalendar('20260801','20260801',{includeSourceEvidence:true});
  t.mock.timers.setTime(Date.parse('2026-09-01T08:00:00Z'));
  const identity={...m.currentVerificationIdentity('swing'),evaluationVersion:'swing-price-observation-v1',returnBasis:'adjusted-reference-price',costModelVersion:'flat-round-trip-0.471pct-v1'};
  await m.commitDbMutation(db=>{db.swingVerification={20260828:[{identity,code:'2330',exchange:'TWSE',scenario:'midBandDefense',status:'pending',entry:100,stop:95,target:108,lastChecked:'20260828',daysHeld:0}]};});
  const reference={coverageComplete:true,byCode:new Map([['2330',{code:'2330',exchange:'TWSE',source:'TWSE OpenAPI',rawDate:'20260901',open:100,high:110,low:99,price:109}]])};
  await m.advanceSwingVerification(reference,'20260901',{riskSets:null});
  let e=(await m.loadDb()).swingVerification['20260828'][0];assert.equal(e.status,'pending');assert.equal(e.lastChecked,'20260828');assert.equal(e.verificationRetry.reason,'calendar-coverage-unknown');
  restored=true;t.mock.timers.setTime(Date.now()+6*60*1000);
  await m.advanceSwingVerification(reference,'20260901',{riskSets:null});
  e=(await m.loadDb()).swingVerification['20260828'][0];assert.equal(e.status,'loss');assert.equal(e.resolvedAt,'20260831');assert.equal(e.resultPct,-5);assert.equal(augustCalls,3);
  assert.equal(e.evaluationApplied.calendarEvidencePolicyVersion,'official-session-interval-v1');assert.equal(e.evaluationApplied.scope,'this-advance-only');
 }finally{await srv.mod.shutdownServer();srv.mock.restore();await rm(srv.dataDir,{recursive:true,force:true});t.mock.timers.reset();}
});
