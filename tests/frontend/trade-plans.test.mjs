// 個人計畫表單：來源精確匹配、草稿隔離、意圖重放與雙擊去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppWindow} from '../helpers/dom-harness.mjs';
test('displayed publication only: exact scenario source or honestly manual',async()=>{
 const app=await createAppWindow();try{
  assert.equal(app.evalIn('typeof tradePlanFromDisplayedPick'),'function');
  app.evalIn(`window.pick={code:'2330',exchange:'TWSE',price:100,scenario:{key:'a'},plan:{entry:99,structuralStop:95}};
    window.pub={captureId:'c'.repeat(64),signals:[{...window.pick,signalId:'a'.repeat(64)}]};`);
  assert.equal(app.evalIn("tradePlanFromDisplayedPick(window.pick,'swing',window.pub).signalId"),'a'.repeat(64));
  assert.equal(app.evalIn("tradePlanFromDisplayedPick({...window.pick,scenario:{key:'b'}},'swing',window.pub).signalId"),null);
  assert.equal(app.evalIn("tradePlanFromDisplayedPick(window.pick,'swing',{kind:'not-persisted'}).signalId"),null);
 }finally{app.cleanup();}
});
test('409 edit replays changed fields on latest plans, without stale history or another plan overwrite',async()=>{
 let puts=[];const old={planId:'p1',code:'2330',strategy:'swing',stopPrice:95,reason:'old',revisions:[]};
 const latest={...old,reason:'other tab',revisions:[{revision:1}]};
 const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':(_url,init)=>{
  if(init?.method==='PUT'){puts.push(JSON.parse(init.body));return puts.length===1?{ok:false,__status:409,code:'REV_CONFLICT'}:{ok:true,rev:3,plans:puts.at(-1).plans};}
  return {ok:true,rev:2,plans:[latest,{planId:'p2'}]};
 }}});try{
  app.evalIn(`tradePlansState.plans=${JSON.stringify([old])};tradePlansState.rev=1;`);
  await app.evalIn("putTradePlanIntent({planId:'p1',changes:{stopPrice:101},isNew:false})");
  assert.equal(puts.length,2);assert.equal(puts[1].plans[0].reason,'other tab');assert.equal(puts[1].plans[0].stopPrice,101);
  assert.equal(puts[1].plans[0].revisions.length,1);assert.equal(puts[1].plans.length,2);
 }finally{app.cleanup();}
});
test('open draft survives render, close and same account login; other account cannot see it',async()=>{
 const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':{ok:true,rev:0,plans:[]}}});try{
  await app.evalIn('openTradePlans(null,true)');
  const input=app.doc.querySelector('#tradePlanForm [name=reason]');input.value='PRIVATE_DRAFT';input.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  app.evalIn('render({preserveLiveDrafts:true});closeTradePlans()');await app.evalIn('openTradePlans(null,true)');
  assert.equal(app.doc.querySelector('#tradePlanForm [name=reason]').value,'PRIVATE_DRAFT');
  app.evalIn("activateAuthenticatedUser({id:'u2'});");await app.evalIn('openTradePlans(null,true)');
  assert.doesNotMatch(app.doc.querySelector('#tradePlanModal').textContent,/PRIVATE_DRAFT/);
  assert.equal(app.doc.querySelector('#tradePlanForm [name=reason]').value,'');
  app.evalIn("activateAuthenticatedUser({id:'u1'});");await app.evalIn('openTradePlans(null,true)');
  assert.equal(app.doc.querySelector('#tradePlanForm [name=reason]').value,'PRIVATE_DRAFT');
 }finally{app.cleanup();}
});
test('delayed PUT double-click sends once and preserves input typed during save',async()=>{
 const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':{ok:true,rev:0,plans:[]}}});try{
  await app.evalIn('openTradePlans(null,true)');let release,puts=0;const original=app.win.fetch;
  app.win.fetch=async(url,init)=>{
   if(url==='/api/trade-plans'&&init?.method==='PUT'){puts++;const sent=JSON.parse(init.body);await new Promise(resolve=>release=resolve);return {ok:true,status:200,json:async()=>({ok:true,rev:1,plans:sent.plans}),headers:{get:()=> 'application/json'}};}
   return original(url,init);
  };
  const first=app.evalIn('submitTradePlan({preventDefault(){}})');await app.evalIn('submitTradePlan({preventDefault(){}})');assert.equal(puts,1);
  const reason=app.doc.querySelector('[name=reason]');reason.value='NEW_WHILE_SAVING';reason.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  release();await first;assert.equal(reason.value,'NEW_WHILE_SAVING');assert.equal(app.evalIn('tradePlansState.editor.reason'),'NEW_WHILE_SAVING');assert.ok(app.evalIn('tradePlansState.base'));
 }finally{app.cleanup();}
});
test('delayed save after close/reopen cannot replace a different editor or source',async()=>{
 const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':{ok:true,rev:0,plans:[]}}});try{
  await app.evalIn('openTradePlans(null,true)');let release;const original=app.win.fetch;
  app.win.fetch=async(url,init)=>{if(url==='/api/trade-plans'&&init?.method==='PUT'){const sent=JSON.parse(init.body);await new Promise(resolve=>release=resolve);return {ok:true,status:200,json:async()=>({ok:true,rev:1,plans:sent.plans}),headers:{get:()=> 'application/json'}};}return original(url,init);};
  const pending=app.evalIn('submitTradePlan({preventDefault(){}})');app.evalIn("closeTradePlans();tradePlanDrafts.clear();detailTradePlanContext={...tradePlansState.editor,code:'1101'};state.selectedCode='1101';");await app.evalIn('openTradePlans(null,true)');
  const newId=app.evalIn('tradePlansState.editor.planId');release();await pending;
  assert.equal(app.evalIn('tradePlansState.editor.planId'),newId);assert.equal(app.doc.querySelector('[name=code]').value,'1101');
 }finally{app.cleanup();}
});
test('older GET failure after close/reopen cannot replace the new editor or show its stale error',async()=>{
 const app=await createAppWindow();try{
  const original=app.win.fetch;let rejectOld,calls=0;
  app.win.fetch=async(url,init)=>{if(url==='/api/trade-plans'){
   calls++;if(calls===1)await new Promise((_resolve,reject)=>rejectOld=reject);
   return {ok:true,status:200,json:async()=>({ok:true,rev:2,plans:[]}),headers:{get:()=> 'application/json'}};
   }return original(url,init);
  };
  const first=app.evalIn('openTradePlans(null,true)');app.evalIn("closeTradePlans();tradePlanDrafts.clear();detailTradePlanContext={...tradePlansState.editor,code:'1101'};state.selectedCode='1101'");await app.evalIn('openTradePlans(null,true)');
  rejectOld(new Error('OLD_GET_FAILURE'));await first;assert.equal(app.doc.querySelector('[name=code]').value,'1101');assert.doesNotMatch(app.doc.querySelector('#tradePlanError').textContent,/OLD_GET_FAILURE/);
 }finally{app.cleanup();}
});
for (const mode of ['later-input', 'close-reopen']) {
 test(`409 canonical merge ${mode}: second save contains only post-submit edits, never stale untouched fields`, async()=>{
  const old={planId:'merge-target',code:'2330',exchange:'TWSE',strategy:'swing',scenario:'midBandDefense',signalId:'a'.repeat(64),sourceCaptureId:'b'.repeat(64),
   status:'draft',entryPrice:100,stopPrice:95,targetPrice:120,quantity:1000,expiresOn:null,entryLow:null,entryHigh:null,riskBudgetCash:5000,invalidationReason:'original condition',reason:'old',revisions:[],source:{verification:'verified-local'}};
  const latest={...old,reason:'other tab',riskBudgetCash:6000,invalidationReason:'other condition',revisions:[{revision:1,recordedAt:new Date().toISOString(),intent:{reason:'other tab',stopPrice:95}}]};
  let current={ok:true,rev:1,schemaVersion:1,plans:[old]}, release, firstStarted;
  const started=new Promise(resolve=>firstStarted=resolve), gate=new Promise(resolve=>release=resolve), puts=[];
  const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':()=>current}});
  try{
   await app.evalIn('openTradePlans(null,false)');
   app.evalIn('tradePlansState.editor=JSON.parse(JSON.stringify(tradePlansState.plans[0]));tradePlansState.base=tradePlansState.plans[0];renderTradePlanEditor()');
   const originalFetch=app.win.fetch;
   app.win.fetch=async(url,init)=>{
    if(url!=='/api/trade-plans')return originalFetch(url,init);
    if(init?.method==='PUT'){
     const sent=JSON.parse(init.body);puts.push(sent);
     if(puts.length===1){firstStarted();await gate;current={ok:true,rev:2,schemaVersion:1,plans:[latest]};return {ok:false,status:409,json:async()=>({ok:false,error:'conflict'}),headers:{get:()=> 'application/json'}};}
     current={ok:true,rev:current.rev+1,schemaVersion:1,plans:sent.plans};
    }
    return {ok:true,status:200,json:async()=>current,headers:{get:()=> 'application/json'}};
   };
   const input=(name,value)=>{const node=app.doc.querySelector(`#tradePlanForm [name=${name}]`);node.value=value;node.dispatchEvent(new app.win.Event('input',{bubbles:true}));return node;};
   input('stopPrice','96');const pending=app.evalIn('submitTradePlan({preventDefault(){}})');await started;
   if(mode==='later-input')input('quantity','2000');
   else {app.evalIn('closeTradePlans()');await app.evalIn('openTradePlans(null,false)');}
   release();await pending;
   assert.equal(puts[1].plans[0].reason,'other tab','first 409 replay kept remote intent');
   assert.equal(app.evalIn('tradePlansState.editor.reason'),'other tab');
   assert.equal(app.doc.querySelector('#tradePlanForm [name=reason]').value,'other tab');
   assert.equal(app.doc.querySelector('#tradePlanForm [name=riskBudgetCash]').value,'6000');
   assert.equal(app.doc.querySelector('#tradePlanForm [name=invalidationReason]').value,'other condition');
   assert.equal(app.evalIn('tradePlansState.editor.quantity'),mode==='later-input'?2000:1000);
   if(mode==='close-reopen')assert.equal(app.evalIn('tradePlanDrafts.has(authState.user.id)'),false);
   await app.evalIn('submitTradePlan({preventDefault(){}})');
   assert.equal(puts.length,3);assert.equal(puts[2].plans[0].reason,'other tab');assert.equal(puts[2].plans[0].riskBudgetCash,6000);
   assert.equal(puts[2].plans[0].invalidationReason,'other condition');assert.equal(puts[2].plans[0].quantity,mode==='later-input'?2000:1000);
   assert.deepEqual(puts[2].plans[0].revisions,latest.revisions);assert.deepEqual(puts[2].plans[0].source,old.source);assert.equal(puts[2].plans[0].signalId,old.signalId);
  }finally{release();app.cleanup();}
 });
}
