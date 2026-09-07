// 真實API與背景worker：有界續跑、來源故障、不可變memo、冷熱延遲。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {readBenchmarkEvidence} from '../../verification-evidence.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { bootServer, SERVER_PATH } from '../helpers/test-server.mjs';
const day='20260803',next='20260804';
let release, entered;let revised=false;
const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
const srv=await bootServer({routes:[
  {match:/rwd\/zh\/afterTrading\/FMTQIK/,reply:()=>({stat:'OK',data:[["115/08/03"],["115/08/04"]]})},
  {match:/openapi.*FMTQIK/,reply:[{Date:'1150803'},{Date:'1150804'}]},
  {match:/holidaySchedule/,reply:[]},
  {match:/TWT49U/,reply:{stat:'OK',data:[]}},
  {match:/exchangeReport\/STOCK_DAY\?/,reply:async url=>{entered();await gate;const code=url.searchParams.get('stockNo'),close=revised?120:code==='2330'?104:102;return {stat:'OK',data:[['115/08/03','1000000','100000000','100','100','100','100','0','100'],['115/08/04','1000000','100000000','100','120','99',String(close),String(close-100),'100']]};}},
]});
const {mod,mock}=srv;
after(async()=>{release();await srv.close();});
const c={captureId:'benchmark-canonical',inputFingerprint:'frozen',strategy:'overnight',tradeDate:day,identity:mod.currentVerificationIdentity('overnight'),kind:'formal',fullRecord:true,canonical:true,
  publicationStartedAt:'2026-08-03T08:00:00Z',availableConfirmedAt:'2026-08-03T08:00:01Z',
  candidates:['2330','2317','2303','2308','2344'].map((code,i)=>({code,exchange:'TWSE',candidateRank:i+1,price:100,source:'TWSE OpenAPI',sourceAsOf:day})),issued:[{signalId:'a',code:'2330',exchange:'TWSE'}]};
async function seed(capture=c){await mod.commitDbMutation(db=>{db.verificationCaptures={...(db.verificationCaptures||{}),[capture.captureId]:capture};db.verificationPublications={current:{key:capture.captureId},captures:{[capture.captureId]:{...capture,publicationKey:'key'}}};return true;});}
test('HTTP先回pending；真正冷來源延遲不掛前景，同flight，4檔後已ran排程仍續跑',async()=>{
  assert.equal(typeof mod.runVerificationBenchmarkBatch,'function');
  await seed();
  const coldAt=performance.now();
  const response=await srv.raw('/api/overnight/verify/history');const body=await response.json();
  const coldMs=performance.now()-coldAt;
  assert.equal(response.status,200);assert.equal(body.benchmarks.cohorts[0].status,'pending');assert.ok(coldMs<2000,`cold ${coldMs}`);
  await started;
  const a=mod.queueVerificationBenchmark(),b=mod.queueVerificationBenchmark();assert.equal(a,b);
  const hotAt=performance.now();const hot=await (await srv.raw('/api/overnight/verify/history')).json();const hotMs=performance.now()-hotAt;
  assert.equal(hot.benchmarks.cohorts[0].pairedCount,0);assert.ok(hotMs<1000,`hot ${hotMs}`);
  release();await a;
  let db=await mod.loadDb();let memo=Object.values(db.verificationBenchmarks.memos)[0];
  assert.equal(memo.cursor,4);assert.equal(memo.observations.length,4);assert.equal(memo.status,'pending');
  assert.ok(mock.calls.length<=30);const coldCalls=mock.calls.length;
  const today=mod.toTaipeiCompactDate();
  const result=await mod.runScheduledCloseTasks({lastRunDay:today,getReferenceData:async()=>({}),loadDb:async()=>db,queueVerificationBenchmark:mod.queueVerificationBenchmark});
  assert.equal(result.skipped,'already-ran');await mod.flushPersistence();
  db=await mod.loadDb();memo=Object.values(db.verificationBenchmarks.memos)[0];
  assert.equal(memo.status,'complete');assert.equal(memo.result.pairedCount,1);assert.equal(memo.result.eligibleCount,1);
  assert.ok(Math.abs(memo.result.meanDifference-1.6)<1e-9);
  assert.equal(db.swingVerification && Object.values(db.swingVerification).flat().length,0);
  const completeCalls=mock.calls.length,saved=structuredClone(memo);
  const nextModel=structuredClone(db);nextModel.verificationCaptures[c.captureId].identity.evaluationVersion='future-evaluator';
  const unborrowed=mod.summarizeVerificationBenchmarks(nextModel,'overnight');assert.equal(unborrowed.cohorts[0].pairedCount,0);assert.equal(unborrowed.cohorts[0].status,'pending');
  revised=true;mod.resetHistoryCacheForTest();await mod.runVerificationBenchmarkBatch();
  assert.equal(mock.calls.length,completeCalls);assert.deepEqual(Object.values((await mod.loadDb()).verificationBenchmarks.memos)[0],saved);
  const disk=JSON.parse(await readFile(join(srv.dataDir,'stock1-db.json'),'utf8'));
  assert.deepEqual(Object.values(disk.verificationBenchmarks.memos)[0],saved);
  const bytes=value=>Buffer.byteLength(JSON.stringify(value));
  const decoded=readBenchmarkEvidence(saved);
  console.log(JSON.stringify({coldMs,hotMs,coldCalls,completeCalls,completedRereadCalls:mock.calls.length-completeCalls,
    storage:{constituents:decoded.observations.length,memoBytes:bytes(saved),captureBytes:bytes(decoded.capture),observationsBytes:bytes(decoded.observations),
      rowsBytes:decoded.observations.reduce((n,o)=>n+bytes(o.evidence.rows),0),repeatedCalendarBytes:decoded.observations.reduce((n,o)=>n+bytes(o.evidence.calendar),0)}}));
});
test('三個官方月份與四檔月K各重試一次：真worker最多30來源呼叫，不啟動隱藏來源',async()=>{
  const dates={202601:['20260102','20260105','20260106','20260107','20260108'],202602:['20260202','20260203','20260204','20260205','20260206'],202603:['20260302','20260303','20260304','20260305','20260306','20260309']};
  const roc=date=>`${Number(date.slice(0,4))-1911}/${date.slice(4,6)}/${date.slice(6)}`;
  const seen=new Set();
  const remove=mock.override({match:/rwd\/zh\/afterTrading\/FMTQIK|STOCK_DAY\?/,reply:url=>{
    const month=url.searchParams.get('date').slice(0,6);
    if(url.pathname.includes('FMTQIK'))return {stat:'OK',data:dates[month].map(date=>[roc(date)])};
    const key=url.toString();if(!seen.has(key)){seen.add(key);return {__error:'transient'};}
    return {stat:'OK',data:dates[month].map(date=>[roc(date),'1000000','100000000','100','100','100','100','0','100'])};
  }});
  try {
    await seed({...c,captureId:'three-months',inputFingerprint:'three-months',strategy:'swing',tradeDate:'20260102',identity:mod.currentVerificationIdentity('swing'),candidates:c.candidates.slice(0,4)});
    const before=mock.calls.length,start=performance.now();const result=await mod.runVerificationBenchmarkBatch();
    const calls=mock.calls.slice(before);assert.equal(result.attempted,4);assert.equal(result.status,'complete');assert.equal(calls.length,30);
    assert.equal(calls.filter(c=>/STOCK_DAY\?/.test(c.url)).length,24);assert.equal(calls.filter(c=>/TWT49U/.test(c.url)).length,3);assert.equal(calls.filter(c=>/FMTQIK/.test(c.url)).length,3);
    console.log(JSON.stringify({worstBoundCalls:calls.length,withRetryMs:performance.now()-start}));
  }finally{remove();}
});
test('新spec key不借舊memo；canonical指紋改變後另存觀察，来源中斷不毀已完成值',async()=>{
  const db=await mod.loadDb(),old=structuredClone(db.verificationBenchmarks);
  await seed({...c,inputFingerprint:'revision',candidates:c.candidates.slice(0,1)});
  const remove=mock.override({match:/STOCK_DAY\?/,reply:{__error:'source outage'}});
  try{await mod.runVerificationBenchmarkBatch();}finally{remove();}
  const updated=(await mod.loadDb()).verificationBenchmarks;
  assert.equal(Object.keys(updated.memos).length,Object.keys(old.memos).length+1);assert.deepEqual(updated.memos[Object.keys(old.memos)[0]],old.memos[Object.keys(old.memos)[0]]);
  const pending=Object.values(updated.memos).find(m=>m.inputFingerprint==='revision');assert.equal(pending.status,'unavailable');assert.equal(pending.result.meanDifference,null);
  const calls=mock.calls.length;await mod.runVerificationBenchmarkBatch();assert.equal(mock.calls.length,calls);
  assert.notEqual(mod.benchmarkModelKey(c,{...mod.fixedBenchmarkSpec('overnight'),version:'next-version'}),mod.benchmarkModelKey(c));
});
test('延遲工作提交前canonical改變則丟棄；shutdown追蹤未完成寫入、重開離線仍讀完成memo',async()=>{
  let unblock,signal;
  const waiting=new Promise(r=>unblock=r),ready=new Promise(r=>signal=r);
  mod.resetHistoryCacheForTest();
  await seed({...c,captureId:'cas',inputFingerprint:'before',candidates:c.candidates.slice(0,1)});
  const beforeCount=Object.keys((await mod.loadDb()).verificationBenchmarks.memos).length;
  const remove=mock.override({match:/STOCK_DAY\?/,reply:async()=>{signal();await waiting;return {stat:'OK',data:[['115/08/03','1','1','100','100','100','100','0','1'],['115/08/04','1','1','100','104','100','104','4','1']]};}});
  try {
    const task=mod.queueVerificationBenchmark();await ready;
    await seed({...c,captureId:'cas-replaced',inputFingerprint:'after',candidates:c.candidates.slice(0,1)});
    unblock();assert.equal((await task).status,'discarded');
    assert.equal(Object.keys((await mod.loadDb()).verificationBenchmarks.memos).length,beforeCount);
  }finally{unblock();remove();}
  let end,begin;const ending=new Promise(r=>end=r),began=new Promise(r=>begin=r);
  mod.resetHistoryCacheForTest();
  const stopRoute=mock.override({match:/STOCK_DAY\?/,reply:async()=>{begin();await ending;return {stat:'OK',data:[['115/08/03','1','1','100','100','100','100','0','1'],['115/08/04','1','1','100','104','100','104','4','1']]};}});
  try {
    const task=mod.queueVerificationBenchmark();await began;
    let stopped=false;const stopping=mod.shutdownServer().then(()=>{stopped=true;});
    assert.equal(mod.queueVerificationBenchmark(),null);await Promise.resolve();assert.equal(stopped,false);
    end();await task;await stopping;assert.equal(stopped,true);
    const disk=JSON.parse(await readFile(join(srv.dataDir,'stock1-db.json'),'utf8'));
    const memo=Object.values(disk.verificationBenchmarks.memos).find(m=>m.captureId==='cas-replaced');assert.equal(memo.status,'complete');
    const script=`globalThis.fetch=()=>{throw new Error('offline-restart must not fetch')};const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)});await m.startServer(0);const db=await m.loadDb();const result=m.summarizeVerificationBenchmarks(db,'overnight');const job=await m.runVerificationBenchmarkBatch();await m.shutdownServer();console.log(JSON.stringify({paired:result.cohorts[0].pairedCount,value:result.cohorts[0].meanDifference,job:job.status}));`;
    const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{env:{...process.env,PORT:'0',SCHEDULER:'off'},timeout:10000});
    assert.deepEqual(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)),{paired:1,value:0,job:'idle'});
  }finally{end();stopRoute();}
});
