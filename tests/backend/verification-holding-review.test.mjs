import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { importServer } from '../helpers/test-server.mjs';
import { compactTradingDay } from '../helpers/fixtures.mjs';
const { mod, mock, dataDir } = await importServer();
after(async () => {
  await mod.shutdownServer({ reason: 'holding-review-test' }); mock.restore();
  assert.equal(dirname(resolve(dataDir)), resolve(tmpdir())); assert.match(basename(dataDir), /^stock1-test-/);
  await rm(dataDir, { recursive: true, force: true });
});
const D0 = compactTradingDay(-2), D1 = compactTradingDay(-1), month = D1.slice(0,6);
const fields = ['資料日期','股票代號','股票名稱','除權息前收盤價','除權息參考價','權值+息值','權/息','漲停價格','跌停價格','開盤競價基準','減除股利參考價','詳細資料','最近一次申報資料 季別/日期','最近一次申報每股 (單位)淨值','最近一次申報每股 (單位)盈餘'];
const row = [D1,'2882','測試','100','95','5','息','104.5','85.5','95','95',`2882,${D1}`,'','',''];
// 官方會把請求的6/31正規化回6/30；fixture使用實際月末。
const payload = data => ({stat:'OK',strDate:month+'01',endDate:mod.addDaysCompact(mod.addMonthsCompact(month+'01',1),-1),fields:[...fields],data});
const history = await mod.loadFundamentalsHistory();
const replay = (code='9999', extra={}) => {
  const entry = {code,exchange:'TWSE',status:'pending',entry:100,stop:90,target:104,lastChecked:D0,daysHeld:0,
    identity:mod.currentVerificationIdentity('swing'),holdingPosition:{date:D0,price:100,shares:1}};
  mod.replaySwingVerificationHistory(entry,[{rawDate:D0,close:100,source:'TWSE STOCK_DAY'},
    {rawDate:D1,open:100,high:105,low:99,close:104,exchangePreviousClose:100,source:'TWSE STOCK_DAY'}],D1,
    {tradingDays:[D0,D1],holidayRows:[],...extra});
  return entry;
};
test('I1 TWSE 缺表、畸形、半包及弱舊月章不得在真 replay 產生完整 cash；完整空表與事件表可用', async () => {
  for (const p of [{stat:'OK'},payload([row.slice(0,7)]),{...payload([]),strDate:'19000101'},
    {...payload([row]),total:2},payload([row,row]),{...payload([]),fields:[]},payload([[...row.slice(0,3),'',...row.slice(4)]]),
    {...payload([]),partial:true},{...payload([]),hasMore:true},{...payload([]),nextPage:2},payload([[...row].fill('')]),
    {...payload([]),total:null},{...payload([]),totalCount:''},{...payload([]),page:2,totalPages:3}]) {
    delete history.corporateActionResultMonths?.[month];
    const restore=mock.override({match:/exRight\/TWT49U/,reply:p});
    await mod.loadCorporateActionResultMonth(month); restore();
    const e=replay(); assert.equal(e.status,'win');assert.equal(e.resultPct,4);
    assert.equal(e.holdingOutcome.netPnl,null,JSON.stringify(p));
  }
  for (const rows of [[],[row]]) {
    delete history.corporateActionResultMonths?.[month];
    const restore=mock.override({match:/exRight\/TWT49U/,reply:payload(rows)});
    await mod.loadCorporateActionResultMonth(month);restore();
    assert.equal(replay().holdingOutcome.netPnl,3.529);
  }
  const complete=structuredClone(history.corporateActionResultMonths[month].monetaryCoverage);
  assert.equal(replay('9999',{actionResults:new Map(),actionHoldingCoverage:new Map([[month,complete]])}).holdingOutcome.netPnl,3.529);
  assert.equal(replay('9999',{actionResults:new Map(),actionHoldingCoverage:new Map()}).holdingOutcome.netPnl,null,'歷史批次不能借全域完整章');
  history.corporateActionResultMonths[month].monetaryCoverage.coveredThrough=D0;
  assert.equal(replay().holdingOutcome.netPnl,null,'當月完整表不得擴稱覆蓋尚未查得日期');
  history.corporateActionResultMonths[month]={status:'ok',sealed:true,rows:0};
  assert.equal(replay().holdingOutcome.netPnl,null);
  assert.equal(replay('9999',{actionResults:new Map()}).holdingOutcome.netPnl,null);
});
test('I2 不完整公告保留 input evidence 但不能估值；完整公告配對 GREEN',async()=>{
  delete history.corporateActionResultMonths[month];
  const restore=mock.override({match:/exRight\/TWT49U/,reply:payload([row])});await mod.loadCorporateActionResultMonth(month);restore();
  history.dividends ||= {};history.dividends['2882'] ||= {};
  for (const formulaComplete of [false,true]) {
    history.dividends['2882'][D1]={kind:'除息',cashDividend:5,stockRatio:0,subscriptionRatio:0,source:'TWSE',formulaComplete};
    const e=replay('2882');assert.equal(e.status,'win');
    assert.equal(e.holdingOutcome.evidence.inputEvents[0].formulaComplete,formulaComplete);
    // 目標調成98.8，開100已越過目標，按開盤100退出：100+5-100-0.471。
    assert.equal(e.holdingOutcome.netPnl,formulaComplete ? 4.529 : null);
  }
  await mod.appendDividendHistory(new Map([['2882',[
    {exDate:D1,kind:'除權',stockRatio:0.1,source:'TWSE',duplicateRows:true},
    {exDate:D1,kind:'除息',cashDividend:5,source:'TWSE',duplicateRows:true},
  ]]]));
  assert.equal(history.dividends['2882'][D1].formulaComplete,false);
  const duplicated=replay('2882');assert.equal(duplicated.status,'win');assert.equal(duplicated.holdingOutcome.netPnl,null);
  assert.ok(duplicated.holdingOutcome.missingReasons.includes('event-announcement-incomplete'));
});
test('I1/I2 隔日沖真 observe 共用严格 TWSE 覆蓋與公告完整性，價格結果照常保存',async()=>{
  const pick={code:'2882',exchange:'TWSE',price:100,holdingPosition:{date:D0,price:100,shares:1}};
  for (const [p,formulaComplete,expected] of [[{stat:'OK'},true,null],[payload([row]),false,null],[payload([row]),true,9.029]]) {
    delete history.corporateActionResultMonths[month];
    const restore=mock.override({match:/exRight\/TWT49U/,reply:p});await mod.loadCorporateActionResultMonth(month);restore();
    history.dividends['2882'][D1]={kind:'除息',cashDividend:5,stockRatio:0,subscriptionRatio:0,source:'TWSE',formulaComplete};
    const result=await mod.observeSignalSnapshot({asOf:D0,identity:mod.currentVerificationIdentity('overnight'),picks:[pick]},
      {reference:{byCode:new Map([['2882',{...pick,source:"TWSE OpenAPI",sourceKind:"daily-close",rawDate:D1,open:100,high:105,low:99,price:104.5}]]),warnings:[]},calendar:{tradingDays:[D0,D1],holidayRows:[],warnings:[]}});
    assert.equal(result.rows[0].verified,true);assert.equal(result.rows[0].currentReturn,10);
    assert.equal(result.rows[0].holdingOutcomes.close.netPnl,expected);
  }
});
test('I3 新 cash entries 的原價格尾部依保存 price identity 計算且不宣稱 cash PF',async()=>{
  const db=await mod.loadDb(); const identity=mod.currentVerificationIdentity('swing');
  const priceIdentity={...identity,evaluationVersion:'swing-price-observation-v1',returnBasis:'adjusted-reference-price',costModelVersion:'flat-round-trip-0.471pct-v1'};
  db.swingVerification={[D0]:[5,-3].map((resultPct,i)=>({code:`990${i}`,scenario:'midBandDefense',formulaVersion:mod.SWING_FORMULA_VERSION,
    identity,priceObservationIdentity:priceIdentity,status:i?'loss':'win',resultPct,resultPctNextOpen:resultPct,daysHeld:1,resolvedAt:D1,
    holdingOutcome:{status:'complete',netPnl:99,holdingReturnPct:99}}))};
  mod.invalidateSwingVerifySummaryCache();const summary=await mod.buildSwingVerificationSummary();const s=summary.scenarios[0];
  assert.equal(s.avgResultPctNet,0.53);assert.equal(s.profitFactorNet,1.31);assert.equal(s.medianResultPctNet,0.53);
  assert.equal(s.nextOpenEntry.wins,1);assert.equal(s.netUnavailableReason,null);assert.equal(s.maxConsecutiveLossDays,0);
  assert.equal(s.priceObservationIdentity.returnBasis,'adjusted-reference-price');
  assert.equal(s.metricCoverage.avgResultPct.validCount,2);
  assert.equal(summary.cohort.headline.profitFactorNet,null);
});
