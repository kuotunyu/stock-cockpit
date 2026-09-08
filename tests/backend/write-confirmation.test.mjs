// 真實隔離伺服器：同 rev 手動重送在 queue 前後最多提交一次，回應遺失由 canonical 確認。
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootServer } from '../helpers/test-server.mjs';
import { createAppWindow } from '../helpers/dom-harness.mjs';
import { compactToday } from '../helpers/fixtures.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('同原 payload+rev 的交易/計畫請求排隊，只提交一次且 DOM 可確認 canonical',async(t)=>{
  const srv=await bootServer();
  t.after(()=>srv.close());
  const app=await createAppWindow();
  t.after(()=>app.cleanup());
  app.evalIn('render=()=>{}; showToast=(text)=>window.lastToast=text; tradePlansState.loaded=false;');
  let drop=true;
  const sent=[];
  app.win.fetch=async(path,init)=>{
    assert.ok(['/api/trades','/api/trade-plans'].includes(path));
    // 不傳前端 abort 到 HTTP；合成「server 繼續提交、完整回應在傳送前丟失」。
    const response=await srv.api(path,{method:init.method,body:init.body});
    const payload=await response.json();
    if(init.method==='PUT') {
      sent.push({path,body:JSON.parse(init.body),status:response.status});
      if(drop){assert.equal(response.status,200,JSON.stringify(payload));drop=false;throw new Error('committed response lost');}
    }
    return {ok:response.ok,status:response.status,json:async()=>payload};
  };
  await app.win.loadTradesFromServer();
  const fields={code:'2330',market:'unknown',instrumentType:'stock',instrumentSource:'user',side:'buy',tradeDate:compactToday(-2),date:compactToday(-2),executedAt:'',session:'regular',brokerAccountId:'default',currency:'TWD',price:100,shares:1000,dayTrade:{status:'none',matchedShares:0,pairId:''}};
  assert.equal(await app.win.addTradeRecord(fields),true,app.win.lastToast);
  assert.equal(sent.length,1);
  assert.equal(app.evalIn('tradesState.records.length'),1);
  const saved=await (await srv.api('/api/trades')).json();
  const retry=await srv.api('/api/trades',{method:'PUT',body:JSON.stringify(sent[0].body)});
  assert.equal(retry.status,409);await retry.json();
  assert.equal((await (await srv.api('/api/trades')).json()).rev,saved.rev);

  await app.win.loadTradePlansFromServer();drop=true;
  const plan={planId:randomUUID(),code:'2330',exchange:'TWSE',strategy:'swing',status:'draft',entryPrice:null,stopPrice:null,targetPrice:null,quantity:null,reason:'原意圖'};
  await app.win.putTradePlanIntent({planId:plan.planId,isNew:true,changes:plan});
  assert.equal(app.evalIn('tradePlansState.plans.length'),1);

  // queue 內有受控先行工作：兩份原 rev 都先讀到同一 canonical，然後一起排隊。
  const entered=deferred(),release=deferred();
  const blocker=srv.mod.commitDbMutation(async()=>{entered.resolve();await release.promise;return srv.mod.skipDbMutation(null);});
  await entered.promise;
  const current=await (await srv.api('/api/watchlists')).json();
  const body=JSON.stringify({rev:current.rev,lists:{1:['2330'],2:[],3:[]}});
  const first=srv.api('/api/watchlists',{method:'PUT',body});
  const second=srv.api('/api/watchlists',{method:'PUT',body});
  // 先讀仍只有已提交版本，不能認定前兩份沒有送達。
  assert.equal((await (await srv.api('/api/watchlists')).json()).rev,current.rev);
  release.resolve();await blocker;
  const responses=await Promise.all([first,second]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  await Promise.all(responses.map(r=>r.json()));
  const canonical=await (await srv.api('/api/watchlists')).json();
  assert.equal(canonical.rev,current.rev+1);
  assert.deepEqual(canonical.lists[1],['2330']);
});
