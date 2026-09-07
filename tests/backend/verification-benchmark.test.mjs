// 凍結池同期間配對：訊號分母、官方session與價格座標不混用。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { importServer } from '../helpers/test-server.mjs';
const {mod, mock, dataDir}=await importServer({routes:[]});
after(async()=>{await mod.shutdownServer();mock.restore();assert.equal(dirname(resolve(dataDir)),resolve(tmpdir()));assert.ok(basename(dataDir).startsWith('stock1-test-'));await rm(dataDir,{recursive:true,force:true});});
const day='20260803';
const sessions=['20260804','20260805','20260806','20260807','20260810','20260811','20260812','20260813','20260814','20260817','20260818','20260819','20260820','20260821','20260824'];
const capture=(strategy='overnight')=>({captureId:'formal',inputFingerprint:'frozen-input',strategy,tradeDate:day,identity:mod.currentVerificationIdentity(strategy),availableConfirmedAt:'2026-08-03T08:00:00Z',
  candidates:[{code:'2330',exchange:'TWSE'},{code:'2317',exchange:'TWSE'},{code:'6488',exchange:'TPEx'},{code:'5483',exchange:'TPEx'}].map(q=>({...q,price:100,source:q.exchange+' OpenAPI',sourceAsOf:day})),
  issued:[{signalId:'a',code:'2330',exchange:'TWSE',scenario:'a'},{signalId:'b',code:'6488',exchange:'TPEx',scenario:'b'}]});
function observation(c,code,exchange,value){const spec=mod.fixedBenchmarkSpec(c.strategy);return {captureId:c.captureId,inputFingerprint:c.inputFingerprint,code,exchange,modelKey:mod.benchmarkModelKey(c,spec),horizon:spec.horizon,returnBasis:spec.returnBasis,period:{entryDate:day,exitDate:sessions[0]},status:'complete',returnPct:value};}
test('策略[2,4]對兩市場等權池[1,3]，均差1pp；包含入選股而非逐股自比',()=>{
  assert.equal(typeof mod.buildMatchedBenchmark,'function');
  const c=capture();const observations=[observation(c,'2330','TWSE',2),observation(c,'2317','TWSE',0),observation(c,'6488','TPEx',4),observation(c,'5483','TPEx',2)];
  const got=mod.buildMatchedBenchmark({capture:c,observations,benchmarkSpec:mod.fixedBenchmarkSpec('overnight')});
  assert.equal(got.strategyMean,3);assert.equal(got.benchmarkMean,2);assert.equal(got.meanDifference,1);assert.equal(got.pairedCount,2);assert.equal(got.eligibleCount,2);
  assert.equal(got.countGrain,'issued-signal');assert.equal(got.poolCoverage.TWSE.eligibleCount,2);assert.equal(got.includesSelected,true);
  const partial=mod.buildMatchedBenchmark({capture:c,observations:observations.slice(0,3),benchmarkSpec:mod.fixedBenchmarkSpec('overnight')});
  assert.equal(partial.eligibleCount,2);assert.equal(partial.pairedCount,1);assert.equal(partial.strategyMean,2);assert.equal(partial.benchmarkMean,1);assert.equal(partial.meanDifference,1);
  assert.equal(partial.poolCoverage.TPEx.eligibleCount,2);assert.equal(partial.poolCoverage.TPEx.validCount,1);assert.equal(partial.missingReasons['pool-incomplete'],1);
});
test('不同版本、座標、時間、capture與上市上櫃證據均不借用；空值不成0',()=>{
  const c=capture();c.candidates=c.candidates.slice(0,2);c.issued=c.issued.slice(0,1);
  const original=[observation(c,'2330','TWSE',2),observation(c,'2317','TWSE',0)];
  for(const change of [{returnPct:null},{returnBasis:'cash-holding-return'},{modelKey:'revised'},{captureId:'research'},{inputFingerprint:'changed'},{exchange:'TPEx'},{period:{entryDate:day,exitDate:sessions[1]}}]){
    const got=mod.buildMatchedBenchmark({capture:c,observations:[original[0],{...original[1],...change}],benchmarkSpec:mod.fixedBenchmarkSpec('overnight')});
    assert.equal(got.pairedCount,0,JSON.stringify(change));assert.equal(got.meanDifference,null);assert.equal(got.eligibleCount,1);
  }
});
function prices(c){return [day,...sessions].map((date,i)=>({date,code:'2330',exchange:'TWSE',open:i===1?100:99,close:i===15?110:100,exchangePreviousClose:100,source:'TWSE STOCK_DAY',observedAt:'2026-08-25T08:00:00Z'}));}
const calendar={tradingDays:[day,...sessions],coveredMonths:['202608'],through:'20260831',source:'TWSE-FMTQIK-official-monthly-sessions'};
test('summary最新260份與波段90日視圖有界；窗口外與future證據仍留DB，空窗口日期不補造',()=>{
  const makeDb=captures=>({verificationCaptures:Object.fromEntries(captures.map(c=>[c.captureId,c])),verificationPublications:{current:Object.fromEntries(captures.map(c=>[c.captureId,c.captureId])),captures:{}},verificationBenchmarks:{memos:{old:{marker:'keep'}}}});
  const formal=(strategy,date,id)=>({...capture(strategy),tradeDate:date,captureId:id,kind:'formal',fullRecord:true,canonical:true});
  const db=makeDb(Array.from({length:262},(_,i)=>formal('overnight',i===261?'20260908':'20260907',String(i).padStart(3,'0'))));
  const original=JSON.stringify(db);const result=mod.summarizeVerificationBenchmarks(db,'overnight',{asOf:'20260907'});
  assert.equal(result.cohorts.length,260);assert.equal(result.cohorts.some(c=>c.captureId==='000'),false);assert.equal(result.cohorts.some(c=>c.captureId==='261'),false);
  assert.equal(result.window.availableCaptures,261);assert.equal(result.window.includedCaptures,260);assert.equal(result.window.hasOlder,true);assert.equal(result.window.allModels,true);assert.equal(JSON.stringify(db),original);
  const cutoff=mod.addDaysCompact('20260907',-90),before=mod.addDaysCompact(cutoff,-1);
  const swingDb=makeDb([formal('swing',before,'old'),formal('swing',cutoff,'edge'),formal('swing','20260908','future')]);
  const swing=mod.summarizeVerificationBenchmarks(swingDb,'swing',{asOf:'20260907'});
  assert.deepEqual(swing.cohorts.map(c=>c.captureId),['edge']);assert.equal(swing.window.availableCaptures,2);assert.equal(swing.window.hasOlder,true);assert.equal(Object.keys(swingDb.verificationCaptures).length,3);
  const empty=mod.summarizeVerificationBenchmarks(makeDb([formal('swing',before,'old')]),'swing',{asOf:'20260907'});
  assert.equal(empty.window.fromDate,null);assert.equal(empty.window.throughDate,null);assert.equal(empty.reason,'outside-display-window');
});
test('波段固定第1session open到第15session close，不取提前停損；缺第15日不順延',()=>{
  const c=capture('swing'),spec=mod.fixedBenchmarkSpec('swing');
  assert.equal(typeof mod.buildFixedHorizonObservation,'function');
  const got=mod.buildFixedHorizonObservation({capture:c,candidate:c.candidates[0],rows:prices(c),calendar,benchmarkSpec:spec});
  assert.equal(got.status,'complete');assert.ok(Math.abs(got.returnPct-9.529)<1e-9);assert.deepEqual(got.period,{entryDate:sessions[0],exitDate:sessions[14]});
  for(const rows of [prices(c).slice(0,-1),prices(c).map((r,i)=>i===4?{...r,source:'Yahoo chart'}:r)]){
    assert.equal(mod.buildFixedHorizonObservation({capture:c,candidate:c.candidates[0],rows,calendar,benchmarkSpec:spec}).returnPct,null);
  }
  assert.equal(mod.buildFixedHorizonObservation({capture:c,candidate:c.candidates[0],rows:prices(c),calendar:{...calendar,coveredMonths:[]},benchmarkSpec:spec}).returnPct,null);
});
test('隔日不可用歷史close代換intraday凍結價；官方凍結close與事件還原分開',()=>{
  const c=capture();const candidate=c.candidates[0];
  const rows=prices(c).slice(0,2);rows[1]={...rows[1],close:104.5,exchangePreviousClose:null,exchangeCorporateActionMark:true};
  const spec=mod.fixedBenchmarkSpec('overnight');
  const args={capture:c,candidate,rows,calendar,benchmarkSpec:spec};
  assert.equal(mod.buildFixedHorizonObservation(args).returnPct,null);
  const got=mod.buildFixedHorizonObservation({...args,actionResults:{[sessions[0]]:{preClose:100,referencePrice:95,source:'TWSE-TWT49U',observedAt:'2026-08-25T08:00:00Z'}}});
  assert.ok(Math.abs(got.returnPct-9.529)<1e-9);assert.equal(got.evidence.entry.price,100);assert.equal(got.evidence.adjustedEntryPrice,95);
  for(const change of [{source:'TWSE MIS'},{price:90},{sourceAsOf:'20260802'}])assert.equal(mod.buildFixedHorizonObservation({...args,candidate:{...candidate,...change},actionResults:{[sessions[0]]:{preClose:100,referencePrice:95}}}).returnPct,null);
  assert.equal(mod.buildFixedHorizonObservation({...args,actionResults:{[sessions[0]]:{preClose:200,referencePrice:190}}}).returnPct,null);
});
test('價格取得時刻早於該日收盤或無效，不是正式close證據',()=>{
  const c=capture('swing');
  for(const stamp of ['not-a-time','2026-08-24T01:00:00Z']) {
    const rows=prices(c).map((r,i)=>i===15?{...r,observedAt:stamp}:r);
    assert.equal(mod.buildFixedHorizonObservation({capture:c,candidate:c.candidates[0],rows,calendar}).returnPct,null);
  }
});
test('官方跨年session需兩月份覆蓋與through上界',()=>{
  const c={...capture(),tradeDate:'20261231'},candidate={...c.candidates[0],sourceAsOf:'20261231'};
  const rows=[{date:'20261231',open:100,close:100},{date:'20270104',open:102,close:104}].map(r=>({...r,code:'2330',exchange:'TWSE',source:'TWSE STOCK_DAY',observedAt:'2027-01-04T08:00:00Z',exchangePreviousClose:100}));
  const cal={tradingDays:['20261231','20270104'],coveredMonths:['202612','202701'],through:'20270104'};
  assert.ok(Math.abs(mod.buildFixedHorizonObservation({capture:c,candidate,rows,calendar:cal}).returnPct-3.529)<1e-9);
  for(const partial of [{...cal,coveredMonths:['202701']},{...cal,through:'20261231'}])assert.equal(mod.buildFixedHorizonObservation({capture:c,candidate,rows,calendar:partial}).returnPct,null);
});
test('次開當日事件不改進場價，晚發布/時間跨開盤只揭露；中間K與跨月calendar不能略過',()=>{
  const c=capture('swing'),spec=mod.fixedBenchmarkSpec('swing'),rows=prices(c);
  const args={capture:c,candidate:c.candidates[0],rows,calendar,benchmarkSpec:spec,actionResults:{[sessions[0]]:{preClose:100,referencePrice:50}}};
  const got=mod.buildFixedHorizonObservation(args);assert.equal(got.evidence.adjustedEntryPrice,100);assert.equal(got.evidence.adjustments.length,0);
  assert.equal(got.evidence.timing,'available-before-open');
  for(const [times,want]of [[{publicationStartedAt:'2026-08-04T02:00:00Z'},'late-publication'],[{publicationStartedAt:'2026-08-04T00:59:00Z',availableConfirmedAt:'2026-08-04T01:01:00Z'},'timing-uncertain']]) {
    const result=mod.buildFixedHorizonObservation({...args,capture:{...c,...times}});assert.equal(result.evidence.timing,want);assert.equal(result.returnPct,got.returnPct);
  }
  assert.equal(mod.buildFixedHorizonObservation({...args,rows:rows.filter(r=>r.date!==sessions[4])}).returnPct,null);
  const tpex={...c.candidates[0],exchange:'TPEx'};const tpexRows=rows.map(r=>({...r,exchange:'TPEx',source:'TPEx tradingStock'}));
  assert.equal(mod.buildFixedHorizonObservation({...args,candidate:tpex,rows:tpexRows}).returnPct,got.returnPct);
  const duplicate={...capture(),issued:[...capture().issued,{...capture().issued[0],signalId:'c',scenario:'other'}]};
  const observations=[observation(duplicate,'2330','TWSE',2),observation(duplicate,'2317','TWSE',0),observation(duplicate,'6488','TPEx',4),observation(duplicate,'5483','TPEx',2)];
  const result=mod.buildMatchedBenchmark({capture:duplicate,observations});assert.equal(result.pairedCount,3);assert.equal(result.eligibleCount,3);assert.equal(result.poolCoverage.TWSE.eligibleCount,2);
});
