// 含息持有貨幣計算：保存原始投入、顯式成本、事件資格與零碎股證據。
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { importServer } from '../helpers/test-server.mjs';
import { compactTradingDay } from '../helpers/fixtures.mjs';
let mod;
before(async () => { ({ mod } = await importServer({ routes: [] })); });
const D0 = compactTradingDay(-3), D1 = compactTradingDay(-2), D2 = compactTradingDay(-1), D3 = compactTradingDay(0);
const initialPosition = { date: D0, price: 100, shares: 1, source: 'explicit-fixture', originalStop: 95 };
const zero = { model: 'explicit-cash-fees-v1', buyFee: 0, sellFee: 0, tax: 0, source: 'explicit-fixture' };
const cash = { id: 'cash-1', exDate: D1, kind: 'cash-dividend', cashDividend: 5, source: 'confirmed-fixture' };
const calc = (over = {}) => mod.calculateHoldingOutcome({ initialPosition, eventCoverage: 'complete', exit: { date: D2, price: 104.5 }, events: [], costs: zero, ...over });
test('100 買 1 股、配 5、104.5 賣：不再投入為 9.5%，價格比例法另為 10%', () => {
  const result = calc({ events: [cash] });
  assert.equal(result.status, 'complete'); assert.equal(result.netPnl, 9.5); assert.equal(result.holdingReturnPct, 9.5);
  assert.equal(result.evidence.initialInvestment, 100); assert.equal(result.evidence.originalRiskMoney, 5);
  assert.equal((104.5 / 95 - 1) * 100 > 9.99, true);
});
test('無事件、零與負值以及成本分母皆以手算核對', () => {
  assert.equal(calc().holdingReturnPct, 4.5);
  assert.equal(calc({ exit: { date: D2, price: 100 } }).netPnl, 0);
  assert.equal(calc({ exit: { date: D2, price: 90 } }).holdingReturnPct, -10);
  const fees = calc({ costs: { ...zero, buyFee: 1, sellFee: 2, tax: 0.5 } });
  assert.equal(fees.netPnl, 1); assert.equal(fees.evidence.initialInvestment, 101);
  assert.equal(fees.holdingReturnPct, 100 / 101);
});
test('費用缺一項或未知股數不得假造 0；近似總成本獨立分母', () => {
  for (const key of ['buyFee','sellFee','tax']) {
    const costs = { ...zero }; delete costs[key];
    assert.equal(calc({ costs }).netPnl, null);
  }
  assert.equal(calc({ initialPosition: { ...initialPosition, shares: null } }).status, 'unpriced');
  const flat = calc({ costs: { model: 'initial-notional-flat-total-v1', total: 0.471, source: 'assumed' } });
  assert.equal(flat.netPnl, 4.029); assert.equal(flat.evidence.initialInvestment, 100);
});
test('應收轉支付只改分類；同日重跑與重複事件不加倍', () => {
  const receivable = calc({ events: [cash, cash] });
  const paid = calc({ events: [{ ...cash, paymentDate: D2 }] });
  assert.equal(receivable.netPnl, 9.5); assert.equal(receivable.evidence.cashReceivable, 5);
  assert.equal(paid.netPnl, 9.5); assert.equal(paid.evidence.cashPaid, 5); assert.equal(paid.evidence.cashReceivable, 0);
  assert.deepEqual(calc({ events: [cash, cash] }), receivable);
});
test('事件當日／事件後進場不配息，事件後出場有資格；撤回版本移除原權益', () => {
  for (const date of [D1, D2]) assert.equal(calc({ initialPosition: { ...initialPosition, date }, events: [cash] }).netPnl, 4.5);
  assert.equal(calc({ events: [{ ...cash, exDate: D3 }] }).netPnl, 4.5);
  assert.equal(calc({ events: [cash, { ...cash, revision: 2, status: 'withdrawn' }] }).netPnl, 4.5);
});
test('可證整股配發與零碎結算：不 floor、不虛構零碎股市值', () => {
  const stock = { id:'stock-1', exDate:D1, kind:'stock-dividend', stockRatio:0.1, source:'fixture' };
  const p = { ...initialPosition, shares:10 };
  const confirmed = calc({ initialPosition:p, events:[{ ...stock, stockSettlement:{ shares:1, cashInLieu:0, source:'confirmed', availableDate:D1 } }] });
  assert.equal(confirmed.netPnl, 149.5); assert.equal(confirmed.evidence.finalShares, 11);
  assert.equal(calc({ events:[stock] }).status, 'unpriced');
  assert.equal(calc({ initialPosition:p, events:[stock] }).status, 'unpriced');
  const fractional = calc({ events:[{ ...stock, stockSettlement:{ shares:0, cashInLieu:10, source:'confirmed', availableDate:D1 } }] });
  assert.equal(fractional.netPnl, 14.5);
});
test('現增參與須有股數／投入證據；追加投入僅絕對損益，不編多時點報酬', () => {
  const rights = { id:'rights-1', exDate:D1, kind:'subscription', source:'fixture' };
  assert.equal(calc({ events:[rights] }).status, 'unpriced');
  assert.equal(calc({ events:[{ ...rights, participation:false }] }).holdingReturnPct, 4.5);
  const joined = calc({ events:[{ ...rights, participation:true, subscriptionShares:1, subscriptionInvestment:80, subscriptionAvailableDate:D1 }] });
  assert.equal(joined.netPnl, 29); assert.equal(joined.holdingReturnPct, null);
  assert.ok(joined.missingReasons.includes('multiple-cash-flow-return-undefined'));
});
test('不支援事件不產生淨值，未知現金配發不當作 0', () => {
  assert.equal(calc({ events:[{ id:'x', exDate:D1, kind:'merger', source:'fixture' }] }).status, 'unsupported');
  assert.equal(calc({ events:[{ ...cash, cashDividend:null }] }).netPnl, null);
});
test('新模型鎖定原始部位與所有出場分支；舊價格模型 pending 保持身份可續驗', () => {
  const identity = mod.currentVerificationIdentity('swing');
  assert.equal(identity.returnBasis, 'cash-holding-return');
  const old = { ...identity, evaluationVersion:'swing-price-observation-v1', returnBasis:'adjusted-reference-price', costModelVersion:'flat-round-trip-0.471pct-v1' };
  const e = { identity:old, status:'pending', entry:100, stop:95, target:110, daysHeld:0, lastChecked:D0 };
  mod.advanceSwingVerificationEntry(e, { rawDate:D1, open:100, high:111, low:99, price:109 });
  assert.equal(e.resultPct,10); assert.deepEqual(e.identity,old); assert.equal(e.holdingOutcome,undefined);
});
test('公司行動調整只移價格；新模型原始風險與現金股利不重複', () => {
  const e = { identity:mod.currentVerificationIdentity('swing'), status:'pending', code:'2330', entry:100, stop:95, target:110,
    daysHeld:0, lastChecked:D0, holdingPosition:{ ...initialPosition, quantitySource:'normalized-one-share-assumption-v1' },
    holdingEvents:[cash], holdingCoverage:[{ date:D1, status:'complete' }] };
  mod.applySwingCorporateAction(e,0.95,D1); mod.applySwingCorporateAction(e,0.95,D1);
  assert.equal(e.entry,95);
  mod.advanceSwingVerificationEntry(e,{ rawDate:D1, open:100, high:104.5, low:99, price:104.5 });
  assert.equal(e.resultPct,10); assert.equal(e.exit.price,104.5);
  assert.equal(e.holdingOutcome.netPnl,9.029); assert.equal(e.holdingOutcome.evidence.originalRiskMoney,5);
});
test('明確coverage必填；只有價格比率為1仍可能有現增，不能視為沒事件', () => {
  assert.equal(mod.calculateHoldingOutcome({initialPosition,exit:{date:D2,price:100},events:[],costs:zero}).netPnl,null);
  const result=calc({events:[{id:'ratio-one',exDate:D1,kind:'dividend',source:'official',cashDividend:0,stockRatio:0,subscriptionRatio:0.1,subscriptionPrice:100}]});
  assert.ok(Math.abs((100+100*0.1)/(1+0.1)-100)<1e-10);
  assert.equal(result.status,'unpriced');
});
test('後續股利使用事件前已配發股數；原始position不改寫', () => {
  const position={...initialPosition,shares:10}; const before=structuredClone(position);
  const events=[{id:'stock',exDate:D1,kind:'stock-dividend',source:'confirmed',stockSettlement:{shares:1,cashInLieu:0,source:'confirmed',availableDate:D1}},
    {...cash,id:'later-cash',exDate:D2}];
  const result=calc({initialPosition:position,exit:{date:D3,price:100},events});
  assert.equal(result.evidence.events[1].eligibleShares,11);assert.equal(result.netPnl,155);assert.deepEqual(position,before);
});
test('每個價格結案分支都保留實際出場價；缺股數的新identity不補成1股', () => {
  for (const [quote,daysHeld,exit] of [[{open:94,high:96,low:93,price:95},0,94],[{open:112,high:113,low:94,price:100},0,112],
    [{open:100,high:111,low:94,price:99},0,95],[{open:100,high:111,low:98,price:109},0,110],[{open:100,high:104,low:96,price:103},14,103]]) {
    const e={identity:mod.currentVerificationIdentity('swing'),status:'pending',entry:100,stop:95,target:110,lastChecked:D0,daysHeld};
    mod.advanceSwingVerificationEntry(e,{rawDate:D1,...quote});assert.equal(e.exit.price,exit);assert.equal(e.holdingOutcome.netPnl,null);
  }
});
test('新股交付日期缺失／晚於退出不得按退出價格變現',()=>{
  for(const availableDate of [undefined,D3]) {
    const stock={id:'late',exDate:D1,kind:'stock-dividend',source:'confirmed',stockSettlement:{shares:1,cashInLieu:0,source:'confirmed',availableDate}};
    assert.equal(calc({events:[stock]}).netPnl,null);
    const subscription={id:'late-rights',exDate:D1,kind:'subscription',source:'confirmed',participation:true,subscriptionShares:1,subscriptionInvestment:80,subscriptionAvailableDate:availableDate};
    assert.equal(calc({events:[subscription]}).netPnl,null);
  }
});
test('退出為今天仍不得用今天補造缺少的進場／配發／支付日期',()=>{
  assert.equal(calc({initialPosition:{...initialPosition,date:undefined},exit:{date:D3,price:100}}).status,'unpriced');
  const receivable=calc({events:[cash],exit:{date:D3,price:100}});assert.equal(receivable.evidence.cashPaid,0);assert.equal(receivable.evidence.cashReceivable,5);
  const stock={id:'date-missing',exDate:D1,kind:'stock-dividend',source:'fixture',stockSettlement:{shares:1,cashInLieu:0,source:'fixture'}};
  assert.equal(calc({events:[stock],exit:{date:D3,price:100}}).netPnl,null);
});
