import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { importServer } from '../helpers/test-server.mjs';
const { mod, mock, dataDir } = await importServer();
after(async () => { mock.restore(); await rm(dataDir, { recursive: true, force: true }); });
// Explicit asOf is part of this pure contract; fixed weekday dates never consult wall time.
const asOf = '2026-09-07T02:00:00.000Z';
const position = { code: '2330', exchange: 'TWSE', shares: 1000, avgCost: 80 };
const plan = { planId: 'p1', code: '2330', exchange: 'TWSE', status: 'active', stopPrice: 95, quantity: 1000, expiresOn: '2026-09-07' };
const quote = { code: '2330', exchange: 'TWSE', official: true, source: 'TWSE OpenAPI', price: 100, sourceKind: 'realtime', asOf: '2026/09/07 10:00:00', industry: '半導體' };
const input = (extra = {}) => ({ positions: [position], plans: [plan], quotes: [quote], capitalBasis: 100000, costPolicy: { basis: 'gross-mark-to-stop' }, asOf, session: { date: '2026-09-07', tradingDay: true }, ...extra });
const risk = (extra) => { assert.equal(typeof mod.calculatePortfolioPlanRisk, 'function'); return mod.calculatePortfolioPlanRisk(input(extra)); };
test('mark-to-current-stop ignores original cost and immutable activation; expiry includes full Taipei day', () => {
  assert.equal(mod.calculatePortfolioPlanRisk, globalThis.Stock1Risk.calculatePortfolioPlanRisk);
  const r = risk({ plans: [{ ...plan, activation: { riskAmount: 99000, intent: { stopPrice: 50 } } }] });
  assert.equal(r.knownRiskCash, 5000); assert.equal(r.riskPct, 5);
  assert.equal(r.coverage.coveredShares, 1000); assert.equal(r.coverage.unknownShares, 0);
  assert.equal(r.coverage.totalValue, 100000); assert.equal(r.positions[0].quoteAsOf, quote.asOf);
  assert.equal(r.unknown.length, 0); assert.equal(r.breached.length, 0);
});
test('missing stop and expired plans are unknown, not zero risk', () => {
  for (const p of [{ ...plan, stopPrice: null }, { ...plan, expiresOn: '2026-09-06' }]) {
    const r = risk({ plans: [p] }); assert.equal(r.knownRiskCash, null); assert.equal(r.riskPct, null);
    assert.equal(r.coverage.unknownShares, 1000); assert.equal(r.unknown.length, 1);
  }
});
test('breached stop never becomes a safe zero', () => {
  const r = risk({ quotes: [{ ...quote, price: 90 }] });
  assert.equal(r.breached.length, 1); assert.equal(r.knownRiskCash, null);
  assert.equal(r.coverage.unknownShares, 1000); assert.ok(r.unknown[0].reasons.includes('stop-breached'));
});
test('missing, stale, future and undated quotes make market-value denominator unknown', () => {
  for (const quotes of [[], [{ ...quote, asOf: '2026/09/07 09:55:00' }], [{ ...quote, asOf: '2026/09/07 10:01:00' }], [{ ...quote, asOf: '' }], [{ ...quote, price: null }]]) {
    const r = risk({ quotes }); assert.equal(r.coverage.totalValue, null); assert.equal(r.concentration.denominatorKnown, false);
    assert.equal(r.knownRiskCash, null); assert.equal(r.coverage.marketValuePct, null);
  }
});
test('weekend accepts dated Friday official close reference without guessing latest trading day', () => {
  const r = risk({ asOf: '2026-09-06T04:00:00Z', session: { date: '2026-09-06', tradingDay: false }, quotes: [{ ...quote, priceStale: true, sourceKind: 'daily-close', asOf: '2026/09/04' }] });
  assert.equal(r.knownRiskCash, 5000); assert.equal(r.positions[0].quoteMode, 'close');
  assert.equal(r.positions[0].recency, 'unknown');
  assert.equal(risk({ asOf: '2026-09-06T04:00:00Z', quotes: [{ ...quote, sourceKind: 'daily-close', asOf: '2026/09/03' }] }).positions[0].recency, 'unknown');
  assert.equal(risk({ quotes: [{ ...quote, priceStale: true, sourceKind: 'daily-close', asOf: '2026/09/04' }] }).knownRiskCash, null);
});
test('single plan only bounds scenario coverage, excess holding remains unknown', () => {
  const r = risk({ plans: [{ ...plan, quantity: 400 }] });
  assert.equal(r.knownRiskCash, 2000); assert.equal(r.coverage.coveredShares, 400); assert.equal(r.coverage.unknownShares, 600);
  assert.ok(r.unknown[0].reasons.includes('quantity-uncovered'));
  assert.equal(risk({ plans: [{ ...plan, quantity: 1500 }] }).coverage.coveredShares, 1000);
});
test('multiple current plans conflict without selecting the highest stop; expired extra is ignored', () => {
  const r = risk({ plans: [plan, { ...plan, planId: 'p2', stopPrice: 98 }] });
  assert.equal(r.knownRiskCash, null); assert.ok(r.unknown[0].reasons.includes('plan-conflict'));
  assert.deepEqual(r.unknown[0].planIds, ['p1', 'p2']);
  assert.equal(risk({ plans: [plan, { ...plan, planId: 'p2', expiresOn: '2026-09-06' }] }).knownRiskCash, 5000);
});
test('import historical uncertainty does not erase current explicit stop', () => {
  assert.equal(risk({ plans: [{ ...plan, provenance: { kind: 'imported', historicalEvidence: 'unverified' } }] }).knownRiskCash, 5000);
});
test('code grouping preserves market ambiguity and independent unknown industry group', () => {
  const r = risk({ positions: [{ ...position, shares: 400 }, { ...position, shares: 600 }], quotes: [{ ...quote, industry: null }] });
  assert.equal(r.positions.length, 1); assert.equal(r.concentration.byCode[0].value, 100000);
  assert.equal(r.concentration.byIndustry[0].industry, null);
  const conflict = risk({ positions: [position, { ...position, exchange: 'TPEx' }] });
  assert.ok(conflict.unknown[0].reasons.includes('market-conflict')); assert.equal(conflict.coverage.totalValue, null);
});
test('zero holdings and missing capital retain distinct empty/undefined denominators', () => {
  const empty = risk({ positions: [{ ...position, shares: 0 }] });
  assert.equal(empty.knownRiskCash, 0); assert.equal(empty.coverage.totalValue, 0); assert.equal(empty.coverage.shares, 0);
  assert.equal(risk({ capitalBasis: null }).riskPct, null);
});
test('malformed date/time/offset source inputs become unknown instead of throwing', () => {
  for (const date of ['2026-99-01', '2026-02-30', '2026-09-07T24:00:00', '2026-09-07T10:00:00+99:00', '2026-09-07T10:60:00']) {
    assert.equal(risk({ quotes: [{ ...quote, asOf: date }] }).knownRiskCash, null);
  }
});
test('real daily producer needs no synthetic official flag; unknown/fallback sources cannot claim official close date', () => {
  const close = mod.normalizeDailyTwse({ Code: '2330', Name: '台積電', Date: '20260904', ClosingPrice: '100', Change: '1' });
  assert.equal(close.official, undefined);
  assert.equal(risk({ asOf: '2026-09-06T04:00:00Z', quotes: [close] }).knownRiskCash, 5000);
  for (const bad of [{ ...close, official: true, source: 'Yahoo' }, { ...close, official: true, sourceKind: 'realtime', source: 'TWSE MIS', priceStale: true }]) {
    assert.equal(risk({ asOf: '2026-09-06T04:00:00Z', quotes: [bad] }).knownRiskCash, null);
  }
});
test('new-order size obeys explicit cash including rounded minimum buy fee and integer units', () => {
  assert.equal(typeof mod.calculateNewPositionSize, 'function');
  const base = { capital: 100000, riskPct: 1, entry: 100, stop: 99, availableCash: 100000, costPolicy: { feeDiscount: 0.6, minFee: 20 } };
  const r = mod.calculateNewPositionSize(base);
  assert.ok(r.shares <= 999); assert.ok(r.requiredCash <= 100000); assert.ok(r.initialRiskCash <= 1000);
  assert.equal(mod.calculateNewPositionSize({ ...base, riskPct: 5 }).shares, 999);
  assert.equal(mod.calculateNewPositionSize({ ...base, riskPct: 5, unitShares: 1000 }).shares, 0);
  assert.equal(mod.calculateNewPositionSize({ ...base, availableCash: 119 }).shares, 0);
  assert.equal(mod.calculateNewPositionSize({ ...base, availableCash: 120 }).shares, 1);
  assert.equal(mod.calculateNewPositionSize({ ...base, availableCash: 0 }).shares, 0);
  assert.equal(mod.calculateNewPositionSize({ ...base, availableCash: null }).cashChecked, false);
});
test('tiny-order minimum fee affects risk limit as well as affordability; invalid costs cannot pass', () => {
  const base = { capital: 1000, riskPct: 1, entry: 100, stop: 99, availableCash: 1000, costPolicy: { feeDiscount: 0.6, minFee: 20 } };
  assert.equal(mod.calculateNewPositionSize(base).shares, 0);
  assert.equal(mod.calculateNewPositionSize({ ...base, costPolicy: { feeDiscount: null, minFee: 20 } }), null);
});
