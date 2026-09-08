// 未確認寫入保留原意圖，canonical 與原 rev 防止回應丟失後重複記帳或零秒重送。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAppWindow } from '../helpers/dom-harness.mjs';
import { compactToday } from '../helpers/fixtures.mjs';
const settings={feeDiscount:0.6,minFee:20};
const fields={code:'2330',side:'buy',kind:'stock',price:100,shares:1000,date:compactToday(-2)};
const reply=(body,status=200)=>({ok:status<400,status,json:async()=>body});
async function fixture(t) {
  const app=await createAppWindow({fetchRoutes:{'/api/trades':{ok:true,rev:0,settings,records:[]}}});
  t.after(()=>app.cleanup());
  app.evalIn('showToast = (text) => { window.lastToast = text; }; tradePlansState.loaded = false;');
  return app;
}

test('已提交但回應丟失：先 canonical 核對，同一新增意圖不新增第二筆',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,settings,records:[]},puts=0;
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){
      puts++;const body=JSON.parse(init.body);canonical={...body,ok:true,rev:body.rev+1};
      throw new Error('response lost');
    }
    return reply(canonical);
  };
  assert.equal(await app.win.addTradeRecord(fields),true);
  assert.equal(puts,1);
  assert.equal(app.evalIn('tradesState.records.length'),1);
});

test('GET 尚不存在保持未知；手動保存原 rev/ID，409 後確認且不重放新增',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,settings,records:[]};const bodies=[];
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){
      const body=JSON.parse(init.body);bodies.push(body);
      if(bodies.length===1)throw new Error('lost before queue');
      // 第一份請求恰好進 queue 並提交，第二份原 rev 被擋。
      canonical={...bodies[0],ok:true,rev:1};
      return reply({error:'conflict',code:'REV_CONFLICT'},409);
    }
    return reply(canonical);
  };
  assert.equal(await app.win.addTradeRecord(fields),false);
  assert.match(app.win.lastToast,/尚未確認/);
  assert.equal(bodies.length,1,'GET 不存在不能自動重送');
  assert.equal(await app.win.addTradeRecord(fields),true);
  assert.equal(bodies.length,2);
  assert.deepEqual(bodies[1],bodies[0]);
  assert.equal(canonical.records.length,1);
  assert.equal(app.evalIn('tradesState.records.length'),1);
});

test('未知後修改草稿：只解決原意圖，本次新內容不得冒充已保存',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,settings,records:[]};const bodies=[];
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){
      const body=JSON.parse(init.body);bodies.push(body);
      if(bodies.length===1)throw new Error('lost');
      canonical={...body,ok:true,rev:1};return reply(canonical);
    }
    return reply(canonical);
  };
  assert.equal(await app.win.addTradeRecord(fields),false);
  assert.equal(await app.win.addTradeRecord({...fields,shares:2000}),false);
  assert.deepEqual(bodies[1],bodies[0]);
  assert.match(app.win.lastToast,/本次|後續/);
  assert.equal(canonical.records[0].shares,1000);
});

for(const kind of ['watch','alert']) test(`${kind} 未知且 pending：finally 不排零秒寫入`,async(t)=>{
  const app=await fixture(t);let release,puts=0;
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){puts++;await new Promise(r=>release=r);throw new Error('lost');}
    return reply(kind==='watch'?{ok:true,rev:0,lists:{1:[],2:[],3:[]}}:{ok:true,rev:0,alerts:[]});
  };
  const call=kind==='watch'?'syncWatchListsToServer':'syncAlertsToServer';
  const pending=app.win[call]();await setImmediate();
  await app.win[call]();release();await pending;await app.settle();
  assert.equal(puts,1);
  assert.equal(app.evalIn(kind==='watch'?'watchListSyncInFlight':'alertSyncInFlight'),false);
  assert.match(app.win.lastToast,/尚未確認/);
});

test('舊帳號 finally 不清新帳號的帳本寫入鎖',async(t)=>{
  const app=await fixture(t);let release;
  app.win.fetch=async(_url,init)=>{await new Promise(r=>release=r);return reply({ok:true,rev:1,settings,records:[]});};
  const old=app.win.addTradeRecord(fields);
  app.evalIn('clearUserScopedState({renderNow:false}); authState.user={id:"other"}; tradesState.mutating=true;');
  release();await old;
  assert.equal(app.evalIn('tradesState.mutating'),true);
});

test('未知期間背景 GET 已套用 canonical：再次保存仍辨識同一意圖，不留下重複草稿',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,settings,records:[]},sent,puts=0;
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){puts++;sent=JSON.parse(init.body);throw new Error('lost');}
    return reply(canonical);
  };
  assert.equal(await app.win.addTradeRecord(fields),false);
  canonical={...sent,ok:true,rev:1};
  await app.win.loadTradesFromServer();
  assert.equal(await app.win.addTradeRecord(fields),true);
  assert.equal(puts,1);
  assert.equal(app.evalIn('tradesState.records.length'),1);
});

test('計畫回應丟失與改草稿：保留 planId，先確認原內容而不丟失新輸入',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,plans:[]},puts=[];
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){const body=JSON.parse(init.body);puts.push(body);if(puts.length===1)throw new Error('lost');canonical={...body,ok:true,rev:1};return reply(canonical);}
    return reply(canonical);
  };
  await app.win.openTradePlans(null,true);
  const originalId=app.evalIn('tradePlansState.editor.planId');
  await app.win.submitTradePlan({preventDefault(){}});
  assert.match(app.doc.querySelector('#tradePlanError').textContent,/尚未確認/);
  const reason=app.doc.querySelector('#tradePlanForm [name=reason]');reason.value='之後的草稿';reason.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  await app.win.submitTradePlan({preventDefault(){}});
  assert.deepEqual(puts[1],puts[0]);
  assert.equal(canonical.plans[0].planId,originalId);
  assert.equal(reason.value,'之後的草稿');
  assert.match(app.doc.querySelector('#tradePlanError').textContent,/本次/);
});

test('復原無完整回應只說結果未確認，清密碼/token 並重讀個人資料',async(t)=>{
  const app=await fixture(t);let posts=0,reads=0;
  app.evalIn('personalBackupState.previewToken="one-use-token"');
  app.doc.getElementById('personalBackupConfirm').checked=true;
  app.doc.getElementById('personalBackupPassword').value='never-store-this-password';
  app.win.fetch=async(_url,init)=>{
    if(init.method==='POST'){posts++;throw new Error('lost');}
    reads++;return reply({ok:true,rev:1,records:[],plans:[],lists:{1:[],2:[],3:[]},alerts:[]});
  };
  await app.win.restorePersonalBackup();await setImmediate();
  assert.match(app.evalIn('personalBackupState.status'),/結果尚未確認/);
  assert.doesNotMatch(app.evalIn('personalBackupState.status'),/復原失敗/);
  assert.equal(app.evalIn('personalBackupState.previewToken'),'');
  assert.equal(app.evalIn('personalBackupState.restoring'),false);
  assert.equal(app.doc.getElementById('personalBackupPassword').value,'');
  assert.ok(reads>=4);
  assert.equal(posts,1);
  assert.doesNotMatch(app.evalIn('JSON.stringify(localStorage)'),/never-store-this-password/);
  assert.doesNotMatch(app.evalIn('JSON.stringify([tradesWrite,tradePlanWrite,watchListWrite,alertWrite])'),/never-store-this-password/);
});

test('計畫原意圖確認後，新草稿可下一次保存，不因同 ID 永久卡住',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,plans:[]},puts=0;
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){const body=JSON.parse(init.body);puts++;if(puts===1)throw new Error('lost');canonical={...body,ok:true,rev:canonical.rev+1};return reply(canonical);}
    return reply(canonical);
  };
  await app.win.openTradePlans(null,true);
  await app.win.submitTradePlan({preventDefault(){}});
  const reason=app.doc.querySelector('#tradePlanForm [name=reason]');reason.value='新的草稿';reason.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  await app.win.submitTradePlan({preventDefault(){}});
  await app.win.submitTradePlan({preventDefault(){}});
  assert.equal(puts,3);
  assert.equal(canonical.plans.length,1);
  assert.equal(canonical.plans[0].reason,'新的草稿');
});

test('原請求仍未提交時等待不是死鎖：手動原 rev 重試可成為唯一提交',async(t)=>{
  const app=await fixture(t);let canonical={ok:true,rev:0,settings,records:[]},puts=[];
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT'){const body=JSON.parse(init.body);puts.push(body);if(puts.length===1)throw new Error('never reached server');canonical={...body,ok:true,rev:1};return reply(canonical);}
    return reply(canonical);
  };
  assert.equal(await app.win.addTradeRecord(fields),false);
  assert.equal(await app.win.addTradeRecord(fields),true);
  assert.deepEqual(puts[1],puts[0]);
  assert.equal(canonical.records.length,1);
});

test('自動觸價保存不得重試尚未確認的原寫入',async(t)=>{
  const app=await fixture(t);let scheduled=0;
  const original=app.win.setTimeout.bind(app.win);
  app.win.setTimeout=(fn,ms,...args)=>{if(ms===350){scheduled++;return 123;}return original(fn,ms,...args);};
  app.evalIn('alertWrite.pending={}; scheduleAlertSync({userInitiated:false})');
  assert.equal(scheduled,0);
  app.evalIn('scheduleAlertSync()');
  assert.equal(scheduled,1,'明確使用者操作仍提供恢復入口');
});

test('計畫保存期間改草稿再斷線，仍須顯示原寫入未確認',async(t)=>{
  const app=await fixture(t);let reject;
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT')await new Promise((_r,j)=>reject=j);
    return reply({ok:true,rev:0,plans:[]});
  };
  await app.win.openTradePlans(null,true);
  const pending=app.win.submitTradePlan({preventDefault(){}});
  const reason=app.doc.querySelector('#tradePlanForm [name=reason]');reason.value='保存期間修改';reason.dispatchEvent(new app.win.Event('input',{bubbles:true}));
  reject(new Error('lost'));await pending;
  assert.equal(reason.value,'保存期間修改');
  assert.match(app.doc.querySelector('#tradePlanError').textContent,/尚未確認/);
});
