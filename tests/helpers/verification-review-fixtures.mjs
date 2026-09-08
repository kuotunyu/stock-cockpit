// O07 僅用合成資料呼叫既有摘要，輸出可人工核對的五種觀察品質案例。
import { pathToFileURL } from 'node:url';

const ISO_DAY = value => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
const TRADE_DAY = '20260803';
const FULL_SESSIONS = [
  '20260803', '20260804', '20260805', '20260806', '20260807', '20260810',
  '20260811', '20260812', '20260813', '20260814', '20260817', '20260818',
  '20260819', '20260820', '20260821', '20260824',
];
const FULL_CALENDAR = {
  tradingDays: FULL_SESSIONS,
  coveredMonths: ['202608'],
  through: '20260824',
  source: 'TWSE-FMTQIK-official-monthly-sessions',
  reason: null,
  monthEvidence: {
    202608: {
      source: 'TWSE FMTQIK',
      requestedAt: '2026-08-25T00:00:00.000Z',
      observedAt: '2026-08-25T00:00:00.000Z',
      coveredFrom: '20260801',
      coveredThrough: '20260824',
      completeMonth: false,
      status: 'fresh',
    },
  },
};

function candidate(code, exchange, rank) {
  return { code, exchange, candidateRank: rank, price: 100, source: `${exchange} OpenAPI`, sourceAsOf: ISO_DAY(TRADE_DAY) };
}

function captureFixture(mod, { id, strategy, identity, candidates, issued, status = issued.length ? 'complete' : 'complete-zero' }) {
  const capture = {
    captureId: id,
    inputFingerprint: `${id}-input`,
    strategy,
    tradeDate: ISO_DAY(TRADE_DAY),
    identity,
    kind: 'formal',
    canonical: true,
    fullRecord: true,
    status,
    candidates,
    issued,
    publicationStartedAt: '2026-08-03T05:36:00.000Z',
    availableConfirmedAt: '2026-08-03T05:36:01.000Z',
  };
  const publicationKey = `${strategy}:${id}`;
  const db = {
    verificationPublications: {
      current: { [publicationKey]: id },
      captures: { [id]: { ...capture, publicationKey } },
    },
    verificationCaptures: { [id]: capture },
    verificationBenchmarks: { memos: {} },
    signalSnapshots: [],
    swingVerification: {},
  };
  return { capture, db, publicationKey, benchmarkSpec: mod.fixedBenchmarkSpec(strategy) };
}

function benchmarkObservation(mod, capture, code, exchange, returnPct) {
  const spec = mod.fixedBenchmarkSpec(capture.strategy);
  return {
    captureId: capture.captureId,
    inputFingerprint: capture.inputFingerprint,
    code,
    exchange,
    modelKey: mod.benchmarkModelKey(capture, spec),
    horizon: spec.horizon,
    returnBasis: spec.returnBasis,
    period: capture.strategy === 'swing'
      ? { entryDate: '20260804', exitDate: '20260824' }
      : { entryDate: TRADE_DAY, exitDate: '20260804' },
    status: 'complete',
    returnPct,
    evidence: { timing: capture.strategy === 'swing' ? 'late-publication' : 'close-observation-not-executable' },
  };
}

function attachBenchmark(mod, fixture, observations, { status = 'complete', reason = null } = {}) {
  const result = mod.buildMatchedBenchmark({
    capture: fixture.capture,
    observations,
    benchmarkSpec: fixture.benchmarkSpec,
  });
  fixture.db.verificationBenchmarks.memos[mod.benchmarkMemoKey(fixture.capture)] = {
    status,
    reason,
    cursor: observations.length,
    result,
  };
}

function holdingOutcome(mod, exitPrice) {
  return mod.calculateHoldingOutcome({
    initialPosition: { date: TRADE_DAY, price: 100, shares: 1, originalRiskMoney: 5 },
    exit: { date: '20260824', price: exitPrice },
    events: [],
    eventCoverage: 'complete',
    costs: { model: 'initial-notional-flat-total-v1', total: 0.471 },
  });
}

function swingPopulation(mod, identity, rows) {
  return {
    models: [{ modelKey: mod.verificationModelKey(identity), identity, rows }],
    legacy: { samples: 0, reason: 'issued-and-no-entry-not-recorded' },
  };
}

function swingEntry(mod, { signalId, captureId, status, resultPct, daysHeld }) {
  return {
    signalId,
    captureId,
    status,
    resultPct,
    daysHeld,
    fillModel: 'continuous',
    holdingOutcome: holdingOutcome(mod, 100 + resultPct),
    holdingPosition: { originalRiskMoney: 5 },
  };
}

function metricProjection(model) {
  const coverage = model.metricCoverage?.avgResultPctNet || {};
  return {
    identity: model.identity,
    issued: model.issued,
    noEntry: model.noEntry,
    pending: model.pending,
    resolved: model.resolved,
    unresolved: model.unresolved,
    matureCount: model.matureCount,
    immatureCount: model.immatureCount,
    unknownCount: model.unknownCount,
    avgResultPct: model.avgResultPct ?? null,
    avgResultPctNet: model.avgResultPctNet ?? null,
    avgResultPctNetCoverage: {
      validCount: coverage.validCount ?? 0,
      totalCount: coverage.totalCount ?? model.issued,
      missingCount: coverage.missingCount ?? model.issued,
      reason: coverage.reason ?? null,
    },
    costRisk: model.costRisk ?? null,
    missingReasons: model.missingReasons ?? {},
  };
}

function benchmarkProjection(summary) {
  const cohort = summary.cohorts[0];
  const model = summary.models[0];
  return {
    status: cohort?.status || null,
    reason: cohort?.reason || summary.reason,
    eligibleCount: model?.eligibleCount ?? cohort?.eligibleCount ?? 0,
    pairedCount: model?.pairedCount ?? cohort?.pairedCount ?? 0,
    eligibleDays: model?.eligibleDays ?? 0,
    pairedDays: model?.pairedDays ?? 0,
    strategyMean: model?.strategyMean ?? null,
    benchmarkMean: model?.benchmarkMean ?? null,
    meanDifference: model?.meanDifference ?? null,
    period: cohort ? Object.values(cohort.poolCoverage || {}).find(row => row.period)?.period || null : null,
    countGrain: summary.countGrain,
    includesSelected: summary.includesSelected,
    poolPolicy: summary.poolPolicy,
  };
}

function cohortWindowProjection(summary) {
  return {
    policy: summary.policy,
    asOf: summary.asOf,
    maxSessions: summary.maxSessions,
    calendarSource: summary.calendar.source,
    calendarThrough: summary.calendar.through,
    calendarReason: summary.calendarReason,
  };
}

function personalEvidence(mod, { missingMoney = false } = {}) {
  const initialNow = '2026-08-01T00:00:00.000Z';
  const linkedNow = '2026-08-04T00:00:00.000Z';
  const planId = missingMoney ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001';
  const rawPlan = {
    planId,
    code: '2330',
    exchange: 'TWSE',
    strategy: 'swing',
    scenario: 'midBandDefense',
    signalId: null,
    sourceCaptureId: null,
    status: 'active',
    entryPrice: 100,
    entryLow: null,
    entryHigh: null,
    stopPrice: 95,
    targetPrice: 110,
    quantity: 1000,
    riskBudgetCash: 5000,
    expiresOn: '2026-08-31',
    invalidationReason: '跌破結構停損',
    reason: 'O07 合成計畫',
  };
  let plans = mod.canonicalizeTradePlans({ schemaVersion: 1, plans: [rawPlan] }, { schemaVersion: 1, plans: [] }, { records: [], now: initialNow });
  const records = [
    {
      id: `${planId}-buy`, code: '2330', market: 'TWSE', brokerAccountId: 'synthetic-a', side: 'buy', shares: 1000,
      price: 100, date: TRADE_DAY, tradeDate: TRADE_DAY, executedAt: '2026-08-03T02:00:00.000Z', session: 'regular',
      instrumentType: 'stock', grossAmountTwd: 100000, fee: missingMoney ? null : 20, tax: missingMoney ? null : 0,
      feeSource: missingMoney ? 'legacy' : 'manual', taxSource: missingMoney ? 'legacy' : 'manual', feeRuleId: null, taxRuleId: null,
    },
    {
      id: `${planId}-sell`, code: '2330', market: 'TWSE', brokerAccountId: 'synthetic-a', side: 'sell', shares: 1000,
      price: 110, date: TRADE_DAY, tradeDate: TRADE_DAY, executedAt: '2026-08-03T03:00:00.000Z', session: 'regular',
      instrumentType: 'stock', grossAmountTwd: 110000, fee: missingMoney ? null : 20, tax: missingMoney ? null : 165,
      feeSource: missingMoney ? 'legacy' : 'manual', taxSource: missingMoney ? 'legacy' : 'manual', feeRuleId: null, taxRuleId: null,
    },
  ];
  plans = mod.canonicalizeTradePlans({
    schemaVersion: 1,
    plans: [{ ...plans.plans[0], tradeLinks: records.map(record => ({ tradeId: record.id, allocatedShares: 1000 })), review: { decision: 'execution-deviation', reason: 'O07 合成檢討' } }],
  }, plans, { records, now: linkedNow });
  const evidence = mod.buildTradePlanLinkEvidence(plans, records)[planId];
  return {
    validLinks: evidence.links.filter(link => link.status === 'valid').length,
    buyShares: evidence.buyShares,
    sellShares: evidence.sellShares,
    buyCash: evidence.buyCash,
    sellCash: evidence.sellCash,
    cashDifference: evidence.cashDifference,
    originalRiskCash: evidence.originalRiskCash,
    planReturn: evidence.planReturn,
    netR: evidence.netR,
    reasons: evidence.reasons,
    reviewDecision: plans.plans[0].review.decision,
  };
}

function completeExample(mod) {
  const identity = mod.currentVerificationIdentity('swing');
  const candidates = [candidate('2330', 'TWSE', 1), candidate('2317', 'TWSE', 2), candidate('6488', 'TPEx', 3), candidate('5483', 'TPEx', 4)];
  const issued = [
    { signalId: 'complete-a', code: '2330', exchange: 'TWSE', scenario: 'midBandDefense' },
    { signalId: 'complete-b', code: '6488', exchange: 'TPEx', scenario: 'strongContinuation' },
  ];
  const fixture = captureFixture(mod, { id: 'o07-complete', strategy: 'swing', identity, candidates, issued });
  const observations = [
    benchmarkObservation(mod, fixture.capture, '2330', 'TWSE', 2),
    benchmarkObservation(mod, fixture.capture, '2317', 'TWSE', 0),
    benchmarkObservation(mod, fixture.capture, '6488', 'TPEx', 4),
    benchmarkObservation(mod, fixture.capture, '5483', 'TPEx', 2),
  ];
  attachBenchmark(mod, fixture, observations);
  fixture.db.swingVerification[TRADE_DAY] = [
    swingEntry(mod, { signalId: 'complete-a', captureId: fixture.capture.captureId, status: 'win', resultPct: 5, daysHeld: 8 }),
    swingEntry(mod, { signalId: 'complete-b', captureId: fixture.capture.captureId, status: 'loss', resultPct: -1, daysHeld: 15 }),
  ];
  const population = swingPopulation(mod, identity, issued.map(row => ({ ...row, captureId: fixture.capture.captureId, tradeDate: TRADE_DAY, status: 'resolved', reason: null })));
  const cohortSummary = mod.summarizeMatureVerification(fixture.db, 'swing', { asOf: '20260824', calendar: FULL_CALENDAR, population });
  const benchmarkSummary = mod.summarizeVerificationBenchmarks(fixture.db, 'swing', { asOf: '20260824' });
  return {
    id: 'complete',
    title: '完整合成觀察',
    strategy: 'swing',
    modelKey: cohortSummary.headline.modelKey,
    selectedModelKey: cohortSummary.selectedModelKey,
    captureCoverage: { ...mod.summarizeCaptureCoverage([fixture.capture], [TRADE_DAY], { fromDate: TRADE_DAY, asOf: TRADE_DAY }), expectedDateSource: 'fresh' },
    cohort: { ...metricProjection(cohortSummary.headline), calendarReason: cohortSummary.calendarReason },
    cohortWindow: cohortWindowProjection(cohortSummary),
    benchmark: benchmarkProjection(benchmarkSummary),
    benchmarkWindow: benchmarkSummary.window,
    personal: personalEvidence(mod),
    reviewCadenceSessions: 20,
    reviewCadenceIsThreshold: false,
  };
}

function zeroExample(mod) {
  const identity = mod.currentVerificationIdentity('overnight');
  const fixture = captureFixture(mod, { id: 'o07-zero', strategy: 'overnight', identity, candidates: [], issued: [] });
  attachBenchmark(mod, fixture, []);
  const population = { models: [], legacy: { samples: 0, reason: 'issued-and-no-entry-not-recorded' } };
  const cohortSummary = mod.summarizeMatureVerification(fixture.db, 'overnight', { asOf: TRADE_DAY, population });
  const benchmarkSummary = mod.summarizeVerificationBenchmarks(fixture.db, 'overnight', { asOf: TRADE_DAY });
  return {
    id: 'complete-zero', title: '完整零訊號', strategy: 'overnight', modelKey: cohortSummary.headline.modelKey,
    selectedModelKey: cohortSummary.selectedModelKey,
    captureCoverage: { ...mod.summarizeCaptureCoverage([fixture.capture], [TRADE_DAY], { fromDate: TRADE_DAY, asOf: TRADE_DAY }), expectedDateSource: 'fresh' },
    cohort: { ...metricProjection(cohortSummary.headline), calendarReason: cohortSummary.calendarReason },
    cohortWindow: cohortWindowProjection(cohortSummary),
    benchmark: benchmarkProjection(benchmarkSummary), benchmarkWindow: benchmarkSummary.window, personal: null,
    reviewCadenceSessions: 20, reviewCadenceIsThreshold: false,
  };
}

function calendarUnknownExample(mod) {
  const identity = mod.currentVerificationIdentity('swing');
  const issued = [{ signalId: 'calendar-a', code: '2330', exchange: 'TWSE', scenario: 'midBandDefense' }];
  const fixture = captureFixture(mod, { id: 'o07-calendar', strategy: 'swing', identity, candidates: [candidate('2330', 'TWSE', 1)], issued });
  attachBenchmark(mod, fixture, [], { status: 'pending', reason: 'official-calendar-source-unavailable' });
  fixture.db.swingVerification[TRADE_DAY] = [swingEntry(mod, { signalId: 'calendar-a', captureId: fixture.capture.captureId, status: 'win', resultPct: 5, daysHeld: 1 })];
  const population = swingPopulation(mod, identity, issued.map(row => ({ ...row, captureId: fixture.capture.captureId, tradeDate: TRADE_DAY, status: 'resolved', reason: null })));
  const calendar = { tradingDays: [], coveredMonths: [], through: null, source: null, reason: 'official-calendar-coverage-unknown' };
  const cohortSummary = mod.summarizeMatureVerification(fixture.db, 'swing', { asOf: '20260824', calendar, population });
  const benchmarkSummary = mod.summarizeVerificationBenchmarks(fixture.db, 'swing', { asOf: '20260824' });
  return {
    id: 'calendar-unknown', title: '缺月曆', strategy: 'swing', modelKey: cohortSummary.headline.modelKey,
    selectedModelKey: cohortSummary.selectedModelKey,
    captureCoverage: { ...mod.summarizeCaptureCoverage([fixture.capture], [], { fromDate: TRADE_DAY, asOf: TRADE_DAY }), expectedDateSource: 'unavailable' },
    cohort: { ...metricProjection(cohortSummary.headline), calendarReason: cohortSummary.calendarReason },
    cohortWindow: cohortWindowProjection(cohortSummary),
    benchmark: benchmarkProjection(benchmarkSummary), benchmarkWindow: benchmarkSummary.window, personal: null,
    reviewCadenceSessions: 20, reviewCadenceIsThreshold: false,
  };
}

function costUnknownExample(mod) {
  const identity = {
    ...mod.currentVerificationIdentity('swing'),
    evaluationVersion: 'swing-price-observation-v1',
    costModelVersion: 'legacy-unknown',
    returnBasis: 'adjusted-reference-price',
  };
  const issued = [{ signalId: 'cost-a', code: '2330', exchange: 'TWSE', scenario: 'midBandDefense' }];
  const fixture = captureFixture(mod, { id: 'o07-cost', strategy: 'swing', identity, candidates: [candidate('2330', 'TWSE', 1)], issued });
  attachBenchmark(mod, fixture, [benchmarkObservation(mod, fixture.capture, '2330', 'TWSE', 2)]);
  fixture.db.swingVerification[TRADE_DAY] = [swingEntry(mod, { signalId: 'cost-a', captureId: fixture.capture.captureId, status: 'win', resultPct: 5, daysHeld: 15 })];
  const population = swingPopulation(mod, identity, issued.map(row => ({ ...row, captureId: fixture.capture.captureId, tradeDate: TRADE_DAY, status: 'resolved', reason: null })));
  const cohortSummary = mod.summarizeMatureVerification(fixture.db, 'swing', { asOf: '20260824', calendar: FULL_CALENDAR, population });
  const model = cohortSummary.models.find(item => item.identity.costModelVersion === 'legacy-unknown');
  const benchmarkSummary = mod.summarizeVerificationBenchmarks(fixture.db, 'swing', { asOf: '20260824' });
  return {
    id: 'cost-unknown', title: '缺成本', strategy: 'swing', modelKey: model.modelKey,
    selectedModelKey: cohortSummary.selectedModelKey,
    captureCoverage: { ...mod.summarizeCaptureCoverage([fixture.capture], [TRADE_DAY], { fromDate: TRADE_DAY, asOf: TRADE_DAY }), expectedDateSource: 'fresh' },
    cohort: { ...metricProjection(model), calendarReason: cohortSummary.calendarReason },
    cohortWindow: cohortWindowProjection(cohortSummary),
    benchmark: benchmarkProjection(benchmarkSummary), benchmarkWindow: benchmarkSummary.window, personal: personalEvidence(mod, { missingMoney: true }),
    reviewCadenceSessions: 20, reviewCadenceIsThreshold: false,
  };
}

function immatureExample(mod) {
  const identity = mod.currentVerificationIdentity('swing');
  const issued = [{ signalId: 'immature-a', code: '2330', exchange: 'TWSE', scenario: 'midBandDefense' }];
  const fixture = captureFixture(mod, { id: 'o07-immature', strategy: 'swing', identity, candidates: [candidate('2330', 'TWSE', 1)], issued });
  attachBenchmark(mod, fixture, [], { status: 'pending', reason: 'official-session-horizon-unavailable' });
  fixture.db.swingVerification[TRADE_DAY] = [swingEntry(mod, { signalId: 'immature-a', captureId: fixture.capture.captureId, status: 'win', resultPct: 5, daysHeld: 1 })];
  const population = swingPopulation(mod, identity, issued.map(row => ({ ...row, captureId: fixture.capture.captureId, tradeDate: TRADE_DAY, status: 'resolved', reason: null })));
  const shortCalendar = { ...FULL_CALENDAR, tradingDays: FULL_SESSIONS.slice(0, 6), through: '20260810' };
  const cohortSummary = mod.summarizeMatureVerification(fixture.db, 'swing', { asOf: '20260810', calendar: shortCalendar, population });
  const benchmarkSummary = mod.summarizeVerificationBenchmarks(fixture.db, 'swing', { asOf: '20260810' });
  return {
    id: 'immature', title: '未成熟', strategy: 'swing', modelKey: cohortSummary.headline.modelKey,
    selectedModelKey: cohortSummary.selectedModelKey,
    captureCoverage: { ...mod.summarizeCaptureCoverage([fixture.capture], [TRADE_DAY], { fromDate: TRADE_DAY, asOf: TRADE_DAY }), expectedDateSource: 'fresh' },
    cohort: { ...metricProjection(cohortSummary.headline), calendarReason: cohortSummary.calendarReason },
    cohortWindow: cohortWindowProjection(cohortSummary),
    benchmark: benchmarkProjection(benchmarkSummary), benchmarkWindow: benchmarkSummary.window, personal: null,
    observedSessions: 5, reviewCadenceSessions: 20, reviewCadenceIsThreshold: false,
  };
}

export function buildSyntheticVerificationReviews(mod) {
  return [completeExample(mod), zeroExample(mod), calendarUnknownExample(mod), costUnknownExample(mod), immatureExample(mod)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.env.STOCK1_SKIP_LISTEN = '1';
  process.env.PORT = '0';
  delete process.env.DATA_DIR;
  delete process.env.DB_PATH;
  const mod = await import('../../server.mjs');
  process.stdout.write(`${JSON.stringify(buildSyntheticVerificationReviews(mod), null, 2)}\n`);
}
