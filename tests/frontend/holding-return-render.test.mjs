// 假設含息結果和價格觀察分開顯示，未知、零與負數不可互換。
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
let app;before(async()=>{app=await createAppWindow();});after(()=>app.cleanup());
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
