// 交易拒絕須保留原始草稿、實際零費稅、持續錯誤與重試身份。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';

for (const status of [400, 503, 409]) test(`submit ${status} 後保留草稿並可修正重送`, async t => {
  let failure = true, puts = 0;
  let canonical = { ok:true, schemaVersion:2, rev:1, settings:{feeDiscount:0.6,minFee:20}, records:[], portfolio:{holdings:[],totals:{}} };
  const app = await createAppWindow({fetchRoutes:{'/api/trades':(_url, init)=>{
    if (init?.method !== 'PUT') return canonical;
    puts++;
    if (failure) return {ok:false,__status:status === 409 && puts > 1 ? 400 : status,error:status===400?'09/18 賣出 2330 61 股，但當時庫存只有 60 股（賣超）。請核實日期與成交順序。<img src=x onerror=alert(1)>':'賣出 61 股，但當時庫存只有 60 股（賣超）<img src=x onerror=alert(1)>'};
    canonical={...JSON.parse(init.body),ok:true,rev:canonical.rev+1};
    return canonical;
  }}});
  t.after(()=>app.cleanup());
  app.evalIn(`state.screen='watchlist';state.watchList='hold';render();
    const f=el.holdingsPanel.querySelector('[data-trade-form]');
    f.elements.code.value='2330';f.elements.side.value='sell';
    f.elements.price.value='2449';f.elements.shares.value='61';f.elements.date.value='2026-07-10';
    f.elements.feeAmountTwd.value='0';f.elements.taxAmountTwd.value='0';
    f.querySelector('[data-trade-actuals]').open=true;f.elements.shares.focus();
    f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  await app.settle(10);
  let form=app.doc.querySelector('[data-trade-form]');
  assert.deepEqual(['side','price','shares','date','feeAmountTwd','taxAmountTwd'].map(k=>form.elements[k].value),['sell','2449','61','2026-07-10','0','0']);
  assert.equal(form.querySelector('[data-trade-actuals]').open,true);
  assert.equal(form.querySelector('[role=alert]').textContent.trim(),'未儲存：可賣 60 股，輸入 61 股');
  assert.equal(form.querySelector('img'),null);
  assert.equal(form.querySelector('button[type=submit]').disabled,false);
  assert.equal(app.doc.activeElement.name,'shares');
  assert.equal(canonical.records.length,0);
  failure=false;
  form.elements.shares.value='60';
  form.dispatchEvent(new app.win.Event('submit',{bubbles:true,cancelable:true}));
  await app.settle(10);
  form=app.doc.querySelector('[data-trade-form]');
  assert.equal(canonical.records.length,1);
  assert.equal(canonical.records[0].shares,60);
  assert.equal(canonical.records[0].feeAmountTwd,0);
  assert.equal(form.elements.shares.value,'');
  assert.equal(form.querySelector('[role=alert]').hidden,true);
});

async function emptyApp(t) {
  const app=await createAppWindow();t.after(()=>app.cleanup());
  app.evalIn(`state.screen='watchlist';state.watchList='hold';tradePlansState.loaded=false;holdingsPlanRiskState.loadAttempted=true;
    tradesState.records=[];tradesState.rev=0;render();`);
  return app;
}
function submit(app) {
  app.evalIn(`(()=>{const f=el.holdingsPanel.querySelector('[data-trade-form]');
    f.elements.code.value='2330';f.elements.price.value='100';f.elements.shares.value='60';f.elements.date.value='2026-07-10';
    f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
}
const reply=(body,status=200)=>({ok:status<400,status,json:async()=>body});

test('401 後同帳號重登或切換帳號都不外露舊草稿',async t=>{
  const app=await emptyApp(t);
  const user=JSON.parse(app.evalIn('JSON.stringify(authState.user)'));
  app.win.fetch=async()=>reply({code:'AUTH_REQUIRED',error:'登入失效'},401);
  submit(app);await app.settle(8);
  assert.equal(app.doc.querySelector('[data-trade-form]'),null);
  for(const id of [user.id,'other-account']) {
    app.evalIn(`authState.user=${JSON.stringify({...user,id})};tradesState.loaded=true;renderHoldingsPanel();`);
    assert.equal(app.doc.querySelector('[data-trade-form]').elements.shares.value,'');
  }
});

test('結果未知的表單重試使用相同 payload 與 ID',async t=>{
  const app=await emptyApp(t);const bodies=[];
  let canonical={ok:true,rev:0,settings:{feeDiscount:0.6,minFee:20},records:[]};
  app.win.fetch=async(_url,init)=>{
    if(init?.method==='PUT') {
      bodies.push(JSON.parse(init.body));
      if(bodies.length===1) throw new Error('response lost');
      canonical={...bodies[0],ok:true,rev:1};return reply(canonical);
    }
    return reply(canonical);
  };
  submit(app);await app.settle(8);
  const form=app.doc.querySelector('[data-trade-form]');
  assert.equal(form.elements.shares.value,'60');
  assert.match(form.querySelector('[role=alert]').textContent,/尚未確認/);
  form.dispatchEvent(new app.win.Event('submit',{bubbles:true,cancelable:true}));await app.settle(8);
  assert.deepEqual(bodies[1],bodies[0]);assert.equal(canonical.records.length,1);
});

test('保存途中繼續輸入，新草稿與焦點保留但送出鈕必須恢復',async t=>{
  const app=await emptyApp(t);let release;
  app.win.fetch=async(_url,init)=>{
    const body=JSON.parse(init.body);
    await new Promise(resolve=>{release=resolve;});return reply({...body,ok:true,rev:1});
  };
  submit(app);
  const form=app.doc.querySelector('[data-trade-form]');
  form.elements.shares.value='70';form.elements.shares.focus();
  form.elements.shares.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  release();await app.settle(8);
  const updated=app.doc.querySelector('[data-trade-form]');
  assert.equal(updated.elements.shares.value,'70');
  assert.equal(updated.querySelector('button[type=submit]').disabled,false);
  assert.equal(app.doc.activeElement.name,'shares');
  assert.equal(app.evalIn('tradesState.records[0].shares'),60);
});

test('舊新增回應不得重設後來切換的修正草稿',async t=>{
  const app=await emptyApp(t);let release;
  app.evalIn(`tradesState.records=[{id:'existing',createdAt:'2026-07-09',date:'20260709',code:'2330',side:'buy',price:100,shares:10}];`);
  app.win.fetch=async(_url,init)=>{const body=JSON.parse(init.body);await new Promise(r=>{release=r;});return reply({...body,ok:true,rev:1});};
  submit(app);app.evalIn("beginTradeEdit('existing')");
  const input=app.doc.querySelector('[data-trade-form]').elements.shares;
  input.value='99';input.focus();input.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  release();await app.settle(8);
  assert.equal(app.doc.querySelector('[data-trade-form]').dataset.editingId,'existing');
  assert.equal(app.doc.querySelector('[data-trade-form]').elements.shares.value,'99');
  assert.equal(app.doc.activeElement.name,'shares');
});

test('修正送出後僅移動焦點，成功仍須回到空白新增表單',async t=>{
  const app=await emptyApp(t);let release;
  app.evalIn(`tradesState.records=[{id:'existing',createdAt:'2026-07-09',date:'20260709',code:'2330',side:'buy',price:100,shares:10}];beginTradeEdit('existing');`);
  app.win.fetch=async(_url,init)=>{const body=JSON.parse(init.body);await new Promise(r=>{release=r;});return reply({...body,ok:true,rev:1});};
  submit(app);
  app.doc.querySelector('[data-trade-form]').elements.price.focus();
  release();await app.settle(8);
  const form=app.doc.querySelector('[data-trade-form]');
  assert.equal(form.dataset.editingId,undefined);
  assert.equal(form.elements.shares.value,'');
  assert.equal(app.evalIn('tradesEditingId'),'');
  assert.equal(app.evalIn('tradesState.records.length'),1);
});

for(const status of [200,400]) test(`保存 ${status} 回應時焦點在表單外，模式與按鈕仍必須更新`,async t=>{
  const app=await emptyApp(t);let release;
  app.evalIn(`tradesState.records=[{id:'existing',createdAt:'2026-07-09',date:'20260709',code:'2330',side:'buy',price:100,shares:10}];beginTradeEdit('existing');`);
  app.win.fetch=async(_url,init)=>{const body=JSON.parse(init.body);await new Promise(r=>{release=r;});return reply(status===200?{...body,ok:true,rev:1}:{error:'業務拒絕'},status);};
  submit(app);
  app.doc.querySelector('[data-holdings-risk-fold] > summary').focus();
  release();await app.settle(8);
  const form=app.doc.querySelector('[data-trade-form]');
  assert.equal(form.querySelector('button[type=submit]').disabled,false);
  assert.equal(form.dataset.editingId,status===200?undefined:'existing');
  assert.equal(form.elements.shares.value,status===200?'':'60');
  assert.equal(app.doc.activeElement,app.doc.querySelector('[data-holdings-risk-fold] > summary'));
});
