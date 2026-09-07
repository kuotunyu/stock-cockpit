// T12g 真日曆consumer：不完整跨月不能跳停損日，pending恢復及成熟日期覆蓋。
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {importServer} from '../helpers/test-server.mjs';
const {mod,mock,dataDir}=await importServer();
after(async()=>{await mod.shutdownServer();mock.restore();await rm(dataDir,{recursive:true,force:true});});
const proof=(month,through,extra={})=>({source:'TWSE FMTQIK',requestedAt:'2026-12-01T08:00:00Z',observedAt:'2026-12-01T08:00:00Z',coveredFrom:month+'01',coveredThrough:through,completeMonth:true,status:'fresh',...extra});
const calendar=(partial=false)=>({tradingDays:partial?['20260828','20260901']:['20260828','20260831','20260901'],holidayRows:[],coveredMonths:['202608','202609'],through:'20260930',monthEvidence:{202608:proof('202608',partial?'20260828':'20260831',{status:'stale',completeMonth:!partial}),202609:proof('202609','20260930')}});
const entry=identity=>({code:'2330',exchange:'TWSE',scenario:'midBandDefense',status:'pending',entry:100,stop:95,target:108,lastChecked:'20260828',daysHeld:0,...(identity?{identity}:{} )});
const bar=(date,high,low,close)=>({rawDate:date,date,code:'2330',exchange:'TWSE',open:100,high,low,close,price:close,previousClose:100,exchangePreviousClose:100,source:'TWSE STOCK_DAY'});
const rows=[bar('20260828',101,99,100),bar('20260831',101,94,100),bar('20260901',110,99,109)];
test('跨月min/max不代表覆蓋；預定日保留但strict不接受candidate共識',()=>{
 const sparse={tradingDays:['20260828','20260901'],candidateDays:['20260901','20260901']};
 assert.equal(mod.resolveNextTradingDate('20260828',sparse).date,'20260831');
 assert.equal(mod.resolveNextTradingDate('20260828',{...calendar(true),requireObservedSessions:true}).date,'');
 assert.equal(mod.resolveNextTradingDate('20260828',{...calendar(),requireObservedSessions:true}).date,'20260831');
});
test('休市表與較早官方開市日衝突，不能借較晚scheduled精確價格跳日',()=>{
 const conflict={tradingDays:['20260828','20260831','20260901'],holidayRows:[{date:'20260831',name:'休市',description:'合成排定休市'}],
  verifiedOfficialDays:[{date:'20260901',source:'TWSE STOCK_DAY',status:'ok'}],requireObservedSessions:true};
 assert.equal(mod.resolveNextTradingDate('20260828',conflict).date,'');
 assert.equal(mod.resolveNextTradingDate('20260828',{...conflict,tradingDays:['20260828','20260901'],verifiedOfficialDays:[...conflict.verifiedOfficialDays,{date:'20260831',source:'TWSE STOCK_DAY',status:'ok'}]}).date,'');
 assert.equal(mod.resolveNextTradingDate('20260828',{...calendar(),...conflict}).date,'20260831');
});
test('v1 cash/price與unknown pending都停等缺章，恢復後按8/31停損；final完整不重算',()=>{
 const cash=mod.currentVerificationIdentity('swing'),price={...cash,evaluationVersion:'swing-price-observation-v1',returnBasis:'adjusted-reference-price',costModelVersion:'flat-round-trip-0.471pct-v1'};
 for(const identity of [cash,price,null]){
  const e=entry(identity);const result=mod.replaySwingVerificationHistory(e,rows,'20260901',calendar(true));
  assert.equal(e.status,'pending');assert.equal(e.lastChecked,'20260828');assert.equal(e.daysHeld,0);assert.equal(result.unavailableReason,'calendar-coverage-unknown');
  mod.replaySwingVerificationHistory(e,rows,'20260901',calendar());assert.equal(e.status,'loss');assert.equal(e.resultPct,-5);assert.equal(e.resolvedAt,'20260831');
  const saved=structuredClone(e);mod.replaySwingVerificationHistory(e,[bar('20260831',120,99,119)],'20260901',calendar());assert.deepEqual(e,saved);
 }
});
test('完整stale官方月底休市可跳到9/1；成熟到月底不借最後交易日延伸覆蓋',()=>{
 const full=calendar();full.tradingDays=['20260828','20260901'];
 assert.equal(mod.resolveNextTradingDate('20260828',{...full,requireObservedSessions:true}).date,'20260901');
 const incomplete=calendar(true);
 assert.equal(mod.classifyCohort({tradeDate:'20260828'},{asOf:'20260831',tradingDates:incomplete}).mature,null);
 assert.deepEqual(mod.classifyCohort({tradeDate:'20260828'},{asOf:'20260831',tradingDates:full}),{mature:false,ageSessions:0,reason:'window-not-complete'});
});
test('production歷史runner在原月章不足時保存pending，恢復後續驗且final與游標契約保留',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-08-31T02:00:00Z')});
 let calls=0,recovered=false;
 const remove=mock.override({match:/FMTQIK|holidaySchedule|TWT49U|STOCK_DAY\?/,reply:url=>{
  if(url.pathname.includes('holidaySchedule'))return [{Date:'1150101',Name:'休市'}];
  if(url.pathname.includes('exchangeReport/FMTQIK'))return [{Date:'1151201'}];
  if(url.pathname.includes('FMTQIK')){const month=url.searchParams.get('date').slice(0,6);if(month==='202608'){calls++;if(calls>1&&!recovered)return {__error:'synthetic calendar outage'};return {stat:'OK',data:recovered?[['115/08/28'],['115/08/31']]:[['115/08/28']]};}return {stat:'OK',data:[['115/09/01']]};}
  if(url.pathname.includes('TWT49U'))return {stat:'OK',data:[]};
  const month=url.searchParams.get('date').slice(0,6);return {stat:'OK',data:rows.filter(r=>r.date.startsWith(month)).map(r=>[`115/${r.date.slice(4,6)}/${r.date.slice(6)}`,'1000000','100000000',String(r.open),String(r.high),String(r.low),String(r.close),'0','100'])};
 }});
 try{
  await mod.getSwingHistoricalCalendar('20260801','20260801',{includeSourceEvidence:true});
  t.mock.timers.setTime(Date.parse('2026-12-01T08:00:00Z'));
  await mod.commitDbMutation(db=>{db.swingVerification={20260828:[entry({...mod.currentVerificationIdentity('swing'),evaluationVersion:'swing-price-observation-v1',returnBasis:'adjusted-reference-price',costModelVersion:'flat-round-trip-0.471pct-v1'})],20260101:[{...entry(),status:'win',resultPct:8}]};});
  const reference={coverageComplete:true,byCode:new Map()};
  await mod.advanceSwingVerification(reference,'20261201',{riskSets:null});
  let live=(await mod.loadDb()).swingVerification['20260828'][0];assert.equal(live.status,'pending');assert.equal(live.lastChecked,'20260828');assert.equal(live.verificationRetry.reason,'calendar-coverage-unknown');
  recovered=true;t.mock.timers.setTime(Date.now()+6*60*1000);await mod.advanceSwingVerification(reference,'20261201',{riskSets:null});
  live=(await mod.loadDb()).swingVerification['20260828'][0];assert.equal(live.status,'loss');assert.equal(live.resultPct,-5);assert.equal(live.evaluationApplied.calendarEvidencePolicyVersion,'official-session-interval-v1');
  assert.equal((await mod.loadDb()).swingVerification['20260101'][0].resultPct,8);
  const maturity=await mod.getMaturityCalendar('20260828','20260901');assert.equal(maturity.monthEvidence['202608'].coveredThrough,'20260831');
 }finally{remove();t.mock.timers.reset();}
});
test('隔日真observation遇到排休衝突，補原月份證據後恢復較早實際日，不抓無關月份',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-01T08:00:00Z')});
 let recovered=false;
 const remove=mock.override({match:/FMTQIK|STOCK_DAY\?|TWT49U/,reply:url=>{
  if(url.pathname.includes('FMTQIK'))return recovered?{stat:'OK',data:[['115/10/05'],['115/10/06'],['115/10/07']]}:{__error:'synthetic missing proof'};
  if(url.pathname.includes('TWT49U'))return {stat:'OK',data:[]};
  return {stat:'OK',data:[['115/10/05','1000000','100000000','100','101','99','100','0','100'],['115/10/06','1000000','100000000','100','101','94','96','-4','100'],['115/10/07','1000000','100000000','100','110','99','109','13','100']]};
 }});
 try{
  const cal={tradingDays:['20261005','20261006','20261007'],holidayRows:[{date:'20261006',name:'休市',description:'合成排休'}]};
  const snapshot={asOf:'2026-10-05',picks:[{code:'2330',exchange:'TWSE',price:100}]};
  const reference={coverageComplete:true,byCode:new Map([['2330',bar('20261007',110,99,109)]])};
  const pending=await mod.observeSignalSnapshot(snapshot,{calendar:cal,reference});assert.equal(pending.complete,false);assert.equal(pending.unavailableReason,'calendar-coverage-unknown');
  recovered=true;t.mock.timers.setTime(Date.now()+6*60*1000);
  const before=mock.calls.length,done=await mod.observeSignalSnapshot(snapshot,{calendar:cal,reference});
  assert.equal(done.observationDate,'2026-10-06');assert.equal(done.complete,true);assert.equal(done.rows[0].currentReturn,-4);
  assert.equal(done.evidence.calendarEvidencePolicyVersion,'official-session-interval-v1');assert.deepEqual(done.evidence.priceSources,['TWSE STOCK_DAY']);
  const months=mock.calls.slice(before).filter(c=>c.url.includes('FMTQIK')).map(c=>new URL(c.url).searchParams.get('date').slice(0,6));assert.deepEqual(months,['202610']);
 }finally{remove();t.mock.timers.reset();}
});
