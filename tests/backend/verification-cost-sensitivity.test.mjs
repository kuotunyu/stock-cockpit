// 額外 bps 只扣一次；真成熟摘要維持模型、狀態與分盤邊界。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { importServer } from '../helpers/test-server.mjs';
import { compactTradingDay } from '../helpers/fixtures.mjs';
const { mod, mock, dataDir } = await importServer();
after(async () => {
  await mod.shutdownServer(); mock.restore();
  assert.equal(dirname(resolve(dataDir)), resolve(tmpdir())); assert.match(basename(dataDir), /^stock1-test-/);
  await rm(dataDir, { recursive: true, force: true });
});
test('1% 基準在 0／10／25／50 bps 得 1／0.9／0.75／0.5%，負值不改善', () => {
  assert.equal(typeof mod.applyCostScenario, 'function');
  for (const [extraCostBps, want] of [[0,1],[10,0.9],[25,0.75],[50,0.5]]) {
    assert.equal(mod.applyCostScenario({ baseReturnPct: 1, extraCostBps }), want);
    assert.ok(mod.applyCostScenario({ baseReturnPct: -1, extraCostBps }) <= -1);
  }
  assert.equal(mod.applyCostScenario({baseReturnPct:0,extraCostBps:25}), -0.25);
  for (const missing of [null, undefined, '', '1', false, NaN, Infinity]) {
    assert.equal(mod.applyCostScenario({baseReturnPct:missing,extraCostBps:25}),null);
    assert.equal(mod.applyCostScenario({baseReturnPct:1,extraCostBps:missing}),null);
  }
  assert.equal(mod.applyCostScenario({baseReturnPct:1,extraCostBps:-10}),null);
  assert.equal(mod.VERIFY_ROUND_TRIP_COST_PCT,0.471);
});
// 固定合成 session 配顯式 asOf，無執行日依賴。
const days = Array.from({length:16},(_,i)=>`202609${String(i+1).padStart(2,'0')}`);
const calendar = {tradingDays:days,coveredMonths:['202609'],through:days.at(-1)};
function fixture(identity = mod.currentVerificationIdentity('swing')) {
  const rows = ['good','missing','pending','periodic','noEntry'].map(signalId=>({signalId,captureId:'capture',tradeDate:days[0],scenario:signalId,code:'2330',status:signalId==='noEntry'?'noEntry':signalId==='pending'?'pending':'resolved'}));
  const entries = rows.map(row=>({...row,status:'win',resultPct:88,holdingPosition:{originalRiskMoney:5},holdingOutcome:{status:'complete',netPnl:0.2,holdingReturnPct:0.2},fillModel:row.signalId==='periodic'?'periodicCall20':'continuous'}));
  entries[1].holdingOutcome={status:'unpriced',netPnl:null,holdingReturnPct:null,missingReasons:['event-announcement-incomplete']};
  return {db:{swingVerification:{[days[0]]:entries}},population:{models:[{identity,rows}]}};
}
test('已扣基準的含息 0.2% 加 25 bps 反轉，缺值留分母，成熟/分盤/身份不混算', () => {
  const {db,population}=fixture(); const saved=JSON.stringify(db);
  const summary=asOf=>mod.summarizeMatureVerification(db,'swing',{asOf,calendar,population});
  const head=summary(days.at(-1)).headline;
  assert.ok(head.costRisk,'成本壓力必須接到正式成熟模型');
  const scenarios=head.costRisk.costSensitivity.scenarios;
  assert.equal(scenarios[0].returnPct.value,0.2);
  assert.ok(Math.abs(scenarios[2].returnPct.value-(-0.05))<1e-12);
  assert.equal(scenarios[2].returnPct.validCount,1);assert.equal(scenarios[2].returnPct.totalCount,3);
  assert.equal(scenarios[2].returnPct.reason,'partial-field-coverage');
  assert.equal(summary(days.at(-2)).headline.costRisk.costSensitivity.scenarios[0].returnPct.totalCount,0);
  assert.equal(head.scenarios.find(s=>s.scenario==='periodic').costRisk.netR.validCount,0);
  assert.equal(head.scenarios.find(s=>s.scenario==='periodic').withPeriodicCall.costRisk.netR.validCount,1);
  assert.equal(head.scenarios.find(s=>s.scenario==='good').byRegime.unknown.costRisk.netR.validCount,1);
  assert.equal(JSON.stringify(db),saved,'壓力投影不改原價、成本或成交證據');
  const old=fixture({...mod.currentVerificationIdentity('swing'),returnBasis:'adjusted-reference-price',costModelVersion:'legacy-unknown'});
  const legacy=mod.summarizeMatureVerification(old.db,'swing',{asOf:days.at(-1),calendar,population:old.population}).models[0];
  assert.equal(legacy.costRisk.costSensitivity.scenarios[0].returnPct.value,null);
  assert.equal(legacy.costRisk.netR.validCount,0);
  const next=fixture({...mod.currentVerificationIdentity('swing'),entryModel:'next-open-price-observation'});
  const nextModel=mod.summarizeMatureVerification(next.db,'swing',{asOf:days.at(-1),calendar,population:next.population}).models[0];
  assert.equal(nextModel.costRisk.netR.value,null);
  assert.equal(nextModel.costRisk.costSensitivity.scenarios[0].returnPct.value,null);
  const unknown=fixture({...mod.currentVerificationIdentity('swing'),evaluationVersion:'legacy-unknown'});
  const unknownModel=mod.summarizeMatureVerification(unknown.db,'swing',{asOf:days.at(-1),calendar,population:unknown.population}).models[0];
  assert.equal(unknownModel.costRisk.netR.value,null,'未知 evaluator 不因殘留 cash 字段升格完整');
});
test('正式隔日 manifest 接開收各自現金證據，缺開盤不借收盤，無計畫停損無 R', () => {
  const db={}; const compact=compactTradingDay(-3),next=compactTradingDay(-2);
  const date=`${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6)}`;
  const p=mod.publishVerification(db,'overnight',{asOf:date,formulaVersion:mod.OVERNIGHT_FORMULA_VERSION,
    requestScope:{maxCandidates:260,maxPerGroup:20},coverage:{complete:true,markets:{twse:{asOf:date},tpex:{asOf:date}}},
    scanQuality:{candidateCount:2,completedCount:2,reliable:true},
    candidatePool:['2330','2331'].map((code,i)=>({code,exchange:'TWSE',candidateRank:i+1,price:100,source:'official-close',sourceAsOf:date})),
    inputEvidence:['2330','2331'].map(code=>({code,exchange:'TWSE',outcome:'selected'})),
    groups:{strongContinuation:['2330','2331'].map(code=>({code,exchange:'TWSE',price:100,group:'strongContinuation'}))}});
  const snapshot=db.signalSnapshots.find(s=>s.captureId===p.captureId);
  const cash=(pick,exit)=>mod.calculateHoldingOutcome({initialPosition:pick.holdingPosition,exit:{date:next,price:exit},events:[],eventCoverage:'complete',costs:{model:'initial-notional-flat-total-v1',total:0.471}});
  snapshot.observed={complete:true,status:'final',identity:p.identity,formulaVersion:p.identity.selectionVersion,inputFingerprint:p.inputFingerprint,observationDate:next,warnings:[],
    rows:snapshot.picks.map((pick,i)=>({code:pick.code,verified:true,openReturn:99,currentReturn:99,
      holdingOutcomes:{open:i?null:cash(pick,101.471),close:cash(pick,100.471)}}))};
  const summary=()=>mod.summarizeMatureVerification(db,'overnight',{asOf:compactTradingDay(0)}).headline;
  const head=summary();
  const open=head.costRisk.open.costSensitivity.scenarios[2].returnPct;
  assert.ok(Math.abs(open.value-0.75)<1e-10); assert.equal(open.validCount,1); assert.equal(open.totalCount,2);
  assert.equal(head.costRisk.close.costSensitivity.scenarios[2].returnPct.value,-0.25);
  assert.equal(head.costRisk.close.costSensitivity.scenarios[2].returnPct.validCount,2);
  assert.equal(head.costRisk.open.netR.value,null);assert.equal(head.costRisk.open.netR.validCount,0);
  assert.equal(head.costRisk.open.netR.missingReasons['initial-risk-cash-missing-or-invalid'],1);
  assert.equal(head.byRegime.unknown.costRisk.open.costSensitivity.scenarios[0].returnPct.validCount,1);
  snapshot.observed.status='partial';snapshot.observed.complete=false;
  assert.equal(summary().costRisk.close.costSensitivity.scenarios[0].returnPct.validCount,0);
});
