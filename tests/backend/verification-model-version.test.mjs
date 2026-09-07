// 版本軸與穩定指紋、純遷移、觀察 memo 不得混用不同成本或輸入修訂。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { compactTradingDay, rocCompact, fundamentalsRoutes, stockDayAllRow } from '../helpers/fixtures.mjs';
import { importServer } from '../helpers/test-server.mjs';
const {mod,mock,dataDir} = await importServer();
after(async()=>{await mod.flushPersistence();mock.restore(); await rm(dataDir,{recursive:true,force:true});});
test('canonical identity/key 的物件鍵順序無關；每個版本軸改動皆隔離',()=>{
 const input={formulaVersion:'test',evaluationVersion:'e1',costModelVersion:'c1',cohortPolicyVersion:'p1',entryModel:'signal-close-observation',returnBasis:'adjusted-reference-price',snapshotSchemaVersion:2};
 const id=mod.verificationIdentity(input);
 assert.equal(id.selectionVersion,'test');
 assert.equal(mod.verificationModelKey(id),mod.verificationModelKey(Object.fromEntries(Object.entries(id).reverse())));
 for(const field of Object.keys(id)) assert.notEqual(mod.verificationModelKey(id),mod.verificationModelKey({...id,[field]:'changed'}));
 assert.equal(mod.verificationIdentity({formulaVersion:'old'}).evaluationVersion,'legacy-unknown');
});
test('migration 不改原輸入、冪等，只補可證明版本，原 entry/時間不猜',()=>{
 const db={signalSnapshots:[{asOf:'2026-01-02',formulaVersion:'old',picks:[]}],swingVerification:{20260102:[{entry:95,corporateActions:[{factor:0.95}]}]}};
 const before=structuredClone(db); const migrated=mod.migrateVerificationMetadata(db);
 assert.deepEqual(db,before); assert.deepEqual(mod.migrateVerificationMetadata(migrated),migrated);
 assert.equal(migrated.signalSnapshots[0].identity.selectionVersion,'old');
 assert.equal(migrated.swingVerification['20260102'][0].identity.selectionVersion,'legacy-unknown');
 assert.equal(migrated.swingVerification['20260102'][0].originalEntry,undefined);
 assert.equal(migrated.signalSnapshots[0].publishedAt,undefined);
});
test('memo 同模型與輸入 revision 才可復用，legacy final 證據仍保留',()=>{
 const identity=mod.verificationIdentity({formulaVersion:'test',evaluationVersion:'e1',costModelVersion:'c1'});
 const snapshot={formulaVersion:'test',identity,inputFingerprint:'a',observed:{formulaVersion:'test',identity,inputFingerprint:'a',status:'final',complete:true,rows:[]}};
 assert.ok(mod.storedObservationFor(snapshot));
 assert.equal(mod.storedObservationFor({...snapshot,identity:{...identity,costModelVersion:'c2'}}),null);
 assert.equal(mod.storedObservationFor({...snapshot,inputFingerprint:'b'}),null);
 const legacy={formulaVersion:'old',observed:{formulaVersion:'old',status:'final',complete:true,rows:[]}};
 assert.ok(mod.storedObservationFor(legacy));
});
test('波段摘要按完整模型分組；不同成本不能混headline，輸入改變使快取失效',async()=>{
 const db=await mod.loadDb(); const day=mod.toTaipeiCompactDate();
 const identity=mod.currentVerificationIdentity('swing');
 const entry={formulaVersion:mod.SWING_FORMULA_VERSION,identity,scenario:'midBandDefense',code:'2330',status:'win',resultPct:10,daysHeld:1,resolvedAt:day};
 db.swingVerification={[day]:[entry,{...entry,code:'1101',resultPct:-50,identity:{...identity,costModelVersion:'other-cost'}}]};
 const first=await mod.buildSwingVerificationSummary();
 assert.equal(first.modelGroups.length,2); assert.equal(first.scenarios[0].samples,1);
 assert.equal(first.allVersions.winRate,null); assert.equal(first.allVersions.reason,'mixed-models');
 db.swingVerification[day].push({...entry,code:'2454'});
 const second=await mod.buildSwingVerificationSummary();
 assert.notEqual(first,second); assert.equal(second.scenarios[0].samples,2);
});
test('legacy 未知成本只保留毛結果，不能套今日成本補出淨值或次日淨勝負',async()=>{
 const db=await mod.loadDb(); const day=mod.toTaipeiCompactDate();
 db.swingVerification={[day]:[{code:'2330',formulaVersion:mod.SWING_FORMULA_VERSION,scenario:'midBandDefense',status:'win',resultPct:10,resultPctNextOpen:8,daysHeld:1,resolvedAt:day}]};
 const {scenarios:[s]}=await mod.buildSwingVerificationSummary();
 assert.equal(s.avgResultPct,10); assert.equal(s.avgResultPctNet,null);
 assert.equal(s.profitFactorNet,null); assert.equal(s.medianResultPctNet,null);
 assert.equal(s.maxConsecutiveLossDays,null); assert.equal(s.nextOpenEntry.wins,null);
 assert.equal(s.netUnavailableReason,'legacy-unknown-cost-model');
});

test('I2：相同selection但不支援evaluation/entry/return的現代pending不被current evaluator推進',async t=>{
 const today=compactTradingDay(0), yesterday=compactTradingDay(-1);
 // 此正向控制提供官方「收盤」OHLC；同交易日須已收盤才能證明本月覆蓋。
 // 保留 sweep 的交易日期（包括跨年），不讓盤中時間與收盤 fixture 自相矛盾。
 t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}T14:00:00+08:00`)});
 const removers=[...fundamentalsRoutes({}),
   {match:/exchangeReport\/FMTQIK/,reply:[{Date:rocCompact(yesterday)},{Date:rocCompact(today)}]},
   {match:/rwd\/zh\/afterTrading\/FMTQIK/,reply:url=>({stat:'OK',data:[yesterday,today]
     .filter(day=>day.slice(0,6)===url.searchParams.get('date')?.slice(0,6))
     .map(day=>[`${Number(day.slice(0,4))-1911}/${day.slice(4,6)}/${day.slice(6,8)}`])})},
   {match:/holidaySchedule/,reply:[]}].map(route=>mock.override(route));
 try {
  const db=await mod.loadDb();const identity=mod.currentVerificationIdentity('swing');
  const base={code:'2330',exchange:'TWSE',formulaVersion:mod.SWING_FORMULA_VERSION,scenario:'midBandDefense',entry:100,stop:95,target:110,status:'pending',lastChecked:yesterday,daysHeld:0,resultPct:null};
  const variants=[{evaluationVersion:'disabled-evaluator',entryModel:'legacy-unknown'},{entryModel:'next-open-simulation'},{returnBasis:'cash-holding-return',evaluationVersion:'legacy-unknown'}];
  const entries=variants.map(over=>({...base,identity:{...identity,...over}}));
  db.swingVerification={[yesterday]:[...structuredClone(entries),{...base}]}; db.swingVerificationRetry={};
  await mod.saveDb(db);mod.resetSwingAdvanceKeyForTest();
  const quote=mod.normalizeDailyTwse({...stockDayAllRow({code:'2330',close:111}),Date:rocCompact(today),OpeningPrice:'100',HighestPrice:'112',LowestPrice:'99'});
  await mod.advanceSwingVerification({coverageComplete:true,byCode:new Map([['2330',quote]])},today,{riskSets:null});
  const actual=db.swingVerification[yesterday];
  for(let i=0;i<3;i++) {
   const {evaluationUnavailable,...evidence}=actual[i];
   assert.deepEqual(evidence,entries[i]);
   assert.equal(evaluationUnavailable.reason,'unsupported-verification-model');
  }
  assert.equal(actual[3].status,'win','legacy補驗例外仍能用目前觀察算式');
  assert.equal(actual[3].evaluationApplied.kind,'retrospective-legacy-evidence');
  if(yesterday.slice(0,6)!==today.slice(0,6)) {
   const evidence=actual[3].evaluationApplied.calendarEvidence;
   assert.deepEqual(evidence.coveredMonths,[yesterday.slice(0,6),today.slice(0,6)]);
   assert.equal(evidence.monthEvidence[today.slice(0,6)].coveredThrough,today);
  }
  const summary=await mod.buildSwingVerificationSummary();
  assert.equal(summary.unavailableCount,3);
  db.swingVerification={[yesterday]:structuredClone(entries)};
  db.swingVerificationRetry={recentCursor:'preserve',historicalCursor:'preserve'};
  await mod.saveDb(db);
  const callsBefore=mock.calls.length;
  await mod.advanceSwingVerification({coverageComplete:true,byCode:new Map()},today,{riskSets:null});
  assert.equal(mock.calls.length,callsBefore,'全數不支援不消耗行情來源');
  assert.deepEqual(db.swingVerificationRetry,{recentCursor:'preserve',historicalCursor:'preserve'});
  const first=structuredClone(db.swingVerification);
  await mod.advanceSwingVerification({coverageComplete:true,byCode:new Map()},today,{riskSets:null});
  assert.deepEqual(db.swingVerification,first,'重試不改來源證據或新增時間戳');
 } finally {removers.forEach(remove=>remove());t.mock.timers.reset();}
});
