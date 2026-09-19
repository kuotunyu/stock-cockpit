// 持股估值只描述最近報價相對昨收，缺值與行情日期須明示。
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
let app;
before(async()=>{app=await createAppWindow();});
after(()=>app.cleanup());
const row={code:'2330',quoteDate:'2026-09-18',price:2460,previousClose:2425,shares:60};
const summarize=rows=>JSON.parse(app.evalIn(`JSON.stringify(summarizeHoldingQuoteBasis(${JSON.stringify(rows)}))`));
test('部分估算包含缺現價，缺值不能補零',()=>{
  const out=summarize([row,{code:'0050',shares:100,price:null,previousClose:null,quoteDate:null}]);
  assert.equal(out.value,2100);assert.equal(out.validCount,1);assert.equal(out.totalCount,2);assert.equal(out.missingPrice,1);
  assert.equal(summarize([{...row,price:null}]).value,null);
  assert.equal(summarize([{...row,previousClose:null}]).missingPreviousClose,1);
  assert.equal(summarize([{...row,price:2425}]).value,0);
  assert.equal(summarize([]).value,null);
});
test('各檔行情日期一致才可標單一日',()=>{
  assert.equal(summarize([row]).dateLabel,'行情 09/18');
  const mixed=summarize([row,{...row,code:'0050',quoteDate:'2026-09-17'}]);
  assert.equal(mixed.mixedDates,true);assert.equal(mixed.dateLabel,'日期不一致');
  assert.match(summarize([{...row,quoteDate:null}]).dateLabel,/日期未知/);
});
test('週六 footer 將行情日與取得時間分開',()=>{
  app.evalIn(`getTaiwanClockParts=()=>({isoDate:'2026-09-19',weekday:6,minutes:1395});
    marketSessionState.stock={date:'2026-09-19',tradingDay:false};
    stocks.length=0;stocks.push({code:'2330',asOf:'2026-09-18',price:2460});
    dataState.mode='official';dataState.lastUpdated='09/19 23:15:03';dataState.failedSince=null;dataState.error='';
    renderDataStatus();`);
  const text=app.doc.querySelector('#refreshStatus').textContent;
  assert.match(text,/今日休市.*行情 09\/18.*取得 09\/19 23:15:03/);
});
