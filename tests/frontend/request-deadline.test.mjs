// 請求 deadline 涵蓋 headers 與 body，逾時/取消後能恢復且不重送寫入。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAppWindow } from '../helpers/dom-harness.mjs';

// 外層只限制讀檔/jsdom/bootstrap＋測試的總時間；產品 deadline 仍按下方20/1000ms驗證。
const BOOTSTRAP_TEST_TIMEOUT = 10_000;
async function fixture(t, createWindow = createAppWindow) {
  let app; let cleaned = false;
  const cleanup = () => { if (app && !cleaned) { cleaned = true; app.cleanup(); } };
  t.after(cleanup);
  app = await createWindow();
  if (t.signal.aborted) { cleanup(); throw t.signal.reason; }
  app.evalIn('pendingFetchCount = 0');
  const requests=[];
  app.win.fetch=(url,init)=>new Promise((resolve,reject)=>requests.push({url,init,resolve,reject}));
  return {...app,requests};
}
const response=(json,status=200)=>({ok:status<400,status,json});

test('fixture 在初始化被取消後才建立 window，仍立即關閉且不繼續測試請求', async () => {
  const controller = new AbortController(); const cleanups = [];
  let release; let closed = 0; let setupCalls = 0;
  const lateWindow = { cleanup: () => { closed++; }, evalIn: () => { setupCalls++; }, win: {} };
  const creation = new Promise(resolve => { release = resolve; });
  const pending = fixture({ signal: controller.signal, after: callback => cleanups.push(callback) }, () => creation);
  try {
    assert.equal(cleanups.length, 1, '初始化 await 之前先註冊清理');
    controller.abort(new Error('fixture cancelled'));
    for (const cleanup of cleanups) cleanup();
    release(lateWindow);
    await assert.rejects(pending, /fixture cancelled/);
    for (const cleanup of cleanups) cleanup();
    assert.equal(closed, 1);
    assert.equal(setupCalls, 0); assert.equal(lateWindow.win.fetch, undefined, '取消後不安裝測試請求或執行fallback');
  } finally { release(lateWindow); await pending.then(app => app.cleanup(), () => {}); }
});

test('headers 已回而 body 未完成仍在 loading，deadline 釋放並可重試', { timeout: BOOTSTRAP_TEST_TIMEOUT }, async(t)=>{
  const app=await fixture(t);
  const pending=app.win.fetchApi('/api/symbols',{timeoutMs:20});
  const outcome=pending.catch(e=>e);
  app.requests[0].resolve(response(()=>new Promise(()=>{})));
  await setImmediate();
  assert.equal(app.evalIn('pendingFetchCount'),1);
  const error=await outcome;
  assert.equal(error.code,'REQUEST_TIMEOUT');
  assert.equal(app.requests[0].init.signal.aborted,true);
  assert.equal(app.evalIn('pendingFetchCount'),0);
  const retry=app.win.fetchApi('/api/symbols',{timeoutMs:1000});
  app.requests[1].resolve(response(async()=>({ok:true})));
  assert.equal((await retry).ok,true);
});

test('無 headers 的取消有獨立分類；舊 finally 不結束新請求', { timeout: BOOTSTRAP_TEST_TIMEOUT }, async(t)=>{
  const app=await fixture(t),controller=new app.win.AbortController();
  const old=app.win.fetchApi('/api/symbols',{signal:controller.signal,timeoutMs:1000}).catch(e=>e);
  const fresh=app.win.fetchApi('/api/symbols',{timeoutMs:1000});
  controller.abort();
  assert.equal((await old).code,'REQUEST_CANCELLED');
  assert.equal(app.evalIn('pendingFetchCount'),1);
  app.requests[1].resolve(response(async()=>({ok:true})));
  await fresh;
  assert.equal(app.evalIn('pendingFetchCount'),0);
});

test('錯誤 body 卡住保留 401；慢錯誤及解析失敗仍結束 loading', { timeout: BOOTSTRAP_TEST_TIMEOUT }, async(t)=>{
  const app=await fixture(t);
  const expired=app.win.fetchApi('/api/trades',{timeoutMs:20}).catch(e=>e);
  app.requests[0].resolve(response(()=>new Promise(()=>{}),401));
  assert.equal((await expired).status,401);
  const failure=app.win.fetchApi('/api/symbols',{timeoutMs:1000}).catch(e=>e);
  let release;
  app.requests[1].resolve(response(()=>new Promise(r=>release=r),422));
  await setImmediate();
  release({error:'明確拒絕',code:'INVALID'});
  assert.equal((await failure).code,'INVALID');
  const invalid=app.win.fetchApi('/api/symbols',{timeoutMs:1000}).catch(e=>e);
  app.requests[2].resolve(response(async()=>{throw new SyntaxError('bad JSON')}));
  assert.match((await invalid).message,/回應|連線/);
  assert.equal(app.evalIn('pendingFetchCount'),0);
});

test('寫入無 headers/成功 body 不完整均屬未確認且不嘗試候選 URL', { timeout: BOOTSTRAP_TEST_TIMEOUT }, async(t)=>{
  const app=await fixture(t);
  app.evalIn('apiCandidates = () => ["/one", "/two"]');
  for(const withHeaders of [false,true]){
    const pending=app.win.fetchApi('/api/trades',{method:'PUT',body:'{}',timeoutMs:20}).catch(e=>e);
    if(withHeaders)app.requests.at(-1).resolve(response(()=>new Promise(()=>{})));
    const error=await pending;
    assert.equal(error.outcomeUnknown,true);
    assert.match(error.message,/尚未確認/);
  }
  assert.equal(app.requests.length,2);
});

test('唯讀 fallback 共用 deadline，慢掃描享有較長預算', { timeout: BOOTSTRAP_TEST_TIMEOUT }, async(t)=>{
  const app=await fixture(t);
  app.evalIn('apiCandidates = () => ["/one", "/two"]');
  const pending=app.win.fetchApi('/api/symbols',{timeoutMs:1000});
  app.requests[0].reject(new Error('offline'));
  await setImmediate();
  app.requests[1].resolve(response(async()=>({ok:true})));
  assert.equal((await pending).ok,true);
  assert.equal(app.win.apiDeadlineMs('/api/overnight?limit=20',{}),600000);
  assert.equal(app.win.apiDeadlineMs('/api/swing/verify',{}),600000);
  assert.equal(app.win.apiDeadlineMs('/api/technical-analysis',{}),180000);
});

test('換搜尋立即 abort 舊請求；舊 finally 不清除新查詢 loading',async(t)=>{
  const app=await fixture(t);
  app.evalIn('searchState.query="old"; searchState.token=1');
  const old=app.win.loadSymbolSearch('old',1);
  app.win.handleSearchInput('new');
  assert.equal(app.requests[0].init.signal.aborted,true);
  await old;
  assert.equal(app.evalIn('searchState.loading'),true);
  app.win.resetSearchState();
});

test('快速切代號取消舊分析，逾時後 loading 釋放可再分析',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render = () => {}; renderTechnicalAnalysis = () => {}; state.technicalCode="2330"');
  const old=app.win.loadTechnicalAnalysis();
  app.evalIn('state.technicalCode="1101"');
  const fresh=app.win.loadTechnicalAnalysis();
  assert.equal(app.requests[0].init.signal.aborted,true);
  await old;
  assert.equal(app.evalIn('technicalState.loading'),true);
  app.requests[1].resolve(response(async()=>({ok:false,error:'新查詢錯誤'})));
  await fresh;
  assert.equal(app.evalIn('technicalState.loading'),false);
  assert.equal(app.evalIn('technicalState.error'),'新查詢錯誤');
});

test('來源切換取消旧行情，舊錯誤不覆蓋新來源與原日期',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render = () => {}; getTrackedQuoteCodes=()=>["2330"]; window.testSource="official"; getSelectedSource=()=>window.testSource; dataState.lastUpdated="10:12:33"');
  const old=app.win.loadMarketData({renderNow:false});
  app.win.testSource='broker';
  const fresh=app.win.loadMarketData({renderNow:false});
  assert.equal(app.requests[0].init.signal.aborted,true);
  await old;
  app.requests[1].resolve(response(async()=>({ok:true,quotes:[],sourceKey:'broker'})));
  await fresh;
  assert.equal(app.evalIn('dataState.mode'),'broker');
});

test('掃描等待逾時不能宣稱 server 採集或計算失敗',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render=()=>{};renderOvernightGroups=()=>{};renderStrategyBoard=()=>{};loadMarketBreadth=async()=>{};showToast=text=>window.lastToast=text;fetchApi=async()=>{throw Object.assign(new Error("等待逾時，伺服器可能仍在處理"),{code:"REQUEST_TIMEOUT"});}');
  await app.win.loadOvernightSignals({notify:true});
  assert.match(app.win.lastToast,/等待逾時|仍在處理/);
  assert.doesNotMatch(app.win.lastToast,/產生失敗/);
  await app.win.loadStrategyBoard({notify:true});
  assert.match(app.win.lastToast,/等待逾時|仍在處理/);
});

test('重疊隔日掃描：舊 finally 不結束新掃描的 loading',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render=()=>{};renderOvernightGroups=()=>{};loadMarketBreadth=async()=>{};showToast=()=>{};');
  const old=app.win.loadOvernightSignals();
  const fresh=app.win.loadOvernightSignals();
  app.requests[0].resolve(response(async()=>({ok:false,error:'舊失敗'})));
  await old;
  assert.equal(app.evalIn('overnightState.loading'),true);
  app.requests[1].resolve(response(async()=>({ok:false,error:'新失敗'})));
  await fresh;
  assert.equal(app.evalIn('overnightState.loading'),false);
  assert.equal(app.evalIn('overnightState.error'),'新失敗');
});
