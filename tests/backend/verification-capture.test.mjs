// 採集 manifest 與正式清單原子保存；候選順位、來源與缺採集證據不得事後補造。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SERVER_PATH } from '../helpers/test-server.mjs';
import { importServer } from '../helpers/test-server.mjs';
import { surveillanceRoutes, fundamentalsRoutes, stockDayAllRow, tpexDailyCloseRow, compactTradingDay, compactToday, rocSlash } from '../helpers/fixtures.mjs';
const {mod,mock,dataDir}=await importServer();
after(async()=>{await mod.flushPersistence();mock.restore();await rm(dataDir,{recursive:true,force:true});});
function source(date='2026-09-04') {
  return {asOf:date,formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,requestScope:{maxCandidates:260,maxPerGroup:20},
    coverage:{complete:true,markets:{twse:{asOf:date},tpex:{asOf:date}}},
    scanQuality:{candidateCount:1,completedCount:1,readyCount:1,reliable:true,coverageRate:100},
    candidatePool:[{code:'2330',exchange:'TWSE',candidateRank:1,price:100,source:'official-close',sourceAsOf:date}],
    inputEvidence:[{code:'2330',exchange:'TWSE',outcome:'condition-not-met'}],groups:{}};
}
test('完整零訊號保留掃描候選；後到revision不能取代首次manifest或重建舊池',()=>{
  const db={};const body=source(); const p=mod.publishVerification(db,'overnight',body);
  assert.ok(db.verificationCaptures?.[p.captureId],'同次發布應寫入manifest');
  const m=structuredClone(db.verificationCaptures[p.captureId]);
  assert.equal(m.status,'complete-zero');assert.equal(m.candidates[0].price,100);assert.equal(m.candidates[0].candidateRank,1);
  body.candidatePool[0].price=200;
  const correction=mod.publishVerification(db,'overnight',body);
  assert.equal(correction.kind,'correction');assert.deepEqual(db.verificationCaptures[p.captureId],m);
  assert.equal(db.verificationPublications.current[p.publicationKey],p.captureId);
  delete db.verificationCaptures[p.captureId];
  mod.publishVerification(db,'overnight',source());
  assert.equal(db.verificationCaptures[p.captureId],undefined,'T03舊capture缺manifest不能以今日資料回填');
});
test('provisional、半市場、日期不齊、失敗與未知候選證據分開，完整degraded仍接受',()=>{
  for (const [mode,want] of [['provisional','incomplete'],['half','incomplete'],['date','incomplete'],['failed','failed'],['missing','incomplete'],['degraded','complete-zero']]) {
    const b=source();
    if(mode==='provisional')b.provisional=true;
    if(mode==='half'){b.coverage.complete=false;delete b.coverage.markets.tpex;}
    if(mode==='date')b.coverage.markets.tpex.asOf='2026-09-03';
    if(mode==='failed'){b.scanQuality.reliable=false;b.scanQuality.readyCount=0;b.inputEvidence[0]={...b.inputEvidence[0],outcome:'data-insufficient',sourceEvidence:{official:[{status:'failed'}],fallback:{status:'failed'}}};}
    if(mode==='missing')delete b.candidatePool;
    if(mode==='degraded')b.scanQuality.coverageRate=90;
    const db={};const p=mod.publishVerification(db,'overnight',b);
    assert.equal(db.verificationCaptures?.[p.captureId]?.status,want,mode);
    if(mode==='date')assert.equal(p.kind,'provisional','新版manifest日期矛盾不能搶formal');
  }
});
test('兩個真實builder把全上游失敗保留failed manifest，不以附加今日close冒充完整零訊號',()=>{
 const helper=pathToFileURL(SERVER_PATH.replace(/server\.mjs$/,'tests/helpers/test-server.mjs')).href;
 const fixtures=pathToFileURL(SERVER_PATH.replace(/server\.mjs$/,'tests/helpers/fixtures.mjs')).href;
 const script=`import {importServer} from ${JSON.stringify(helper)}; import {surveillanceRoutes,fundamentalsRoutes,stockDayAllRow,tpexDailyCloseRow} from ${JSON.stringify(fixtures)};import {rm} from 'node:fs/promises';
 const {mod,mock,dataDir}=await importServer({routes:[...surveillanceRoutes({reference:[stockDayAllRow({code:'2330'})],tpexReference:[tpexDailyCloseRow({code:'00679B'})]}),...fundamentalsRoutes({}),{match:u=>u.pathname.endsWith('/STOCK_DAY'),reply:{stat:'SERVICE_UNAVAILABLE'}},{match:u=>u.pathname.includes('/finance/chart/'),reply:{chart:{result:null,error:{code:'Unavailable'}}}}]});
 try { const overnight=await mod.buildOvernightSignals();const swing=await mod.buildSwingBoard();const db=await mod.loadDb();console.log(JSON.stringify([overnight,swing].map(b=>({kind:b.publication?.kind,manifest:db.verificationCaptures?.[b.publication?.captureId]})))); }
 finally {await mod.flushPersistence();mock.restore();await rm(dataDir,{recursive:true,force:true});}`;
 const results=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}).trim().split('\n').at(-1));
 for(const r of results){assert.equal(r.kind,'provisional');assert.equal(r.manifest.status,'failed');assert.equal(r.manifest.issued.length,0);assert.equal(r.manifest.candidates.length,1);}
});
test('缺採集只從完整格式起始日及給定實際交易日發現，保留發現時刻與後續缺口',()=>{
  const db={};const p=mod.publishVerification(db,'overnight',source());
  assert.equal(typeof mod.recordCaptureGaps,'function');
  mod.recordCaptureGaps(db,'overnight',['20260903','20260904','20260907'],'2026-09-08T02:00:00.000Z');
  mod.recordCaptureGaps(db,'overnight',['20260907'],'2026-09-09T02:00:00.000Z');
  const c=mod.summarizeCaptureCoverage(Object.values(db.verificationCaptures),['20260903','20260904','20260907']);
  assert.equal(c.fullRecordStartDate,'2026-09-04');assert.equal(c.expectedCount,2);assert.equal(c.completeCount,1);
  assert.equal(c.days.find(x=>x.tradeDate==='2026-09-07').status,'not-captured');
  assert.equal(c.days.find(x=>x.tradeDate==='2026-09-07').discoveredAt,'2026-09-08T02:00:00.000Z');
  assert.equal(c.days.find(x=>x.tradeDate==='2026-09-07').capturedAt,null);
  assert.equal(db.verificationCaptures[p.captureId].status,'complete-zero');
  assert.equal(mod.summarizeCaptureCoverage([],['20260903']).coverageRate,null);
  const attempts=[...Object.values(db.verificationCaptures),{strategy:'overnight',tradeDate:'2026-09-06',canonical:true,status:'incomplete',capturedAt:'2026-09-06T06:00:00Z'}];
  const weekend=mod.summarizeCaptureCoverage(attempts,['20260904','20260907']);
  assert.equal(weekend.expectedCount,2,'週末排程嘗試不能新增交易日分母');assert.equal(weekend.attempts.length,1);
});
test('manifest與清單一起回滾，重複排程同identity；磁碟保存完整池',async()=>{
  const body=source('2026-08-31'); const publish=()=>mod.commitDbMutation(db=>mod.publishVerification(db,'overnight',body));
  const [a,b]=await Promise.all([publish(),publish()]);assert.equal(a.captureId,b.captureId);
  const before=structuredClone(await mod.loadDb());
  const blocker=join(dataDir,'stock1-db.json.tmp');await mkdir(blocker);const old=console.error;const logs=[];console.error=(...args)=>logs.push(args);
  try {body.candidatePool[0].price=300;await assert.rejects(publish(),{code:'PERSISTENCE_FAILED'});assert.equal(logs.length,1);}
  finally {console.error=old;await rm(blocker,{recursive:true});}
  assert.deepEqual((await mod.loadDb()).verificationCaptures,before.verificationCaptures);
  const disk=JSON.parse(await readFile(join(dataDir,'stock1-db.json'),'utf8'));
  assert.ok(disk.verificationCaptures?.[a.captureId]);assert.deepEqual(disk.verificationCaptures,before.verificationCaptures);
  const cold=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)});console.log(JSON.stringify((await m.loadDb()).verificationCaptures));`],
    {encoding:'utf8',env:{...process.env,PORT:'0',STOCK1_SKIP_LISTEN:'1',DATA_DIR:dataDir}}).trim().split('\n').at(-1));
  assert.deepEqual(cold,disk.verificationCaptures,'冷啟動不回填、改序或遺失manifest');
});
test('真正builder在preselection保存原排序及來源，不取字碼排序或顯示清單；summary含採集與issued',async()=>{
  const dates=Array.from({length:100},(_,i)=>compactTradingDay(-i));
  // 星期六不能拼入假的當日K；兩市場收盤與历史末根都使用最後實際交易日。
  const removers=[...surveillanceRoutes({reference:[{...stockDayAllRow({code:'2301',volume:'1500000'}),Date:dates[0]},
    {...stockDayAllRow({code:'2330',volume:'9000000'}),Date:dates[0]}],tpexReference:[{...tpexDailyCloseRow({code:'00679B'}),Date:dates[0]}]}),...fundamentalsRoutes({}),
    {match:url=>url.pathname.endsWith('/STOCK_DAY'),reply:url=>({stat:'OK',data:dates.filter(day=>day.startsWith(url.searchParams.get('date').slice(0,6))).map(day=>[rocSlash(day),'1500000','150000000','99','101','98','100','1','1000'])})},
    {match:url=>url.hostname==='openapi.twse.com.tw' && url.pathname.endsWith('/FMTQIK'),reply:[{Date:dates[3]},{Date:dates[2]}]},
    {match:url=>url.pathname.includes('/holidaySchedule/'),reply:[{Date:compactToday().slice(0,4)+'0101',Name:'元旦',Description:'休市'}]}
  ].map(route=>mock.override(route));
  try {
    const b=await mod.buildOvernightSignals();const m=(await mod.loadDb()).verificationCaptures[b.publication.captureId];
    assert.equal(m.candidates.length,2);assert.deepEqual(m.candidates.map(x=>x.code),['2330','2301']);
    assert.deepEqual(m.candidates.map(x=>x.candidateRank),[1,2]);assert.equal(m.candidates[0].source,'TWSE OpenAPI');
    assert.equal(m.candidates[0].price,100);
    const swing=await mod.buildSwingBoard({scenarioKey:'midBandDefense',limit:1});
    const sm=(await mod.loadDb()).verificationCaptures[swing.publication.captureId];
    assert.deepEqual(sm.candidates.map(x=>x.code),['2330','2301']);
    assert.equal(sm.candidates.length,2);assert.equal(sm.status,'complete');assert.ok(swing.picks.length < sm.candidates.length);
    const historicalDate=dates[3].slice(0,4)+'-'+dates[3].slice(4,6)+'-'+dates[3].slice(6);
    await mod.commitDbMutation(db=>mod.publishVerification(db,'swing',{...source(historicalDate),formulaVersion:mod.SWING_FORMULA_VERSION,
      requestScope:{maxCandidates:240,scenarioKey:'',limit:40},candidatePool:[],inputEvidence:[],scanQuality:{candidateCount:0,completedCount:0,reliable:true},picks:[]}));
    const summary=await mod.buildSwingVerificationSummary();assert.ok(summary.captureCoverage);assert.ok(summary.population);
    const missing=summary.captureCoverage.days.find(day=>day.tradeDate.replaceAll('-','')===dates[2]);
    assert.equal(missing.status,'not-captured');assert.ok(missing.discoveredAt);assert.equal(missing.capturedAt,null);
    const persisted=JSON.parse(await readFile(join(dataDir,'stock1-db.json'),'utf8'));
    assert.equal(persisted.verificationCaptures[`not-captured:swing:${missing.tradeDate}`].discoveredAt,missing.discoveredAt);
    const history=await mod.buildVerificationHistory();assert.ok(history.captureCoverage);assert.ok(history.population);
  } finally {removers.forEach(remove=>remove());}
});
