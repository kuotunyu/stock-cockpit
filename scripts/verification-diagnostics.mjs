import assert from 'node:assert/strict';
import {prepareCompletedBenchmark,readBenchmarkEvidence,summarizeBenchmarkCompression} from '../verification-evidence.mjs';
import {createHash} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {importServer,SERVER_PATH} from '../tests/helpers/test-server.mjs';
// 只接受合成交易日數，不接受DB或帳號輸入；helper清除ambient DATA_DIR/DB_PATH並綁定PORT=0。
const days=Number(process.argv[2]||5), counts={overnight:260,swing:240};
if(!Number.isInteger(days)||days<1||days>20)throw new Error('合成量測 days 必須是1～20整數');
const srv=await importServer({routes:[{match:/rwd\/zh\/afterTrading\/FMTQIK/,reply:{stat:'OK',data:[['115/08/03'],['115/08/04']]}}]}); const m=srv.mod;
const stable=x=>Array.isArray(x)?`[${x.map(stable).join(',')}]`:x&&typeof x==='object'?`{${Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')}}`:JSON.stringify(x);
const bytes=x=>Buffer.byteLength(JSON.stringify(x,null,2)+'\n');
const timed=async fn=>{const t=performance.now();const value=await fn();return {value,ms:performance.now()-t};};
try {
 const db=await m.loadDb();
 let day='20260104';
 for(let d=0;d<days;d++) {
  day=m.addDaysCompact(day,1);while([0,6].includes(new Date(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6)+'T00:00:00Z').getUTCDay()))day=m.addDaysCompact(day,1);
  // 每個合成cohort用不同交易日；不以週末重複覆蓋同日。
  if(Object.values(db.verificationPublications?.captures||{}).some(c=>c.tradeDate.replaceAll('-','')===day)){d--;continue;}
  const stamp=day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6)+'T08:00:00Z';
  for(const strategy of ['overnight','swing']) {
   const candidates=Array.from({length:counts[strategy]},(_,i)=>({code:String(1000+i),name:'合成候選',exchange:i%2?'TPEx':'TWSE',candidateRank:i+1,price:100,source:(i%2?'TPEx':'TWSE')+' OpenAPI',sourceAsOf:day,volume:10000,changePct:1}));
   const signals=candidates.slice(0,strategy==='overnight'?20:40).map(c=>({...c,group:'volume',scenario:{key:'midBandDefense',name:'合成場景'},plan:{entry:100,structuralStop:95,target:108},score:80}));
   const body={asOf:day,generatedAt:stamp,formulaVersion:m.currentVerificationIdentity(strategy).selectionVersion,requestScope:m.canonicalVerificationScope(strategy),coverage:{complete:true,markets:{twse:{asOf:day},tpex:{asOf:day}}},scanQuality:{candidateCount:candidates.length,completedCount:candidates.length,readyCount:candidates.length,reliable:true,coverageRate:100},candidatePool:candidates,inputEvidence:candidates.map((c,i)=>({...c,outcome:i<signals.length?'selected':'condition-not-met',historyFingerprint:'a'.repeat(64),corporateActionsFingerprint:'b'.repeat(64),observedAt:'2026-09-01T08:00:00Z',sourceEvidence:{official:[{status:'complete',source:c.exchange+' monthly',month:day.slice(0,6)}]}})),groups:{volume:signals},picks:signals};
   const p=m.publishVerification(db,strategy,body), capture=db.verificationCaptures[p.captureId];assert.equal(p.kind,'formal');assert.equal(capture.fullRecord,true);
   for(const target of [db.verificationPublications.captures[p.captureId],capture])Object.assign(target,{publicationStartedAt:stamp,availableConfirmedAt:stamp,publishedAt:stamp});
   const sessions=[];let next=day;while(sessions.length<15){next=m.addDaysCompact(next,1);if(![0,6].includes(new Date(next.slice(0,4)+'-'+next.slice(4,6)+'-'+next.slice(6)+'T00:00:00Z').getUTCDay()))sessions.push(next);}
   const months=[...new Set([day,...sessions].map(s=>s.slice(0,6)))];
   const calendar={tradingDays:[day,...sessions],coveredMonths:months,through:sessions.at(-1),source:m.fixedBenchmarkSpec(strategy).calendarVersion,computedAt:'2026-09-01T08:00:00Z',monthEvidence:Object.fromEntries(months.map(month=>[month,{source:'TWSE FMTQIK',requestedAt:'2026-09-01T08:00:00Z',observedAt:'2026-09-01T08:00:01Z',coveredFrom:month+'01',coveredThrough:m.addDaysCompact(m.addMonthsCompact(month+'01',1),-1),completeMonth:true,status:'fresh'}]))};
   const spec=m.fixedBenchmarkSpec(strategy), modelKey=m.benchmarkModelKey(capture,spec);
   const observations=candidates.map(candidate=>m.buildFixedHorizonObservation({capture,candidate,calendar,rows:[day,...sessions].map(date=>({date,code:candidate.code,exchange:candidate.exchange,open:100,high:102,low:99,close:date===day?100:101,exchangePreviousClose:100,source:candidate.exchange==='TWSE'?'TWSE STOCK_DAY':'TPEx tradingStock',observedAt:'2026-09-01T08:00:00Z'}))}));
   assert.ok(observations.every(o=>o.status==='complete'));
   const key=createHash('sha256').update(stable({captureId:capture.captureId,inputFingerprint:capture.inputFingerprint,modelKey})).digest('hex');
   db.verificationBenchmarks||={memos:{},cursor:''};
   db.verificationBenchmarks.memos[key]={captureId:capture.captureId,inputFingerprint:capture.inputFingerprint,modelKey,benchmarkSpec:spec,capture:structuredClone(capture),calendar,calendarAttempt:structuredClone(calendar),observations,cursor:0,status:'complete',result:m.buildMatchedBenchmark({capture,observations,benchmarkSpec:spec}),reason:null,retryAt:0,completedAt:'2026-09-01T08:00:00Z',updatedAt:'2026-09-01T08:00:00Z'};
  }
 }
 const sampleMemos=Object.fromEntries(['overnight','swing'].map(s=>{const memo=Object.values(db.verificationBenchmarks.memos).find(x=>x.capture.strategy===s);return [s,{rawBytes:bytes(memo),parts:Object.fromEntries(Object.entries(memo).map(([k,v])=>[k,bytes(v)]))}];}));
 const summary=()=>['overnight','swing'].map(s=>m.summarizeVerificationBenchmarks(db,s,{asOf:'20260331'}));
 async function measure(format) {
  const save=await timed(()=>m.saveDb(db));
  const cow=await timed(()=>m.commitDbMutation(draft=>{draft.verificationBenchmarks.cursor='synthetic-diagnostic';}));
  const cold=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const t=performance.now();const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)});const db=await m.loadDb();console.log(JSON.stringify({loadWithImportMs:performance.now()-t,memos:Object.keys(db.verificationBenchmarks.memos).length}));`],{encoding:'utf8',env:{...process.env,PORT:'0',STOCK1_SKIP_LISTEN:'1',DATA_DIR:srv.dataDir}}).trim().split('\n').at(-1));
  const first=await timed(summary),hot=await timed(summary);assert.equal(first.value.flatMap(s=>s.cohorts).length,days*2);
  return {format,compression:summarizeBenchmarkCompression(Object.values(db.verificationBenchmarks.memos)),diskBytes:(await readFile(join(srv.dataDir,'stock1-db.json'))).length,resources:Object.fromEntries(['verificationPublications','verificationCaptures','verificationBenchmarks','signalSnapshots','swingVerification'].map(k=>[k,bytes(db[k])])),saveMs:save.ms,cowAtomicMs:cow.ms,...cold,summaryFirstMs:first.ms,summaryRepeatMs:hot.ms};
 }
 const beforeSummary=JSON.stringify(summary()),before=await measure('raw-completed-memos');
 const compression=await timed(()=>{for(const [key,memo]of Object.entries(db.verificationBenchmarks.memos)){
  const packed=prepareCompletedBenchmark(memo);assert.deepEqual(readBenchmarkEvidence(packed),readBenchmarkEvidence(memo));
  db.verificationBenchmarks.memos[key]=packed;
 }});
 assert.equal(JSON.stringify(summary()),beforeSummary);
 const after=await measure('packed-completed-memos');
 const coldCalls=srv.mock.calls.length,coldCalendar=await timed(()=>m.getSwingHistoricalCalendar('20260801','20260801',{includeSourceEvidence:true}));
 const firstCalls=srv.mock.calls.length-coldCalls,hotCalls=srv.mock.calls.length;
 const hotCalendar=await timed(()=>m.getSwingHistoricalCalendar('20260801','20260801',{includeSourceEvidence:true}));
 assert.deepEqual(hotCalendar.value.tradingDays,coldCalendar.value.tradingDays);
 console.log(JSON.stringify({fixture:{days,candidatesPerDay:counts,signalsPerDay:{overnight:20,swing:40},retainedRows:{overnight:2,swing:15},fullPublicationsAndManifests:true,completedBenchmarkMemos:days*2},
  capture:{expected:days*2,complete:Object.values(db.verificationCaptures).filter(c=>c.fullRecord).length},
  pending:{benchmark:Object.values(db.verificationBenchmarks.memos).filter(memo=>memo.status!=='complete').length,swingAwaitingSession:Object.values(db.swingVerification).flat().filter(e=>e?.status==='pending').length},
  before,after,sampleMemos,encodeAndVerifyMs:compression.ms,
  calendarCache:{coldMs:coldCalendar.ms,hotMs:hotCalendar.ms,coldUpstreamCalls:firstCalls,hotUpstreamCalls:srv.mock.calls.length-hotCalls},
  upstreamCalls:srv.mock.calls.length,limits:'synthetic-only; full canonical pools but simplified picks; single-run wall times; summary repeat is computation, not a result-cache hit; no automatic migration of existing raw memos'}));
}finally{await m.shutdownServer();srv.mock.restore();const p=resolve(srv.dataDir);assert.equal(dirname(p),resolve(tmpdir()));assert.ok(basename(p).startsWith('stock1-test-'));await rm(p,{recursive:true,force:true});}
