// 假設含息結果和價格觀察分開顯示，未知、零與負數不可互換。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
let app;before(async()=>{app=await createAppWindow();});after(()=>app.cleanup());
test('候選池固定期間差以百分點顯示，配對訊號/池coverage分開、缺值與惡意原因不造0',()=>{
  const model={modelKey:'fixed-price',horizon:'next-open-to-session-15-close',benchmarkSpec:{version:'frozen-pool-fixed-price-v1'},pairedCount:2,eligibleCount:3,pairedDays:1,eligibleDays:1,strategyMean:3,benchmarkMean:2,meanDifference:1};
  const data={cohort:{models:[]},benchmarks:{window:{asOf:'2026-09-07',limit:260,includedCaptures:1,availableCaptures:1,fromDate:'2026-08-03',throughDate:'2026-08-03'},models:[model],cohorts:[{...model,captureId:'one',tradeDate:'20260803',status:'pending',cursor:4,poolCoverage:{TWSE:{eligibleCount:5,validCount:4,status:'unavailable',missingReasons:['<img src=x>']}},missingReasons:{'pool-incomplete':1}}]}};
  const html=app.evalIn(`renderVerificationMeasurement(${JSON.stringify(data)},'swing')`);
  assert.match(html,/相對候選池的同期間報酬差/);assert.match(html,/1\.00 個百分點/);assert.match(html,/配對訊號 2\/3/);assert.match(html,/4\/5 檔/);assert.match(html,/第 15/);
  assert.match(html,/含入選股/);assert.match(html,/不是帳戶/);assert.doesNotMatch(html,/<img src=x>/);assert.match(html,/&lt;img/);
  assert.match(html,/跨模型最多 260/);assert.match(html,/日期 2026-08-03 → 2026-08-03/);
  model.meanDifference=null;const missing=app.evalIn(`renderVerificationBenchmarks(${JSON.stringify({models:[model],cohorts:[]})},'swing')`);
  assert.match(missing,/未定義/);assert.doesNotMatch(missing,/0\.00 個百分點/);
});
test('含息文案保留零/負值；缺金額不用百分比或0冒充',()=>{
  assert.match(app.evalIn(`holdingOutcomeText({netPnl:0,holdingReturnPct:0})`),/模型損益 0/);
  assert.match(app.evalIn(`holdingOutcomeText({netPnl:-5,holdingReturnPct:-5})`),/-5/);
  assert.match(app.evalIn(`holdingOutcomeText({netPnl:null,holdingReturnPct:null})`),/未知/);
  assert.match(app.evalIn(`holdingOutcomeText({netPnl:29,holdingReturnPct:null})`),/報酬率未定義.*29/);
});
test('模型展開區明示固定1股、獨立cash分母、公告應收和成本範圍',()=>{
  const identity={returnBasis:'cash-holding-return',entryModel:'signal-close-observation'};
  const coverage={totalCount:3,validCount:2,returnValidCount:1,missingCount:1,unsupportedCount:1};
  const data={cohort:{headline:{identity},models:[{identity,holdingCoverage:coverage,metricCoverage:{avgResultPctNet:{value:9.029,validCount:20,totalCount:20}}}]}};
  const html=app.evalIn(`renderVerificationMeasurement(${JSON.stringify(data)},'swing')`);
  assert.match(html,/假設 1 股/);assert.match(html,/公告股利/);assert.match(html,/補充保費/);assert.match(html,/損益有效 2\/3.*報酬率有效 1\/3/);
  assert.match(html,/含息持有平均淨報酬/);
});
test('隔日個股價格與含息結果並列，股名維持跳脫',()=>{
  app.evalIn(`verifyState.data={available:true,summary:{},rows:[{code:'2330',name:'<img src=x>',currentReturn:10,highReturn:10,holdingOutcomes:{close:{netPnl:9.029,holdingReturnPct:9.029}}}]};`);
  const html=app.evalIn('renderSignalVerification()');assert.match(html,/價格/);assert.match(html,/含息持有/);assert.doesNotMatch(html,/<img src=x>/);
});
test('成本明細並列基準/壓力的百分點、R 倍數與獨立有效分母，原因跳脫',()=>{
  const metric={value:0.75,validCount:1,totalCount:3,missingCount:2,reason:'partial-field-coverage',missingReasons:{'<img src=x>':2}};
  const costRisk={costSensitivity:{scenarioVersion:'additional-return-bps-v1',scenarios:[{extraCostBps:0,returnPct:{...metric,value:1}},{extraCostBps:25,returnPct:metric}]},netR:{...metric,value:1.9}};
  const identity={returnBasis:'cash-holding-return',entryModel:'signal-close-observation'};
  const data={cohort:{headline:{identity},models:[{identity,costRisk}]}};
  const html=app.evalIn(`renderVerificationMeasurement(${JSON.stringify(data)},'swing')`);
  assert.match(html,/基準.*1\.00%/);assert.match(html,/額外 25 bps.*0\.75%/);
  assert.match(html,/事後 netR.*1\.90R/);assert.doesNotMatch(html,/190\.00%|1\.90%/);
  assert.match(html,/有效 1\/3/);assert.match(html,/假設壓力/);assert.match(html,/原始進場價/);
  assert.doesNotMatch(html,/<img src=x>/);assert.match(html,/&lt;img/);
  costRisk.netR={...metric,value:null,validCount:0};
  const missing=app.evalIn(`renderVerificationMeasurement(${JSON.stringify({cohort:{headline:{identity},models:[{identity,costRisk:{open:costRisk,close:costRisk}}]}})},'overnight')`);
  assert.match(missing,/開盤/);assert.match(missing,/收盤/);assert.match(missing,/未定義/);assert.doesNotMatch(missing,/0\.00R/);
});
test('行情重繪保留成本明細展開/手動收合與焦點；不同模型不借用舊展開狀態',()=>{
  app.evalIn(`
    state.screen='overnight';state.overnightView='performance';overnightState.error=null;
    backtestState.loaded=true;verifyHistoryState.loaded=true;
    verifyHistoryState.data={records:[{status:'final',date:'fixture',verified:1}],cohort:{models:[{modelKey:'cash-model-a',identity:{entryModel:'signal-close-observation'},costRisk:{},byRegime:{}}]}};
    renderLiveDataUpdate();
    document.querySelector('.verification-denominators').open=true;
    document.querySelector('.verification-denominators details').open=true;
    document.querySelector('.verification-denominators details > summary').focus();
    renderLiveDataUpdate();
  `);
  assert.equal(app.evalIn(`document.querySelector('.verification-denominators').open`),true);
  assert.equal(app.evalIn(`document.querySelector('.verification-denominators details').open`),true);
  assert.equal(app.evalIn(`document.activeElement===document.querySelector('.verification-denominators details > summary')`),true);
  app.evalIn(`document.querySelector('.verification-denominators details').open=false;renderLiveDataUpdate();`);
  assert.equal(app.evalIn(`document.querySelector('.verification-denominators details').open`),false);
  app.evalIn(`document.querySelector('.verification-denominators details').open=true;verifyHistoryState.data.cohort.models[0].modelKey='cash-model-b';renderLiveDataUpdate();`);
  assert.equal(app.evalIn(`document.querySelector('.verification-denominators details').open`),false);
  app.evalIn(`document.querySelector('.verification-denominators').open=false;renderLiveDataUpdate();`);
  assert.equal(app.evalIn(`document.querySelector('.verification-denominators').open`),false);
});
