// 從真正清單／驗證按鈕進詳情，再建立計畫；跨群同股不能丟失原顯示身份。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';

for (const view of ['overview','strongContinuation','pullbackReversal','focus']) {
 test(`隔日 ${view} 實際點擊保留分組、市場及發布身份`,async()=>{
  const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':{ok:true,rev:0,plans:[]}}});
  try {
   app.evalIn(`window.pick={code:'2330',name:'測試',exchange:'TWSE',price:100,changePct:4,reasons:[],riskTags:[]};
    overnightState.loaded=true; overnightState.error=''; overnightState.asOf='2026-09-07';
    overnightState.groups={strongContinuation:[{...window.pick,group:'strongContinuation'}],pullbackReversal:[{...window.pick,group:'pullbackReversal'},{...window.pick,exchange:'TPEx',group:'pullbackReversal'}]};
    overnightState.publication={captureId:'c'.repeat(64),signals:Object.values(overnightState.groups).flat().map((pick,i)=>({...pick,signalId:String(i+1).repeat(64)}))};
    state.screen='overnight';state.overnightView=${JSON.stringify(view==='focus'?'overview':view)};renderOvernightGroups();
    if(${JSON.stringify(view)}==='focus')el.overnightGroups.innerHTML=renderTodayFocusPanel();`);
   const selector=view==='focus'?'.today-focus-card[data-overnight-code]':'.overnight-pick';
   const count=app.doc.querySelectorAll(selector).length;
   assert.ok(count>0);
   for(let i=0;i<count;i++) {
    // 每次重新取得實際重畫後的按鈕；建立編輯器時不靠 test-only context。
    app.evalIn(`closeTradePlans();tradePlanDrafts.clear();renderOvernightGroups();if(${JSON.stringify(view)}==='focus')el.overnightGroups.innerHTML=renderTodayFocusPanel();`);
    const button=app.doc.querySelectorAll(selector)[i];
    const group=view==='focus'?['strongContinuation','pullbackReversal'][i]:view==='strongContinuation'?'strongContinuation':view==='pullbackReversal'?'pullbackReversal':i===0?'strongContinuation':'pullbackReversal';
    const market=view!=='focus'&&((view==='overview'&&i===2)||(view==='pullbackReversal'&&i===1))?'TPEx':'TWSE';
    button.click();await app.settle();
    app.doc.querySelector('[data-trade-plan-open=create]').click();await app.settle();
    const draft=JSON.parse(app.evalIn('JSON.stringify(tradePlansState.editor)'));
    assert.equal(draft.strategy,'overnight');assert.equal(draft.scenario,group);assert.equal(draft.exchange,market);
    assert.equal(draft.sourceCaptureId,'c'.repeat(64));
    assert.equal(draft.signalId,(group==='strongContinuation'?'1':market==='TWSE'?'2':'3').repeat(64));
   }
  } finally {app.cleanup();}
 });
}

for(const mode of ['missing-publication','changed-publication','ambiguous-publication','missing-pick','history']) {
 test(`隔日 ${mode} 保留隔日意圖，來源維持手動`,async()=>{
  const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':{ok:true,rev:0,plans:[]}}});
  try {
   app.evalIn(`window.pick={code:'2330',name:'測試',exchange:'TPEx',price:100,group:'strongContinuation',reasons:[],riskTags:[]};
    overnightState.loaded=true;overnightState.error='';overnightState.groups={strongContinuation:[window.pick]};
    overnightState.publication=${mode==='missing-publication'?'null':"{captureId:'c'.repeat(64),signals:[{...window.pick,signalId:'1'.repeat(64)}]}"};
    state.screen='overnight';state.overnightView='strongContinuation';renderOvernightGroups();
    if(${JSON.stringify(mode)}==='history'){verifyState.data={available:true,signalDate:'2026-08-03',observationDate:'2026-08-04',rows:[window.pick]};el.overnightGroups.innerHTML=renderSignalVerification();}
    if(${JSON.stringify(mode)}==='changed-publication')overnightState.publication={...overnightState.publication,captureId:'d'.repeat(64)};
    if(${JSON.stringify(mode)}==='ambiguous-publication')overnightState.publication.signals.push({...window.pick,signalId:'2'.repeat(64)});
    if(${JSON.stringify(mode)}==='missing-pick')overnightState.groups={};`);
   app.doc.querySelector('[data-screen-panel=overnight] [data-overnight-code]').click();await app.settle();
   app.doc.querySelector('[data-trade-plan-open=create]').click();await app.settle();
   const draft=JSON.parse(app.evalIn('JSON.stringify(tradePlansState.editor)'));
   assert.equal(draft.strategy,'overnight');assert.equal(draft.exchange,'TPEx');
   assert.equal(draft.signalId,null);assert.equal(draft.sourceCaptureId,null);
  }finally{app.cleanup();}
 });
}
