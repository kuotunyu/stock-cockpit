// 成交檢討 UI：三欄對照、未進場、失效與跨帳號清除。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
const plan={planId:'p1',code:'2330',exchange:'TWSE',strategy:'swing',status:'closed',entryPrice:100,stopPrice:97,quantity:1000,initial:{intent:{entryPrice:100,stopPrice:95,quantity:1000,reason:'初始'}},revisions:[],tradeLinks:[],review:{decision:'no-entry',reason:'PRIVATE_REVIEW',reviewedAt:new Date().toISOString()},metadataRevisions:[]};
test('final economic intent stays disabled while review is editable and comparison discloses unknown return',async()=>{
 const app=await createAppWindow();try{
  app.evalIn(`tradePlansState.editor=${JSON.stringify(plan)};tradePlansState.base=tradePlansState.editor;renderTradePlanEditor()`);
  assert.equal(app.doc.querySelector('[name=stopPrice]').disabled,true);
  assert.equal(app.doc.querySelector('[name=reviewReason]')?.disabled,false);
  assert.equal(app.doc.querySelector('#tradePlanForm [type=submit]').disabled,false);
  const text=app.doc.querySelector('#tradePlanEvidence').textContent;assert.match(text,/原始計畫/);assert.match(text,/目前計畫/);assert.match(text,/實際成交/);assert.match(text,/完整計畫報酬.*未知/);
  assert.equal(app.evalIn("formatTradePlanTime('20260908')"),'2026/09/08（台北日期）');
  assert.ok(app.evalIn("findGlossaryIndex('達標與淨獲利')")>=0);
  app.evalIn("activateAuthenticatedUser({id:'different-account'})");
  assert.doesNotMatch(app.doc.querySelector('#tradePlanModal').textContent,/PRIVATE_REVIEW/);
  assert.equal(app.doc.querySelector('[name=reviewReason]').value,'');
  app.evalIn(`tradePlansState.editor=${JSON.stringify(plan)};renderTradePlanEditor();document.getElementById('tradePlanModal').hidden=true;document.getElementById('tradePlanLinkDraft').textContent='PRIVATE_LINK';document.querySelector('[name=linkTradeId]').innerHTML='<option>PRIVATE_SOURCE</option>';handleAuthRequired({status:401})`);
  assert.doesNotMatch(app.doc.body.textContent,/PRIVATE_REVIEW|PRIVATE_LINK|PRIVATE_SOURCE/);assert.equal(app.doc.querySelector('[name=reviewReason]').value,'');
 }finally{await app.settle();app.cleanup();}
});
test('review delta replay retains another tab links and economic history',async()=>{
 let bodies=[];const latest={...plan,stopPrice:102,tradeLinks:[{tradeId:'new',allocatedShares:4}],metadataRevisions:[{revision:1}]};
 const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':(_url,init)=>{
  if(init?.method==='PUT'){bodies.push(JSON.parse(init.body));return bodies.length===1?{ok:false,__status:409,code:'REV_CONFLICT'}:{ok:true,rev:3,plans:bodies.at(-1).plans};}return {ok:true,rev:2,plans:[latest]};
 }}});try{
  app.evalIn(`tradePlansState.plans=[${JSON.stringify(plan)}];tradePlansState.editor=tradePlansState.plans[0];tradePlansState.base=tradePlansState.editor;tradePlansState.loaded=true;renderTradePlanEditor()`);
  const reason=app.doc.querySelector('[name=reviewReason]');assert.ok(reason);reason.value='新檢討';reason.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  await app.evalIn('submitTradePlan({preventDefault(){}})');
  assert.equal(bodies.length,2);assert.equal(bodies[1].plans[0].stopPrice,102);assert.deepEqual(bodies[1].plans[0].tradeLinks,latest.tradeLinks);assert.equal(bodies[1].plans[0].review.reason,'新檢討');
 }finally{await app.settle();app.cleanup();}
});
test('trade updates refresh plan evidence; source text is escaped',async()=>{
 const app=await createAppWindow();try{
  app.evalIn(`tradePlansState.editor=${JSON.stringify(plan)};tradePlansState.linkEvidence={p1:{links:[{tradeId:'<img src=x onerror=alert(1)>',allocatedShares:2,status:'source-deleted',snapshot:{side:'buy',price:100,date:'20260901',fee:0,tax:0,feeSource:'manual',taxSource:'manual',timePrecision:'date-only'}}],buyShares:0,sellShares:0,buyCash:0,sellCash:0,cashDifference:null,originalRiskCash:null,reasons:['invalidated-links']}};renderTradePlanEditor()`);
  assert.match(app.doc.querySelector('#tradePlanEvidence').textContent,/來源成交已刪除/);assert.equal(app.doc.querySelector('#tradePlanEvidence img'),null);
 }finally{await app.settle();app.cleanup();}
});
test('quote tables expose cells and sorted headers; OHLC reads exact displayed window',async()=>{
 const app=await createAppWindow();try{
  app.evalIn("state.screen='screener';state.sort='price';state.sortDir='desc';renderActiveScreen()");
  const table=app.doc.querySelector('[data-screen-panel=screener] [role=table]');assert.ok(table);
  assert.equal(table.querySelector('[aria-sort=descending] button').dataset.sort,'price');
  app.evalIn("renderRows(el.screenerRows,[{code:'2330',name:'台積電',price:100,change:1,spark:[],strategies:[]}],'screener')");
  assert.ok(table.querySelector('[role=row] [role=cell] button'));
  app.evalIn(`renderChartOhlc(el.technicalChart,{code:'2330',period:'week'},[{date:'20260901',open:100,high:108,low:99,close:106}])`);
  const o=app.doc.querySelector('#technicalOhlc');assert.match(o.textContent,/週/);assert.match(o.textContent,/2026\/09\/01/);assert.equal(o.querySelectorAll('tbody tr').length,1);assert.match(o.textContent,/108/);
  app.evalIn('renderChartOhlc(el.technicalChart,null,[])');assert.equal(o.querySelectorAll('tbody tr').length,0);
 }finally{await app.settle();app.cleanup();}
});
test('repeated plan save notices coalesce without discarding unrelated notifications',async()=>{
 const app=await createAppWindow();try{
  const baseline=app.doc.querySelectorAll('#toastStack .toast').length;
  app.evalIn("showToast('第一筆計畫已保存',undefined,'trade-plan-saved');showToast('獨立到價通知');showToast('最新計畫已保存',undefined,'trade-plan-saved')");
  assert.equal(app.doc.querySelectorAll('#toastStack .toast').length,baseline+2);assert.match(app.doc.querySelector('#toastStack').textContent,/獨立到價通知/);assert.doesNotMatch(app.doc.querySelector('#toastStack').textContent,/第一筆/);
 }finally{await app.settle();app.cleanup();}
});
