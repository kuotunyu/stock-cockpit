// 計畫未知結果依成交關聯／檢討 delta 核對，背景 canonical 到達後仍能恢復新草稿。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAppWindow } from '../helpers/dom-harness.mjs';
const reply=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const base={planId:'plan-one',code:'2330',exchange:'TWSE',strategy:'swing',status:'draft',reason:'original',tradeLinks:[{tradeId:'old',allocatedShares:10,snapshot:{id:'old'},fingerprint:'original',linkedAt:'original-time'}],review:{decision:'no-entry',reason:'original review',reviewedAt:'original-time'}};
const linked={tradeId:'new',allocatedShares:20,snapshot:{id:'new',code:'2330',shares:100},fingerprint:'canonical-fingerprint',linkedAt:'canonical-time'};
const cases=[
  ['新增連結',{linkChanges:{remove:[],upsert:[{tradeId:'new',allocatedShares:20}]}},{...base,tradeLinks:[...base.tradeLinks,linked]}],
  ['解除連結',{linkChanges:{remove:['old'],upsert:[]}},{...base,tradeLinks:[]}],
  ['只改檢討說明',{review:{reason:'new review'}},{...base,review:{decision:'no-entry',reason:'new review',reviewedAt:'server-time'}}],
  ['只改檢討分類',{review:{decision:'conditions-changed'}},{...base,review:{decision:'conditions-changed',reason:'original review',reviewedAt:'server-time'}}],
  ['清除檢討',{review:null},{...base,review:null}],
];
async function fixture(t, initial={ok:true,rev:1,plans:[base]}){
  const app=await createAppWindow({fetchRoutes:{'/api/trade-plans':initial}});
  t.after(async()=>{await setImmediate();app.cleanup();});
  app.evalIn('showToast=text=>window.lastToast=text;');
  await app.win.loadTradePlansFromServer();
  return app;
}
for(const [name,changes,result] of cases){
  test(`${name} 已提交回應丟失：只讀真 canonical 形狀即可確認`,async(t)=>{
    const app=await fixture(t);let puts=0;
    app.win.fetch=async(_url,init)=>{
      if(init.method==='PUT'){puts++;throw new Error('committed response lost');}
      return reply({ok:true,rev:2,plans:[result]});
    };
    await app.win.putTradePlanIntent({planId:base.planId,isNew:false,changes});
    assert.equal(puts,1);
    assert.equal(app.evalIn('tradePlanWrite.pending'),null);
    assert.deepEqual(JSON.parse(app.evalIn('JSON.stringify(tradePlansState.plans[0])')),result);
    assert.equal(Object.hasOwn(result,'linkChanges'),false,'canonical 不能虛構 delta 欄位');
  });
}
for(const [name,changes] of cases){
  test(`${name} 的最新 rev 已前進但意圖不匹配，仍須明確衝突且不可重放`,async(t)=>{
    const app=await fixture(t);let puts=0;
    app.win.fetch=async(_url,init)=>{
      if(init.method==='PUT'){puts++;throw new Error('lost');}
      return reply({ok:true,rev:2,plans:[base]});
    };
    await assert.rejects(app.win.putTradePlanIntent({planId:base.planId,isNew:false,changes}),e=>e.noReplay===true && /不同/.test(e.message));
    assert.equal(puts,1);
  });
}
for(const changed of [false,true]){
  test(`新增計畫未知→背景 GET 已載入提交→${changed?'修改':'保留'}草稿再保存`,async(t)=>{
    const app=await fixture(t,{ok:true,rev:0,plans:[]});
    let canonical={ok:true,rev:0,plans:[]},submitted,puts=0;
    app.win.fetch=async(_url,init)=>{
      if(init.method==='PUT'){
        puts++;const body=JSON.parse(init.body);
        if(puts===1){submitted=body;throw new Error('lost before canonical is visible');}
        canonical={...body,ok:true,rev:canonical.rev+1};return reply(canonical);
      }
      return reply(canonical);
    };
    await app.win.openTradePlans(null,true);
    const codeInput=app.doc.querySelector('#tradePlanForm [name=code]');codeInput.value='2330';codeInput.dispatchEvent(new app.win.Event('input',{bubbles:true}));
    const id=app.evalIn('tradePlansState.editor.planId');
    await app.win.submitTradePlan({preventDefault(){}});
    assert.ok(app.evalIn('tradePlanWrite.pending'));
    assert.equal(app.evalIn('tradePlansState.base'),null);
    canonical={...submitted,ok:true,rev:1};
    await app.win.loadTradePlansFromServer();
    if(changed){const input=app.doc.querySelector('#tradePlanForm [name=reason]');input.value='later draft';input.dispatchEvent(new app.win.Event('input',{bubbles:true}));}
    await app.win.submitTradePlan({preventDefault(){}});
    assert.equal(puts,1,'確認原提交不應額外寫入');
    assert.equal(app.evalIn('tradePlanWrite.pending'),null);
    assert.equal(app.evalIn('tradePlansState.base.planId'),id);
    if(changed){
      assert.equal(app.doc.querySelector('#tradePlanForm [name=reason]').value,'later draft');
      assert.match(app.doc.querySelector('#tradePlanError').textContent,/本次修改尚未保存/);
      await app.win.submitTradePlan({preventDefault(){}});
      assert.equal(puts,2);assert.equal(canonical.plans.length,1);assert.equal(canonical.plans[0].planId,id);assert.equal(canonical.plans[0].reason,'later draft');
    }
  });
}

for(const kind of ['review','linkChanges']){
  test(`保存途中改寫呼叫端 ${kind} 物件不能改變原確認意圖`,async(t)=>{
    const app=await fixture(t);let reject;
    const changes=kind==='review'?{review:{reason:'sent review'}}:{linkChanges:{remove:[],upsert:[{tradeId:'new',allocatedShares:20}]}};
    const result=kind==='review'?{...base,review:{...base.review,reason:'sent review',reviewedAt:'server-time'}}:{...base,tradeLinks:[...base.tradeLinks,linked]};
    app.win.fetch=async(_url,init)=>{
      if(init.method==='PUT')await new Promise((_resolve,j)=>reject=j);
      return reply({ok:true,rev:2,plans:[result]});
    };
    const pending=app.win.putTradePlanIntent({planId:base.planId,isNew:false,changes});
    if(kind==='review')changes.review.reason='later review';
    else changes.linkChanges.upsert[0].allocatedShares=50;
    reject(new Error('committed response lost'));
    await pending;
    assert.equal(app.evalIn('tradePlanWrite.pending'),null);
    assert.deepEqual(JSON.parse(app.evalIn('JSON.stringify(tradePlansState.plans[0])')),result);
  });
}

test('link upsert 同 tradeId 但分配股數不同，不能只靠 ID 認定成功',async(t)=>{
  const app=await fixture(t);
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT')throw new Error('lost');
    return reply({ok:true,rev:2,plans:[{...base,tradeLinks:[...base.tradeLinks,{...linked,allocatedShares:21}]}]});
  };
  await assert.rejects(app.win.putTradePlanIntent({planId:base.planId,isNew:false,changes:{linkChanges:{remove:[],upsert:[{tradeId:'new',allocatedShares:20}]}}}),e=>e.noReplay===true);
});

test('新增計畫包含 links/review，正規化補證據欄位仍按使用者意圖确认',async(t)=>{
  const app=await fixture(t,{ok:true,rev:0,plans:[]});
  const draft={...base,tradeLinks:[{tradeId:'new',allocatedShares:20}],review:{decision:'no-entry',reason:'new review'}};
  const canonical={...draft,tradeLinks:[linked],review:{...draft.review,reviewedAt:'server-time'}};
  app.win.fetch=async(_url,init)=>{
    if(init.method==='PUT')throw new Error('committed response lost');
    return reply({ok:true,rev:1,plans:[canonical]});
  };
  await app.win.putTradePlanIntent({planId:draft.planId,isNew:true,changes:draft});
  assert.equal(app.evalIn('tradePlanWrite.pending'),null);
});
