import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppWindow } from '../helpers/dom-harness.mjs';
import { importServer } from '../helpers/test-server.mjs';
import { rm } from 'node:fs/promises';
let app;
let producer;
before(async () => { producer = await importServer(); app = await createAppWindow({ fetchRoutes: { '/api/trade-plans': { ok: true, rev: 1, plans: [] } } }); });
after(async () => { await app.settle(); app.cleanup(); producer.mock.restore(); await rm(producer.dataDir, { recursive: true, force: true }); });
const json = expression => JSON.parse(app.evalIn(`JSON.stringify(${expression})`));
test('explicit available cash has no implicit capital default and includes buy-fee estimate', () => {
  app.evalIn('savePositionSizing({capital:100000,riskPct:5,availableCash:null})');
  let html = app.evalIn('renderPositionSizeStat({entry:100,structuralStop:99})');
  assert.match(html, /按風險估算/); assert.match(html, /資金未檢查/);
  app.evalIn('savePositionSizing({availableCash:100000})');
  html = app.evalIn('renderPositionSizeStat({entry:100,structuralStop:99})');
  assert.match(html, /999 股/); assert.match(html, /99,985/); assert.match(html, /含買入手續費/);
  app.evalIn('savePositionSizing({availableCash:0})');
  assert.match(app.evalIn('renderPositionSizeStat({entry:100,structuralStop:99})'), /0 股/);
});
test('available cash input preserves zero, stays RAM-only and resets on account switch', () => {
  assert.equal(json('!!document.getElementById("swingAvailableCash")'), true);
  app.evalIn(`document.getElementById('swingAvailableCash').value='12345';document.getElementById('swingAvailableCash').dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(json('positionSizingState.availableCash'), 12345);
  assert.equal(json('localStorage.getItem("stock1.availableCash.v1")'), null);
  app.evalIn(`document.getElementById('swingAvailableCash').focus();activateAuthenticatedUser({id:'t10-other',username:'other'});`);
  assert.equal(json('positionSizingState.availableCash'), null);
  assert.equal(app.evalIn('document.getElementById("swingAvailableCash").value'), '');
});
test('real holding consumer resolves market conflicts and renders partial scenario coverage, breach and plan links safely', () => {
  app.evalIn(`
    tradesState.loaded=true; state.watchList='hold';
    tradesState.portfolio={holdings:[{code:'2330',shares:1000,cost:80000,avgCost:80},{code:'9999',shares:500,cost:25000,avgCost:50}],totals:{cost:105000},realized:[]};
    tradesState.records=[{code:'2330',market:'TWSE'}];
    tradePlansState.loaded=true;
    tradePlansState.plans=[{planId:'p-safe',code:'2330',exchange:'TWSE',status:'active',stopPrice:95,quantity:400,expiresOn:'2099-01-01'}];
    stocks.length=0; upsertStockFromQuote({code:'2330',exchange:'TWSE',source:'TWSE OpenAPI',name:'台積電',price:100,sourceKind:'daily-close',asOf:'2026/09/04'});
  `);
  const r = json(`buildHoldingsPlanRisk('2026-09-06T04:00:00Z')`);
  assert.equal(r.knownRiskCash, 2000); assert.equal(r.coverage.unknownShares, 1100); assert.equal(r.coverage.totalValue, null);
  const html = app.evalIn(`renderPortfolioPlanRisk(buildHoldingsPlanRisk('2026-09-06T04:00:00Z'))`);
  assert.match(html, /計畫股數情境/); assert.match(html, /600 股/); assert.match(html, /無法確認最新交易日/);
  assert.match(html, /2026\/09\/06 12:00:00（台北）/); assert.doesNotMatch(html, /T04:00:00Z/);
  assert.match(html, /<summary>估算方式與限制<\/summary>/);
  assert.match(html, /data-holding-plan-id="p-safe"/); assert.doesNotMatch(html, /安全|最大虧損/);
  app.evalIn(`tradesState.records.push({code:'2330',market:'TPEx'})`);
  assert.ok(json(`buildHoldingsPlanRisk('2026-09-06T04:00:00Z').unknown[0].reasons`).includes('market-conflict'));
  const escaped = app.evalIn(`renderPortfolioPlanRisk({asOf:'<img src=x onerror=1>',knownRiskCash:null,riskPct:null,coverage:{shares:1,coveredShares:0,unknownShares:1,totalValue:null},breached:[],unknown:[],positions:[{code:'<img src=x>',shares:1,unknownShares:1,coveredShares:0,reasons:['quote-missing'],planIds:['" onclick="x'],quoteAsOf:'<script>x</script>'}],concentration:{byIndustry:[],byCode:[]}})`);
  app.evalIn(`window.riskEscapingProbe=document.createElement('div');riskEscapingProbe.innerHTML=${JSON.stringify(escaped)}`);
  assert.equal(json(`riskEscapingProbe.querySelectorAll('img,script,[onclick]').length`), 0);
});
test('holding risk warning has no suggested global threshold and states who set it', () => {
  const r = { asOf:'2026-09-06',knownRiskCash:5000,riskPct:5,coverage:{shares:1000,coveredShares:1000,unknownShares:0,totalValue:100000,marketValuePct:100},breached:[],unknown:[],positions:[],concentration:{byIndustry:[],byCode:[]} };
  app.evalIn('holdingsPlanRiskState.alertPct=null');
  assert.match(app.evalIn(`renderPortfolioPlanRisk(${JSON.stringify(r)})`), /未設定警示值/);
  app.evalIn('holdingsPlanRiskState.alertPct=4');
  assert.match(app.evalIn(`renderPortfolioPlanRisk(${JSON.stringify(r)})`), /你設定的 4%/);
});
test('real MIS missing-price producer cannot freshen retained display price after quote merge', () => {
  const missing = producer.mod.normalizeMisQuote({ c: '2330', ex: 'tse', d: '20260907', t: '10:00:00', z: '-', pz: '-', oz: '-' }, undefined);
  assert.equal(missing.price, null); assert.equal(missing.priceStale, false);
  app.evalIn(`
    document.activeElement?.blur();
    tradesState.portfolio={holdings:[{code:'2330',shares:1000,cost:80000,avgCost:80}],totals:{},realized:[]};
    tradesState.records=[{code:'2330',market:'TWSE'}];
    tradePlansState.loaded=true;tradePlansState.plans=[{planId:'atomic-price',code:'2330',exchange:'TWSE',status:'active',quantity:1000,stopPrice:95,expiresOn:'2026-09-07'}];
    stocks.length=0;stocks.push({code:'2330',price:100,spark:[100],strategies:[],groups:[]});
    mergeOfficialQuote(stocks[0],${JSON.stringify(missing)});
  `);
  assert.equal(json('stocks[0].price'), 100, 'preserve existing display fallback contract');
  let risk = json(`buildHoldingsPlanRisk('2026-09-07T02:00:00Z')`);
  assert.equal(risk.knownRiskCash, null); assert.equal(risk.coverage.totalValue, null);
  assert.ok(risk.unknown[0].reasons.includes('quote-missing'));
  const fresh = producer.mod.normalizeMisQuote({ c: '2330', ex: 'tse', d: '20260907', t: '10:00:00', z: '101' }, undefined);
  app.evalIn(`upsertStockFromQuote(${JSON.stringify(fresh)});`);
  risk = json(`buildHoldingsPlanRisk('2026-09-07T02:00:00Z')`);
  assert.equal(risk.knownRiskCash, 6000); assert.equal(risk.coverage.totalValue, 101000);
  app.evalIn(`mergeOfficialQuote(stocks[0],${JSON.stringify(missing)});`);
  assert.equal(json('stocks[0].price'), 101);
  assert.equal(json(`buildHoldingsPlanRisk('2026-09-07T02:00:00Z').knownRiskCash`), null, 'another missing quote invalidates the latest risk price too');
});
test('account switch and 401 erase already-rendered cash checks from hidden strategy DOM', () => {
  const pick = { code:'2330',name:'台積電',exchange:'TWSE',price:100,changePct:1,score:80,scenario:{key:'midBandDefense',name:'中軌攻防'},plan:{entry:100,structuralStop:99,initialStop:95,trailingTrigger:105,target:110,rr:2},reasons:[],warnings:[] };
  for (const operation of [`activateAuthenticatedUser({id:'risk-account-b',username:'b'});render();`, `handleAuthRequired({status:401,code:'AUTH_REQUIRED',message:'登入已到期'});`]) {
    app.evalIn(`
      activateAuthenticatedUser({id:'risk-account-a',username:'a'});
      strategyState.loaded=true;strategyState.loading=false;strategyState.error='';strategyState.picks=[${JSON.stringify(pick)}];strategyState.scenario='midBandDefense';
      savePositionSizing({capital:100000,riskPct:5,availableCash:12345});
      state.screen='strategy';render();state.screen='more';render();
    `);
    assert.match(app.evalIn('el.strategyBoard.textContent'), /已按你提供的 12,345 檢查/);
    assert.match(app.evalIn('el.strategyBoard.textContent'), /123 股/);
    app.evalIn(operation);
    assert.equal(json('positionSizingState.availableCash'), null);
    assert.equal(json(`(() => {const dom=document.body.cloneNode(true);dom.querySelectorAll('script,style').forEach(node=>node.remove());return /12,345|12,320|已按你提供的/.test(dom.textContent)})()`), false, 'all rendered DOM, including hidden pages, must discard the previous account cash check');
    assert.equal(json(`document.querySelectorAll('.swing-stat-size').length`), 0, 'hidden cash-dependent quantities and fees must be removed together');
    app.evalIn(`closeDialogLayer(document.getElementById('loginGate'));`);
  }
});
