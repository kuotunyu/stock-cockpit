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

// ===== 2026-09-09 CUA-05（computer use 心得 F05）：長查詢等待要讓人知道經過多久、現在能做什麼 =====
// 舊文案「第一次約需 10–30 秒」「數十秒」「十幾秒」是硬承諾，實測隔日沖 1 分 41 秒、策略 2 分多；
// 逾時後也沒有重試入口。這裡只加純顯示的 startedAt／經過秒數與重試按鈕，不新增 server progress、不改 600 秒 deadline。

test('scanWaitText：30 秒前說可先做別的事、不寫秒數；超過 30 秒改說等待較久並附經過秒數',async(t)=>{
  const app=await fixture(t);
  const at=(seconds)=>app.evalIn(`scanWaitText(1000000, 1000000 + ${seconds} * 1000)`);
  assert.match(at(0),/可先搜尋股票或使用其他頁面/);
  assert.doesNotMatch(at(0),/秒/);
  assert.match(at(29),/可先搜尋股票或使用其他頁面/);
  assert.doesNotMatch(at(29),/等待較久|已等/);
  assert.match(at(31),/等待較久/);
  assert.match(at(31),/已等 31 秒/);
  assert.match(at(31),/其他頁面/);
  for(const text of [at(0),at(31)]){ assert.doesNotMatch(text,/10–30 秒|數十秒|十幾秒|直接用快取/,'不得再有硬承諾'); }
});

test('隔日沖／策略／回測的載入畫面不再寫硬承諾，並帶單一經過時間節點',async(t)=>{
  const app=await fixture(t);
  app.evalIn('loadMarketBreadth=async()=>{};showToast=()=>{};loadSwingVerify=()=>{};renderSwingVerifyPanel=()=>{};');
  const parsed=JSON.parse(app.evalIn(`JSON.stringify((() => {
    // 複審 N9：startedAt 與渲染都以同一個釘住的時鐘為準，不依賴真實經過時間。
    const realNow = Date.now; Date.now = () => 1700000000000;
    try {
    Object.assign(overnightState,{loading:true,loaded:false,error:'',startedAt:Date.now()-5000});
    state.overnightView='overview'; state.screen='overnight';
    renderOvernightGroups();
    Object.assign(strategyState,{loading:true,loaded:false,error:'',startedAt:Date.now()-5000});
    renderStrategyBoard();
    Object.assign(backtestState,{loading:true,loaded:false,error:''});
    return { overnight: el.overnightGroups.innerHTML, strategy: el.strategyBoard.innerHTML, backtest: renderBacktestPerformance() };
      } finally { Date.now = realNow; }
  })())`));
  for(const [key,fragment] of Object.entries(parsed)){
    assert.doesNotMatch(fragment,/10–30 秒|數十秒|十幾秒|當天會直接用快取|之後有快取/,`${key} 不得再有硬承諾`);
  }
  assert.match(parsed.overnight,/data-scan-wait="overnight"/);
  assert.match(parsed.overnight,/可先搜尋股票或使用其他頁面/);
  assert.match(parsed.strategy,/data-scan-wait="strategy"/);
  assert.match(parsed.strategy,/中軌攻防|上軌續攻/);
  app.evalIn('stopScanWaitTimer("overnight");stopScanWaitTimer("strategy");Object.assign(overnightState,{loading:false,startedAt:0});Object.assign(strategyState,{loading:false,startedAt:0});Object.assign(backtestState,{loading:false});');
});

test('經過時間只改單一節點的文字：健檢輸入框的值與焦點不受每秒更新影響',async(t)=>{
  const app=await fixture(t);
  app.evalIn('loadSwingVerify=()=>{};renderSwingVerifyPanel=()=>{};');
  const result=JSON.parse(app.evalIn(`JSON.stringify((() => {
    // 複審 N9：startedAt 與渲染都以同一個釘住的時鐘為準，不依賴真實經過時間。
    const realNow = Date.now; Date.now = () => 1700000000000;
    try {
    Object.assign(strategyState,{loading:true,loaded:false,error:'',startedAt:Date.now()-40000});
    state.screen='strategy';
    renderStrategyBoard();
    const input=document.getElementById('strategyInspectInput');
    input.value='2330 草稿'; input.focus();
    const before=el.strategyBoard.querySelector('[data-scan-wait="strategy"]').textContent;
    const boardNode=el.strategyBoard.firstElementChild;
    scanWaitTick('strategy', strategyState.startedAt + 65000);
    const after=el.strategyBoard.querySelector('[data-scan-wait="strategy"]').textContent;
    const out={before,after,sameNode:el.strategyBoard.firstElementChild===boardNode,value:input.value,focused:document.activeElement===input};
    stopScanWaitTimer('strategy');Object.assign(strategyState,{loading:false,startedAt:0});
    return out;
      } finally { Date.now = realNow; }
  })())`));
  assert.match(result.before,/已等 40 秒/);
  assert.match(result.after,/已等 65 秒/);
  assert.equal(result.sameNode,true,'每秒更新不得重建整個看板');
  assert.equal(result.value,'2330 草稿');
  assert.equal(result.focused,true);
});

test('startedAt 只由最新請求設定；遲到的舊 finally 不清新請求的 startedAt，完成後才歸零',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render=()=>{};renderOvernightGroups=()=>{};loadMarketBreadth=async()=>{};showToast=()=>{};');
  const old=app.win.loadOvernightSignals();
  const startedOld=app.evalIn('overnightState.startedAt');
  assert.ok(startedOld>0,'開始請求要記 startedAt');
  await setImmediate();
  const fresh=app.win.loadOvernightSignals();
  const startedFresh=app.evalIn('overnightState.startedAt');
  assert.ok(startedFresh>=startedOld);
  app.requests[0].resolve(response(async()=>({ok:false,error:'舊失敗'})));
  await old;
  assert.equal(app.evalIn('overnightState.startedAt'),startedFresh,'舊 finally 不得清掉新請求的 startedAt');
  app.requests[1].resolve(response(async()=>({ok:false,error:'新失敗'})));
  await fresh;
  assert.equal(app.evalIn('overnightState.startedAt'),0,'完成後歸零');
  assert.equal(app.evalIn('scanWaitTimers.has("overnight")'),false,'完成後計時器要清掉');
});

test('逾時：畫面說伺服器可能仍在處理並提供重試按鈕；重試是使用者操作，不自動循環',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render=()=>{};loadMarketBreadth=async()=>{};showToast=()=>{};loadSwingVerify=()=>{};renderSwingVerifyPanel=()=>{};state.overnightView="overview";state.screen="overnight";');
  const pending=app.win.loadOvernightSignals();
  app.requests[0].reject(Object.assign(new Error('等待回應逾時，可再試一次；伺服器可能仍在處理'),{code:'REQUEST_TIMEOUT'}));
  await pending;
  const view=JSON.parse(app.evalIn(`JSON.stringify({ html: el.overnightGroups.innerHTML, code: overnightState.errorCode, requests: ${app.requests.length} })`));
  assert.equal(view.code,'REQUEST_TIMEOUT');
  assert.match(view.html,/等待逾時/);
  assert.match(view.html,/伺服器可能仍在處理/);
  assert.match(view.html,/data-overnight-retry/);
  assert.doesNotMatch(view.html,/npm start/,'逾時不是啟動失敗，不要叫人去檢查 npm start');
  const requestsBefore=app.requests.length;
  await setImmediate();
  assert.equal(app.requests.length,requestsBefore,'逾時後不得零秒自動重送');
  app.evalIn(`el.overnightGroups.querySelector('[data-overnight-retry]').click()`);
  await setImmediate();
  assert.equal(app.requests.length,requestsBefore+1,'按重試才再送一次');
  assert.equal(app.evalIn('overnightState.loading'),true);
  const retrying=app.evalIn('el.overnightGroups.innerHTML');
  assert.match(retrying,/is-loading/,'按重試後要立刻看到等待狀態');
  assert.doesNotMatch(retrying,/data-overnight-retry/,'逾時卡與重試按鈕不得在請求期間原地不動');
  app.requests.at(-1).resolve(response(async()=>({ok:false,error:'重試仍失敗'})));
  await setImmediate();await setImmediate();
  const strategy=app.win.loadStrategyBoard();
  app.requests.at(-1).reject(Object.assign(new Error('等待回應逾時'),{code:'REQUEST_TIMEOUT'}));
  await strategy;
  const strategyHtml=app.evalIn('el.strategyBoard.innerHTML');
  assert.match(strategyHtml,/等待逾時/);
  assert.match(strategyHtml,/data-strategy-retry/);
  const n=app.requests.length;
  app.evalIn(`el.strategyBoard.querySelector('[data-strategy-retry]').click()`);
  await setImmediate();
  assert.equal(app.requests.length,n+1,'策略重試也是使用者操作才送');
  app.requests.at(-1).resolve(response(async()=>({ok:false,error:'x'})));
  await setImmediate();await setImmediate();
});

test('更多→重新整理資料：隔日沖掃描進行中不重複啟動第二次掃描',async(t)=>{
  const app=await fixture(t);
  app.evalIn('render=()=>{};renderOvernightGroups=()=>{};loadMarketBreadth=async()=>{};loadMarketSummary=async()=>{};loadMarketData=async()=>{};window.toasts=[];showToast=(text)=>window.toasts.push(text);');
  const pending=app.win.loadOvernightSignals();
  const before=app.requests.length;
  app.evalIn(`document.body.insertAdjacentHTML('beforeend','<button id="tmpRefresh" data-action="refresh-data" type="button">重新抓目前來源</button>'); document.getElementById('tmpRefresh').click(); document.getElementById('tmpRefresh').remove();`);
  await setImmediate();
  assert.equal(app.requests.length,before,'進行中不得再送隔日沖請求');
  assert.ok(app.evalIn('window.toasts.some(t=>/仍在產生|進行中/.test(t))'),'要告訴使用者掃描仍在進行');
  app.requests[0].resolve(response(async()=>({ok:false,error:'結束'})));
  await pending;
});
