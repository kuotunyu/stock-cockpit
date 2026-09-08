// O08 離線合成量測：沿用診斷 fixture、正式 transaction 與 Chromium helper，不載入正式 DB。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, mkdir, rm, readdir, stat} from 'node:fs/promises';
import {resolve, dirname, basename, join} from 'node:path';
import {tmpdir, cpus, totalmem} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {bootServer} from '../tests/helpers/test-server.mjs';
import {surveillanceRoutes, fundamentalsRoutes, stockDayAllRow, tpexDailyCloseRow} from '../tests/helpers/fixtures.mjs';
import {prepareCompletedBenchmark, readBenchmarkEvidence, summarizeBenchmarkCompression} from '../verification-evidence.mjs';

export const MEASUREMENT = Object.freeze({seed:8082026,days:[1,5,20],formats:['raw','packed','mixed'],warmup:3,repeats:50,coldRepeats:3,browserRows:[20,260,1000],asOf:'20260301'});
export const RENDERER_PROBES = ['renderRows','renderMarketStrip','renderStrategies','renderDetail','renderWatchManager','renderScreenerSummary'];
export async function captureRendererProbes(workload, {names, target=globalThis, now=()=>performance.now()} = {}) {
  const parts={}, originals=[];
  try {
    for(const name of names) {
      const part=parts[name]={status:'missing',raw:[]};
      try {
        const fn=target[name];
        if(typeof fn!=='function')continue;
        const wrap=function(...args){const t=now();try{return fn.apply(this,args);}finally{part.status='measured';part.raw.push(now()-t);}};
        if(!Reflect.set(target,name,wrap))throw new Error('function is not writable');
        originals.push([name,fn]);
        if(target[name]!==wrap)throw new Error('function wrapper was not installed');
        part.status='not-called';
      } catch(error) {throw new Error(`Renderer probe installation failed: ${name}`,{cause:error});}
    }
    return {value:await workload(), parts};
  } finally { for(const [name,fn]of originals.reverse())target[name]=fn; }
}
export async function withExpectedFixtureDiagnostic(action, {kind,blocker,logger=console}) {
  assert.ok(['admin','atomic'].includes(kind));
  if(kind==='atomic') {
    ownedDirectory(dirname(resolve(blocker)));
    assert.equal(basename(blocker),'stock1-db.json.tmp');
  }
  const method=kind==='admin'?'warn':'error', original=logger[method];
  let count=0;
  logger[method]=function(...args) {
    const expected=kind==='admin'
      ? args.length===1&&args[0]==='[Stock1] Created initial admin user "admin". Set ADMIN_PASSWORD before cloud deployment.'
      : args.length===2&&args[0]==='[Stock1] 主資料庫寫入失敗，未發布的記憶體草稿已丟棄：'
        &&typeof args[1]==='string'&&args[1].endsWith(`, unlink '${blocker}'`);
    if(expected)count++;
    else original.apply(this,args);
  };
  try {const value=await action();assert.equal(count,1,`expected exactly 1 ${kind} fixture diagnostic`);return value;}
  finally {logger[method]=original;}
}
export function summarizeRendererProbes(parts) {
  return Object.fromEntries(Object.entries(parts).map(([name,part])=>[name,{status:part.status,
    ...(part.status==='measured'?describeSamples(part.raw):{count:0,raw:[]})}]));
}
export function describeSamples(raw) {
  assert.ok(raw.length && raw.every(Number.isFinite),'樣本必須為非空有限數字');
  const sorted=[...raw].sort((a,b)=>a-b);
  return {count:raw.length,min:sorted[0],max:sorted.at(-1),mean:raw.reduce((a,b)=>a+b,0)/raw.length,
    ...(raw.length>=50?{p50:sorted[Math.ceil(raw.length*.5)-1],p95:sorted[Math.ceil(raw.length*.95)-1]}:{}),raw:[...raw]};
}
export function seededRandom(seed) {let value=seed>>>0;return ()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
export function validateMeasurementOptions(days,format) {
  days=Number(days);assert.ok(MEASUREMENT.days.includes(days),'只能選擇已登記的 1／5／20 日規模');
  assert.ok(MEASUREMENT.formats.includes(format),'只能選擇 raw／packed／mixed');return {days,format};
}
const bytes=x=>Buffer.byteLength(JSON.stringify(x,null,2)+'\n');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const timed=async fn=>{const start=performance.now();const value=await fn();return {ms:performance.now()-start,value};};
const selected=db=>Object.fromEntries(['verificationPublications','verificationCaptures','verificationBenchmarks','tradePlans','watchLists','dataRevs'].map(key=>[key,db[key]]));
const memory=()=>{const {rss,heapUsed,external,arrayBuffers}=process.memoryUsage();return {rss,heapUsed,external,arrayBuffers};};
function ownedDirectory(path) {const p=resolve(path);assert.equal(dirname(p),resolve(tmpdir()));assert.ok(basename(p).startsWith('stock1-test-'));return p;}
async function diskComposition(path) {
  const entries=[];for(const name of await readdir(path)){const p=join(path,name),s=await stat(p);if(s.isFile())entries.push({name,bytes:s.size});else if(s.isDirectory()&&name==='backups')for(const file of await readdir(p)){const b=await stat(join(p,file));if(b.isFile())entries.push({name:`backups/${file}`,bytes:b.size});}}
  return entries;
}
async function request(srv,path,init) {const response=await srv.api(path,init);const body=await response.json();return {status:response.status,body};}
function coldRestart(dataDir,expected) {
  // 真 startServer 包含 O04 identity，前一 writer 必須先 shutdown；只交給 child 自己建立的 temp 路徑。
  ownedDirectory(dataDir);
  const helper=pathToFileURL(resolve('tests/helpers/test-server.mjs')).href;
  const child=`import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {importServer} from ${JSON.stringify(helper)};
const t=performance.now();const srv=await importServer({dataDir:${JSON.stringify(dataDir)},env:{UPDATE_CHECK:'off',DISABLE_CLOSE_SCHEDULER:'1'}});
try {const server=await srv.mod.startServer(0,'127.0.0.1');const readyMs=performance.now()-t;assert.notEqual(server.address().port,5174);const db=await srv.mod.loadDb();
const value=Object.fromEntries(${JSON.stringify(['verificationPublications','verificationCaptures','verificationBenchmarks','tradePlans','watchLists','dataRevs'])}.map(k=>[k,db[k]]));
const hash=createHash('sha256').update(JSON.stringify(value)).digest('hex');assert.equal(hash,${JSON.stringify(expected)});console.log(JSON.stringify({importToReadyMs:readyMs,hash,identity:srv.mod.getAppIdentity(),memory:process.memoryUsage(),externalCalls:srv.mock.calls.length}));
}finally{await srv.mod.shutdownServer();srv.mock.restore();}`;
  const start=performance.now();const result=execFileSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8',maxBuffer:4*1024*1024});
  return {...JSON.parse(result.trim().split('\n').at(-1)),processWallMs:performance.now()-start};
}

async function backendMeasurement(days,format,buildSyntheticDb) {
  const srv=await withExpectedFixtureDiagnostic(()=>bootServer({routes:[...surveillanceRoutes({reference:[stockDayAllRow({code:'2330',close:100})],tpexReference:[tpexDailyCloseRow({code:'5347',close:100})]}),...fundamentalsRoutes({}),
    {match:/mis\.twse\.com\.tw/,reply:{msgArray:[]}},
    {match:/query1\.finance\.yahoo\.com/,reply:{chart:{result:[]}}}],env:{UPDATE_CHECK:'off',DISABLE_CLOSE_SCHEDULER:'1'}}),{kind:'admin'});
  const m=srv.mod,path=ownedDirectory(srv.dataDir),db=await m.loadDb();
  try {
    await buildSyntheticDb(m,db,days+1,{random:seededRandom(MEASUREMENT.seed)});
    const memos=Object.values(db.verificationBenchmarks.memos),pending=memos.slice(-2);
    for(const memo of pending)Object.assign(memo,{status:'pending',result:null,observations:[],cursor:0,reason:'synthetic-awaiting-observation',completedAt:null});
    const beforeSummary=JSON.stringify(['overnight','swing'].map(strategy=>m.summarizeVerificationBenchmarks(db,strategy,{asOf:MEASUREMENT.asOf})));
    for(const [index,[key,memo]] of Object.entries(db.verificationBenchmarks.memos).entries()) {
      if(memo.status==='complete'&&(format==='packed'||(format==='mixed'&&Math.floor(index/2)%2===0))) {
        const packed=prepareCompletedBenchmark(memo);assert.deepEqual(readBenchmarkEvidence(packed),readBenchmarkEvidence(memo));db.verificationBenchmarks.memos[key]=packed;
      }
    }
    const summary=()=>['overnight','swing'].map(strategy=>m.summarizeVerificationBenchmarks(db,strategy,{asOf:MEASUREMENT.asOf}));
    assert.equal(JSON.stringify(summary()),beforeSummary);
    const user=db.users.find(u=>u.username==='admin');
    const plans=Array.from({length:days*2},(_,i)=>({planId:`08082026-0000-4000-8000-${String(i).padStart(12,'0')}`,signalId:null,sourceCaptureId:null,code:String(1000+i),exchange:'TWSE',strategy:i%2?'swing':'overnight',scenario:null,status:'draft',entryPrice:null,entryLow:null,entryHigh:null,riskBudgetCash:null,invalidationReason:'',stopPrice:null,targetPrice:null,quantity:null,expiresOn:null,reason:'合成手動草稿'}));
    db.tradePlans[user.id]=m.canonicalizeTradePlans({schemaVersion:1,plans},undefined,{db,now:'2026-03-01T08:00:01Z'});
    await m.saveDb(db);
    const evidenceFingerprint=digest(memos.map(memo=>({captureId:memo.captureId,inputFingerprint:memo.inputFingerprint,modelKey:memo.modelKey,result:memo.result})));
    const composition={evidenceFingerprint,databaseBytes:(await stat(join(path,'stock1-db.json'))).size,resourceBytes:Object.fromEntries(Object.entries(db).map(([k,v])=>[k,bytes(v)])),files:await diskComposition(path),compression:summarizeBenchmarkCompression(Object.values(db.verificationBenchmarks.memos)),plans:plans.length,captures:Object.keys(db.verificationCaptures).length,candidates:(days+1)*500,completedMemos:days*2,pendingMemos:2,
      summaryWindows:summary().map(s=>({asOf:s.asOf,window:s.window,cohorts:s.cohorts?.length,modelGroups:s.modelGroups?.length}))};
    const raw={saveMs:[],summaryComputeMs:[],personalSaveWithQueueMs:[],readDuringSaveMs:[],quoteDuringSaveMs:[],backgroundCommitMs:[],queueEntryIncludingDraftCloneMs:[],rssBytes:[],heapUsedBytes:[],externalBytes:[]};
    // 獨立慢儲存／查詢的基準與同時執行，各輪都消費完整 HTTP body。
    const isolated={saveMs:[],personalSaveMs:[],readMs:[],quoteMs:[]};
    let rev=(await request(srv,'/api/watchlists')).body.rev;
    const put=code=>request(srv,'/api/watchlists',{method:'PUT',body:JSON.stringify({rev,lists:{1:[code],2:[],3:[]}})});
    await request(srv,'/api/quotes?codes=2330');
    const loop=monitorEventLoopDelay({resolution:10});loop.enable();
    for(let i=-MEASUREMENT.warmup;i<MEASUREMENT.repeats;i++) {
      if(i===0)loop.reset();
      const standaloneSave=await timed(()=>m.saveDb(db));
      const alonePut=await timed(()=>put(i%2?'2330':'1101'));assert.equal(alonePut.value.status,200);rev=alonePut.value.body.rev;
      const aloneRead=await timed(()=>request(srv,'/api/watchlists'));
      const aloneQuote=await timed(()=>request(srv,'/api/quotes?codes=2330'));
      const submit=performance.now();let queueEntry;
      const first=m.commitDbMutation(draft=>{summary();draft.verificationBenchmarks.cursor=`o08-background-${i}`;});
      const background=timed(()=>m.commitDbMutation(draft=>{queueEntry=performance.now()-submit;draft.verificationBenchmarks.cursor=`o08-following-${i}`;}));
      const save=timed(()=>put(i%2?'1101':'2330'));
      const read=timed(()=>request(srv,'/api/watchlists'));
      const quote=timed(()=>request(srv,'/api/quotes?codes=2330'));
      const summaryStart=performance.now(),summaryValue=summary();const summaryMeasurement={ms:performance.now()-summaryStart,value:summaryValue};
      const [,bg,s,r,q,sum]=await Promise.all([first,background,save,read,quote,summaryMeasurement]);
      assert.equal(s.value.status,200);assert.equal(s.value.body.rev,rev+1);rev=s.value.body.rev;
      assert.equal(r.value.status,200);assert.ok([rev-1,rev].includes(r.value.body.rev));assert.equal(q.value.status,200);
      assert.strictEqual(await m.loadDb(),db);
      if(i>=0){for(const [key,value]of Object.entries({saveMs:standaloneSave.ms,summaryComputeMs:sum.ms,personalSaveWithQueueMs:s.ms,readDuringSaveMs:r.ms,quoteDuringSaveMs:q.ms,backgroundCommitMs:bg.ms,queueEntryIncludingDraftCloneMs:queueEntry,rssBytes:memory().rss,heapUsedBytes:memory().heapUsed,externalBytes:memory().external}))raw[key].push(value);
        for(const [key,value]of Object.entries({saveMs:standaloneSave.ms,personalSaveMs:alonePut.ms,readMs:aloneRead.ms,quoteMs:aloneQuote.ms}))isolated[key].push(value);}
    }
    loop.disable();
    const eventLoop={resolutionMs:10,count:loop.count,minMs:loop.min/1e6,maxMs:loop.max/1e6,meanMs:loop.mean/1e6,...(loop.count>=50?{p50Ms:loop.percentile(50)/1e6,p95Ms:loop.percentile(95)/1e6}:{})};
    // 故障與 held draft 在量測外驗證，避免將人工 barrier 當效能樣本。
    const before=await request(srv,'/api/watchlists');let entered,release;
    const inside=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});
    const pendingWrite=m.commitDbMutation(async draft=>{draft.watchLists[user.id]['1']=['9999'];entered();await hold;throw Object.assign(new Error('synthetic discard'),{code:'O08_DISCARD'});});
    try {await inside;assert.deepEqual(await request(srv,'/api/watchlists'),before);assert.strictEqual(await m.loadDb(),db);}finally{release();}
    await assert.rejects(pendingWrite,{code:'O08_DISCARD'});
    const blocker=join(path,'stock1-db.json.tmp'),beforeHash=digest(selected(db));await mkdir(blocker);
    try {const failed=await withExpectedFixtureDiagnostic(()=>put('9999'),{kind:'atomic',blocker});assert.equal(failed.status,503);assert.equal(failed.body.code,'PERSISTENCE_FAILED');assert.equal(digest(selected(db)),beforeHash);assert.deepEqual(await request(srv,'/api/watchlists'),before);}finally{assert.equal(dirname(resolve(blocker)),path);await rm(blocker,{recursive:true,force:true});}
    const recovered=await put('2330');assert.equal(recovered.status,200);assert.equal(recovered.body.rev,rev+1);rev++;
    const stale=await request(srv,'/api/watchlists',{method:'PUT',body:JSON.stringify({rev:rev-1,lists:{1:['9999'],2:[],3:[]}})});assert.equal(stale.status,409);
    assert.strictEqual(await m.loadDb(),db);assert.ok(!JSON.stringify(db.watchLists).includes('9999'));
    assert.equal(JSON.stringify(summary()),beforeSummary);
    const expected=digest(selected(db)),calls=srv.mock.calls.length;
    await m.shutdownServer();
    const cold=Array.from({length:MEASUREMENT.coldRepeats},()=>coldRestart(path,expected));
    return {kind:'backend',fixture:{seed:MEASUREMENT.seed,days,format,asOf:MEASUREMENT.asOf},composition,samples:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,describeSamples(v)])),isolated:Object.fromEntries(Object.entries(isolated).map(([k,v])=>[k,describeSamples(v)])),eventLoop,cold,
      correctness:{rev,stableRootIdentity:true,pendingInvisible:true,failed503Invisible:true,stale409:true,recovery:true,restartHashes: cold.map(x=>x.hash),evidenceRoundTrip:true,summaryInvariant:true},externalMockCalls:calls,
      definitions:{queue:'submit second real commit to mutator entry, includes awaiting prior queued save and own JSON draft clone; not pure scheduler wait',summary:'two strategy computations, no summary result cache',background:'summary compute + two real queued cursor writes; no upstream collection',quote:'real HTTP quote API with offline source fixtures; cached quote path warmed first, TTL can expire; mock calls reported',memory:'post-iteration process samples, no forced GC; not a continuously sampled peak',cold:'fresh process import to startServer ready includes O04 identity; processWall includes spawn, asserts and shutdown; filesystem cache remains warm'}};
  }finally{await srv.close();}
}

async function browserMeasurement(rows) {
  const {createBrowserFixture}=await import('../tests/helpers/browser-fixtures.mjs');
  const fixture=await withExpectedFixtureDiagnostic(()=>createBrowserFixture({scenario:'populated'}),{kind:'admin'});ownedDirectory(fixture.server.dataDir);
  const {page,context,browser}=fixture;
  try {
    // 共用 helper 開始 trace；量測前停下，以免 tracing 檔案 IO 混入。
    await context.tracing.stop();
    const cold=[];
    for(let i=0;i<MEASUREMENT.coldRepeats;i++) {
      const start=performance.now();await page.reload({waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>!dataState.loading&&stocks.length>0&&!autoRefreshInFlight);
      cold.push({reloadToReadyMs:performance.now()-start,navigation:await page.evaluate(()=>performance.getEntriesByType('navigation')[0].toJSON())});
    }
    const ordinaryApiStart=fixture.apiCalls.length;
    const ordinaryPolling=await page.evaluate(async ({repeats,warmup})=>{const raw={apiAndJsMs:[],twoRafMs:[]};const inputRows=stocks.length;for(let i=-warmup;i<repeats;i++){while(autoRefreshInFlight)await new Promise(requestAnimationFrame);const t=performance.now();await refreshLiveData();const ms=performance.now()-t;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(i>=0){raw.apiAndJsMs.push(ms);raw.twoRafMs.push(performance.now()-t);}}return {inputRows,actualRows:document.querySelectorAll('#overnightRows .stock-row').length,raw};},{repeats:MEASUREMENT.repeats,warmup:MEASUREMENT.warmup});
    ordinaryPolling.quoteApiCalls=fixture.apiCalls.slice(ordinaryApiStart).filter(call=>call.includes('/api/quotes')).length;
    assert.ok(ordinaryPolling.quoteApiCalls>=MEASUREMENT.repeats+MEASUREMENT.warmup,'ordinary polling must exercise quote API, not an in-flight no-op');
    await page.evaluate(count=>{
      autoRefreshInFlight=true; // isolated render phase; ordinary polling was measured above
      const template=stocks[0];stocks.splice(0,stocks.length,...Array.from({length:count},(_,i)=>({...template,code:String(1000+i),name:`合成候選${i}`,price:100+i/10,change:i%9-4,changePct:i%9-4,total:10000+i,unit:5,spark:[98,100,99,101,100],watchLists:[1]})));
      state.screen='screener';state.universe='turnover';state.strategy='量能熱區';state.direction='all';state.watchOnly=false;state.showSurveillance=true;state.minTurnover=0;state.search='';state.selectedCode='';dataState.loading=false;dataState.error='';render();
    },rows);
    const actualRows=await page.locator('#screenerRows .stock-row').count();
    // 使用現行 screen 容器，數量斷言防止空 renderer 成假綠。
    assert.equal(actualRows,rows);
    const rendererWorkload=async ({repeats,warmup})=>{
      const raw={renderLiveDataUpdateJsMs:[],renderLiveDataUpdateTwoRafMs:[],renderRowsJsMs:[],renderRowsTwoRafMs:[],sortEventToTwoRafMs:[]};
      const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        for(let i=-warmup;i<repeats;i++){
          document.activeElement?.blur();let t=performance.now();renderLiveDataUpdate();const js=performance.now()-t;await frames();const paint=performance.now()-t;
          t=performance.now();renderRows(el.screenerRows,filterStocks('screener'),'screener');const listJs=performance.now()-t;await frames();const listPaint=performance.now()-t;
          const button=document.querySelector('.screener-screen [data-sort="price"]');if(!button||button.getBoundingClientRect().width===0)throw new Error('sort control not visible');
          const prior=state.sortDir;t=performance.now();button.focus();button.click();await frames();const sort=performance.now()-t;if(state.sortDir===prior&&state.sort==='price'&&i!==-warmup)throw new Error('sort did not toggle');
          if(i>=0)for(const [key,value]of Object.entries({renderLiveDataUpdateJsMs:js,renderLiveDataUpdateTwoRafMs:paint,renderRowsJsMs:listJs,renderRowsTwoRafMs:listPaint,sortEventToTwoRafMs:sort}))raw[key].push(value);
        }
      return {raw,domNodes:document.getElementsByTagName('*').length,canvasCount:document.querySelectorAll('canvas').length,actualRows:document.querySelectorAll('#screenerRows .stock-row').length,heap:performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null,resources:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize})),canvasReal:!!document.createElement('canvas').getContext('2d')};
    };
    // 只序列化本檔固定函式／設定到隔離 page；安裝與工作量共用 finally，沒有正式全域入口。
    const probeResult=await page.evaluate(`(${captureRendererProbes.toString()})((${rendererWorkload.toString()}).bind(null, ${JSON.stringify({repeats:MEASUREMENT.repeats,warmup:MEASUREMENT.warmup})}), {names:${JSON.stringify(RENDERER_PROBES)}})`);
    const measured={...probeResult.value,parts:probeResult.parts};
    assert.equal(measured.actualRows,rows);assert.ok(measured.canvasReal);
    assert.ok(fixture.apiCalls.some(call=>call.includes('/api/quotes')));
    return {kind:'browser',rows,ordinaryPolling:{inputRows:ordinaryPolling.inputRows,actualRows:ordinaryPolling.actualRows,quoteApiCalls:ordinaryPolling.quoteApiCalls,samples:Object.fromEntries(Object.entries(ordinaryPolling.raw).map(([k,v])=>[k,describeSamples(v)]))},chromium:browser.version(),viewport:page.viewportSize(),cold,samples:Object.fromEntries(Object.entries(measured.raw).map(([k,v])=>[k,describeSamples(v)])),rendererCallsIncludingWarmup:summarizeRendererProbes(measured.parts),resources:{domNodes:measured.domNodes,canvasCount:measured.canvasCount,heap:measured.heap,network:measured.resources},correctness:{actualRows:measured.actualRows,realCanvas:measured.canvasReal,sortToggled:true,quoteApiCalls:fixture.apiCalls.filter(call=>call.includes('/api/quotes')).length},definitions:{cold:'3 page reloads in same headless context, not cold browser process or cleared OS cache',twoRaf:'JS through two requestAnimationFrame callbacks; rendering opportunity including style/layout, not physical display/input-to-photon',interaction:'native button focus + HTMLElement.click through existing delegated sort and two rAF; excludes OS input latency',poll:'real refreshLiveData with existing offline browser API contract; no external network latency',rendererIsolation:'existing autoRefreshInFlight guard held only in this disposable fixture after ordinary polling; avoids unrelated 10-second poll changing the fixed large pool',rendererParts:'synchronous nested function calls including warmup, attribution can overlap; do not sum as independent frame costs'}};
  }finally{await fixture.close();}
}

export async function runMeasurementCli(args,{buildSyntheticDb}={}) {
  const [mode,a,b]=args;
  if(mode==='--o08-worker'){assert.equal(args.length,3);const {days,format}=validateMeasurementOptions(a,b);console.log(JSON.stringify(await backendMeasurement(days,format,buildSyntheticDb)));return;}
  if(mode==='--o08-browser'){assert.equal(args.length,2);const rows=Number(a);assert.ok(MEASUREMENT.browserRows.includes(rows));console.log(JSON.stringify(await browserMeasurement(rows)));return;}
  assert.equal(mode,'--o08');assert.equal(args.length,1,'診斷不接受 DB 或輸出路徑');
  const results=[];
  for(const days of MEASUREMENT.days)for(const format of MEASUREMENT.formats){console.error(`O08 backend ${days} days ${format}`);results.push(JSON.parse(execFileSync(process.execPath,['scripts/verification-diagnostics.mjs','--o08-worker',String(days),format],{encoding:'utf8',maxBuffer:20*1024*1024}).trim().split('\n').at(-1)));}
  for(const rows of MEASUREMENT.browserRows){console.error(`O08 Chromium ${rows} rows`);results.push(JSON.parse(execFileSync(process.execPath,['scripts/verification-diagnostics.mjs','--o08-browser',String(rows)],{encoding:'utf8',maxBuffer:20*1024*1024}).trim().split('\n').at(-1)));}
  console.log(JSON.stringify({schemaVersion:1,recordedAt:new Date().toISOString(),machine:{platform:process.platform,arch:process.arch,node:process.version,cpu:cpus()[0].model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},configuration:MEASUREMENT,results}));
}
