import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {importServer} from '../helpers/test-server.mjs';
import {stockDayAllRow} from '../helpers/fixtures.mjs';
const {mod,mock,dataDir}=await importServer();
after(async()=>{await mod.shutdownServer();mock.restore();await rm(dataDir,{recursive:true,force:true});});
test('I1：較早日只存在官方月K，adapter保留精確bar與正證據，真observation補章後恢復',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-08T08:00:00Z')});
 let recovered=false,calendarCalls=0;
 const remove=mock.override({match:/FMTQIK|STOCK_DAY\?|TWT49U/,reply:url=>{
  if(url.pathname.includes('FMTQIK')){calendarCalls++;return recovered?{stat:'OK',data:[['115/08/27'],['115/08/28'],['115/08/31']]}:{__error:'missing original month proof'};}
  if(url.pathname.includes('TWT49U'))return {stat:'OK',data:[]};
  return {stat:'OK',data:[['115/08/27','1','100','100','101','99','100','0','1'],['115/08/28','1','96','100','101','94','96','-4','1'],['115/08/31','1','109','100','110','99','109','13','1']]};
 }});
 try{
  const descriptor={code:'2317',exchange:'TWSE',source:'TWSE OpenAPI'};
  const exact=await mod.getOfficialObservationEvidence(descriptor,'20260827','20260831');
  assert.equal(exact.bar.date,'20260831');assert.equal(exact.bar.close,109);
  const cal={tradingDays:['20260827','20260831'],holidayRows:[{date:'20260828',name:'休市',description:'合成排休'}]};
  const snapshot={asOf:'2026-08-27',picks:[{code:'2317',exchange:'TWSE',price:100}]};
  const reference={coverageComplete:true,byCode:new Map([['2317',descriptor]])};
  const pending=await mod.observeSignalSnapshot(snapshot,{calendar:cal,reference});
  assert.equal(pending.complete,false);assert.equal(pending.unavailableReason,'calendar-coverage-unknown');assert.ok(calendarCalls>0);
  assert.deepEqual(exact.officialDays,[{date:'20260828',source:'TWSE STOCK_DAY',status:'ok'},{date:'20260831',source:'TWSE STOCK_DAY',status:'ok'}]);
  recovered=true;t.mock.timers.setTime(Date.now()+6*60*1000);
  const done=await mod.observeSignalSnapshot(snapshot,{calendar:cal,reference});
  assert.equal(done.complete,true);assert.equal(done.observationDate,'2026-08-28');assert.equal(done.rows[0].currentReturn,-4);
 }finally{remove();t.mock.timers.reset();}
});

test('I2：direct只採原官方正OHLC；Yahoo、無來源、MIS外層及非正值不得重貼官方final',async()=>{
 const base={code:'9991',rawDate:'20261007',open:100,high:110,low:99,price:109};
 for(const source of ['Yahoo Finance 即時','Yahoo Finance chart fallback','','TWSE MIS']){
  const e=await mod.getOfficialObservationEvidence({...base,source},'20261006','20261007');
  assert.notEqual(e.status,'ok',source);assert.notEqual(e.phase,'final',source);
 }
 for(const field of ['open','high','low','price'])for(const value of [0,-1,NaN]){
  const e=await mod.getOfficialObservationEvidence({...base,source:'TWSE OpenAPI',[field]:value},'20261006','20261007');assert.notEqual(e.status,'ok',field);
 }
 const closeOnly=await mod.getOfficialObservationEvidence({...base,source:'TWSE OpenAPI',price:undefined,close:109},'20261006','20261007');
 assert.notEqual(closeOnly.status,'ok','direct quote須驗實際使用的price，不借close alias通過');
 for(const source of ['TWSE OpenAPI','TPEx OpenAPI']){
  const e=await mod.getOfficialObservationEvidence({...base,source},'20261006','20261007');
  assert.equal(e.status,'ok');assert.equal(e.phase,'final');assert.equal(e.source,source);assert.equal(e.bar.close,109);
 }
});

test('I2：真getQuotes的Yahoo fallback不成final，官方整批恢復可完成且MIS正資料仍是intraday',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-07T02:00:00Z')});
 const remove=mock.override({match:/openapi|mis\.twse|query1\.finance|TWT49U/,reply:url=>{
  if(url.pathname.includes('STOCK_DAY_ALL'))return [stockDayAllRow({code:'2330',name:'合成官方行情',close:100}),stockDayAllRow({code:'5566',name:'合成備援',close:100,dateOff:-1})];
  if(url.hostname==='query1.finance.yahoo.com')return {chart:{result:[{meta:{regularMarketPrice:109,regularMarketTime:Date.now()/1000,chartPreviousClose:100,regularMarketOpen:100,regularMarketDayHigh:110,regularMarketDayLow:99}}]}};
  if(url.hostname==='mis.twse.com.tw')return {msgArray:url.search.includes('5567')?[{c:'5567',ex:'tse',d:'20261007',t:'10:00:00',o:'100',h:'105',l:'99',z:'103',y:'100'}]:[]};
  if(url.pathname.includes('TWT49U'))return {stat:'OK',data:[]};
  return [];
 }});
 try{
  const reference={coverageComplete:false,byCode:new Map()},cal={tradingDays:['20261006','20261007'],holidayRows:[]};
  const snapshot={asOf:'2026-10-06',picks:[{code:'5566',exchange:'TWSE',price:100}]};
  const live=await mod.getQuotes(['5566']);assert.equal(live.quotes[0].source,'Yahoo Finance 即時');
  const pending=await mod.observeSignalSnapshot(snapshot,{calendar:cal,reference,allowIntraday:true});
  assert.equal(pending.complete,false);assert.equal(pending.rows[0].verified,false);
  const official={coverageComplete:true,byCode:new Map([['5566',{code:'5566',exchange:'TWSE',rawDate:'20261007',source:'TWSE OpenAPI',open:100,high:104,low:99,price:102}]])};
  const done=await mod.observeSignalSnapshot(snapshot,{calendar:cal,reference:official,allowIntraday:true});
  assert.equal(done.complete,true);assert.equal(done.rows[0].currentReturn,2);assert.equal(done.rows[0].observationSource,'TWSE OpenAPI');
  const intraday=await mod.observeSignalSnapshot({...snapshot,picks:[{code:'5567',exchange:'TWSE',price:100}]},{calendar:{tradingDays:['20261006'],holidayRows:[]},reference,allowIntraday:true});
  assert.equal(intraday.rows[0].verified,true);assert.equal(intraday.rows[0].currentReturn,3);assert.equal(intraday.rows[0].observationSource,'TWSE MIS official intraday');assert.equal(intraday.observationPhase,'intraday');assert.equal(intraday.complete,false);
 }finally{remove();t.mock.timers.reset();}
});
