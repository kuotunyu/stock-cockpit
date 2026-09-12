// 真實 Chromium 共用 fixture：臨時伺服器、固定 UI 契約、外網 tripwire 與完整資源清理。
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { bootServer } from "./test-server.mjs";

const SCENARIOS = new Set(["populated", "empty", "partial", "expired-session"]);
const FIXED_NOW = "2026-09-07T02:00:00.000Z"; // 台北 10:00，固定為盤中條件。
const AS_OF = "2026-09-04";
const ARTIFACT_DIR = resolve("test-results/browser");

const midPick = {
  rank: 1,
  code: "6488",
  name: "環球晶圓先進材料科技股份有限公司",
  exchange: "TWSE",
  market: "上市",
  asOf: AS_OF,
  price: 425,
  changePct: 2.4,
  score: 86,
  avgVolLots: 3210,
  volumeRatio5: 1.28,
  scenario: { key: "midBandDefense", name: "中軌攻防", desc: "回檔中軌站穩，MACD 維持金叉" },
  indicators: { ma5: 421, ma20: 418, bollMid: 418, macd: 2.1, signal: 1.7 },
  plan: { entry: 425, initialStop: 403.75, structuralStop: 410, trailingTrigger: 446.25, target: 458, rr: 2.2, rrNet: 2.0 },
  reasons: ["中軌附近承接"],
  warnings: [],
  surveillance: { kind: "attention", label: "注意", count: 3 },
};

const strongPick = {
  ...midPick,
  code: "6666",
  name: "台灣高效能運算系統整合股份有限公司",
  price: 186,
  changePct: 6.8,
  score: 91,
  avgVolLots: 4567,
  volumeRatio5: 1.9,
  scenario: { key: "strongContinuation", name: "上軌續攻", desc: "沿上軌強勢，量能同步放大" },
  indicators: { ma5: 178, ma20: 160, bollMid: 160, macd: 4.2, signal: 3.1 },
  plan: { entry: 186, initialStop: 176.7, structuralStop: 172, trailingTrigger: 195.3, target: 216, rr: 2.1, rrNet: 1.9 },
  surveillance: null,
};

const quoteByCode = new Map([
  [midPick.code, { code: midPick.code, name: midPick.name, exchange: "TWSE", price: 426, previousClose: 415, open: 420, high: 430, low: 417, change: 11, changePct: 2.65, unitLots: 4, volumeLots: 3321, turnoverPct: 3.2 }],
  [strongPick.code, { code: strongPick.code, name: strongPick.name, exchange: "TWSE", price: 188, previousClose: 174, open: 177, high: 190, low: 176, change: 14, changePct: 8.05, unitLots: 6, volumeLots: 4876, turnoverPct: 5.1 }],
  ["2330", { code: "2330", name: "台積電", exchange: "TWSE", price: 1210, previousClose: 1190, open: 1200, high: 1220, low: 1195, change: 20, changePct: 1.68, unitLots: 5, volumeLots: 25000, turnoverPct: 0.8 }],
]);

const swingVerification = {
  ok: true,
  currentFormulaVersion: "browser-fixture-v1",
  formulaVersions: [{ formulaVersion: "browser-fixture-v1", samples: 44, resolved: 38, pending: 6, dataGaps: 0 }],
  scenarios: [
    { scenario: "midBandDefense", samples: 24, wins: 13, losses: 7, expired: 0, pending: 4, resolved: 20, continuousResolved: 20, winRate: 65, winRateMinSamples: 20, avgResultPct: 1.8, avgDaysHeld: 5.2 },
    { scenario: "strongContinuation", samples: 20, wins: 9, losses: 9, expired: 0, pending: 2, resolved: 18, continuousResolved: 18, winRate: null, winRateMinSamples: 20, avgResultPct: 0.4, avgDaysHeld: 4.1 },
  ],
  recent: [
    { day: "20260828", code: "6488", name: midPick.name, scenario: "midBandDefense", status: "win", resolvedAt: "20260903", resultPct: 5.2, daysHeld: 4 },
  ],
  pendingCount: 6,
  notes: ["固定瀏覽器 fixture，只驗 UI 消費契約"],
};

const metric = (value, validCount, totalCount, validDays) => ({ value, validCount, totalCount, missingCount: totalCount-validCount, validDays,
  reason: validCount === totalCount ? null : validCount ? 'partial-field-coverage' : 'no-valid-values' });
const measuredIdentity = { snapshotSchemaVersion:2,selectionVersion:'browser-fixture-v1',evaluationVersion:'swing-price-observation-v1',
  costModelVersion:'flat-round-trip-0.471pct-v1',cohortPolicyVersion:'mature-issued-15-official-sessions-v1',entryModel:'signal-close-observation',returnBasis:'adjusted-reference-price' };
const measuredScenarios = swingVerification.scenarios.map(s => ({ ...s, issued:s.samples,matureCount:s.resolved,immatureCount:s.pending,unknownCount:0,
  netProfitRate:s.winRate,targetHitRate:s.winRate,avgResultPctNet:s.avgResultPct-0.471,
  metricCoverage:{ netProfitRate:metric(s.wins/s.resolved*100,s.resolved,s.resolved,8),avgResultPctNet:metric(s.avgResultPct-0.471,s.resolved,s.resolved,8) } }));
const measuredHeadline = { identity:measuredIdentity,modelKey:JSON.stringify(measuredIdentity),issued:44,matureCount:38,immatureCount:6,unknownCount:0,
  signalDays:10,noEntry:0,pending:6,resolved:38,unresolved:0,scenarios:measuredScenarios,
  metricCoverage:{avgResultPctNet:metric((1.8*20+0.4*18)/38-0.471,38,38,8),netProfitRate:metric(22/38*100,38,38,8)},missingReasons:{} };
const nextIdentity = {...measuredIdentity,entryModel:'next-open-price-observation',evaluationVersion:'swing-next-open-price-observation-v1'};
const measuredSwingVerification = { ...swingVerification,
  captureCoverage:{fullRecordStartDate:'2026-08-01',expectedCount:26,completeCount:25,expectedDateReason:'official-session-dates-only'},
  population:{legacy:{samples:12,reason:'issued-and-no-entry-not-recorded'},models:[]},
  modelGroups:[{identity:measuredIdentity,samples:44}],metricCoverage:measuredHeadline.metricCoverage,
  cohort:{policy:measuredIdentity.cohortPolicyVersion,selectedModelKey:measuredHeadline.modelKey,headline:measuredHeadline,
    models:[measuredHeadline,{...measuredHeadline,identity:nextIdentity,modelKey:JSON.stringify(nextIdentity),scenarios:[],
      resultBasis:'original-close-observation-exit-and-window',pending:24,resolved:20,metricCoverage:{avgResultPctNet:metric(1.1,20,38,8),netProfitRate:metric(60,20,38,8)},missingReasons:{'timing-uncertain':18}}] } };

const overnightIdentity = {...measuredIdentity, selectionVersion:'overnight-browser-v1',evaluationVersion:'overnight-price-observation-v1',cohortPolicyVersion:'complete-issued-next-session-v1'};
const overnightCoverage = {winAtOpen:metric(0,1,20,1),winAtClose:metric(0,20,20,20),hitPlus2:metric(0,19,20,19),brokeMinus2:metric(null,0,20,0),
  avgOpenReturn:metric(0,1,20,1),avgCloseReturn:metric(0,20,20,20),avgOpenReturnNet:metric(-0.471,1,20,1),avgCloseReturnNet:metric(-0.471,20,20,20)};
const overnightHeadline = {identity:overnightIdentity,modelKey:JSON.stringify(overnightIdentity),issued:20,noEntry:0,pending:0,resolved:20,unresolved:0,
  matureCount:20,immatureCount:0,unknownCount:0,signalDays:20,days:20,signals:20,minDays:20,winAtOpen:0,winAtClose:0,hitPlus2:0,brokeMinus2:0,
  avgOpenReturn:0,avgCloseReturn:0,avgOpenReturnNet:-0.471,avgCloseReturnNet:-0.471,metricCoverage:overnightCoverage,ci:{}};
const overnightDates = ['03','04','05','06','07','10','11','12','13','14','17','18','19','20','21','24','25','26','27','28','31'].map(day => `2026-08-${day}`);
const overnightVerification = {ok:true,records:Array.from({length:20},(_,i)=>({asOf:overnightDates[i],observationDate:overnightDates[i+1],
  complete:true,status:'final',signals:1,verified:1,winAtOpen:0,winAtClose:0,hitPlus2:0,brokeMinus2:0,avgOpenReturn:i===0?0:null,avgCloseReturn:0,
  metricCoverage:{winAtOpen:metric(i===0?0:null,i===0?1:0,1,i===0?1:0),hitPlus2:metric(i<19?0:null,i<19?1:0,1,i<19?1:0),brokeMinus2:metric(null,0,1,0)}})),
  totals:overnightHeadline,cohort:{headline:overnightHeadline,models:[overnightHeadline]},captureCoverage:{fullRecordStartDate:'2026-08-03',expectedCount:21,completeCount:20,expectedDateReason:'official-session-dates-only'},
  population:{legacy:{samples:2,reason:'issued-and-no-entry-not-recorded'}},modelGroups:[{identity:overnightIdentity,days:20}]};

function swingPayload(scenario, kind) {
  const pick = scenario === "strongContinuation" ? strongPick : midPick;
  const picks = kind === "empty" ? [] : [pick];
  return {
    ok: true,
    asOf: AS_OF,
    source: "瀏覽器固定資料",
    generatedAt: FIXED_NOW,
    picks,
    matchedCount: picks.length,
    candidateCount: 120,
    scenarios: [
      { key: "midBandDefense", name: "中軌攻防", count: kind === "empty" ? 0 : 1 },
      { key: "strongContinuation", name: "上軌續攻", count: kind === "empty" ? 0 : 1 },
    ],
    riskPolicy: "注意與處置只標示",
    warnings: kind === "partial" ? ["部分市場資料暫缺：TPEx 公司行動資料沿用 last-good"] : [],
    // 真實 /api/swing 每條路徑都帶 publication；partial 對應來源未完整的 provisional，其餘為 formal。
    publication: { kind: kind === "partial" ? "provisional" : "formal" },
  };
}

function quotesPayload(url) {
  const requested = (url.searchParams.get("codes") || "").split(",").filter(Boolean);
  const quotes = requested.map((code) => quoteByCode.get(code) || {
    code,
    name: `固定測試股 ${code}`,
    exchange: "TWSE",
    price: 100,
    previousClose: 99,
    open: 99.5,
    high: 101,
    low: 98.5,
    change: 1,
    changePct: 1.01,
    unitLots: 1,
    volumeLots: 1000,
    turnoverPct: 1,
  }).map((quote) => ({ ...quote, source: "TWSE 固定 fixture", sourceKind: "realtime", asOf: FIXED_NOW, priceStale: false }));
  return { ok: true, sourceKey: "official", source: "TWSE 固定 fixture", generatedAt: FIXED_NOW, realtimeCount: quotes.length, fallbackCount: 0, warnings: [], dataQuality: { degraded: false }, quotes };
}

function supplementalRecords(url, kind) {
  return Object.fromEntries((url.searchParams.get("codes") || "").split(",").filter(Boolean).map((code) => [code, kind === "institutional"
    ? { code, foreignNet: 120, trustNet: 35, dealerNet: -12, source: "固定 fixture", asOf: AS_OF }
    : { code, marginBalance: 800, shortBalance: 20, marginUsagePct: 3.1, source: "固定 fixture", asOf: AS_OF }]));
}

function overnightPayload(kind) {
  if (kind === "empty") {
    return { ok: true, asOf: AS_OF, source: "固定 fixture", surveillanceCount: 0, warnings: [], groups: { strongContinuation: [], volumeDanger: [], pullbackReversal: [] } };
  }
  const base = { ...strongPick, group: "strongContinuation", groupName: "強勢續攻", score: 88 };
  return {
    ok: true,
    asOf: AS_OF,
    source: "固定 fixture",
    surveillanceCount: 1,
    warnings: kind === "partial" ? ["部分市場資料暫缺"] : [],
    groups: {
      strongContinuation: [base],
      volumeDanger: [{ ...base, code: "2330", name: "台積電", group: "volumeDanger", groupName: "量價警戒", surveillance: { kind: "attention", label: "注意" } }],
      pullbackReversal: [{ ...midPick, group: "pullbackReversal", groupName: "回檔轉強" }],
    },
  };
}

function surveillancePayload(kind) {
  const item = {
    code: midPick.code,
    name: midPick.name,
    exchange: "TWSE",
    price: 426,
    changePct: 2.65,
    interval: 20,
    daysToRelease: 3,
    startSlash: "2026/09/01",
    endSlash: "2026/09/10",
    turnover: 3.2,
    volumeLots: 3321,
    isNew: true,
  };
  const rows = kind === "empty" ? [] : [item];
  return {
    ok: true,
    asOf: AS_OF,
    queryDate: AS_OF,
    quoteAsOf: AS_OF,
    warnings: kind === "partial" ? ["部分市場資料暫缺"] : [],
    hasHistory: true,
    comparisonAsOf: "2026-09-03",
    comparisonIsPreviousTradingDay: true,
    aboutToDispose: [],
    inDisposition: rows,
    aboutToRelease: [],
    blockTrades: [],
    attention: rows.map((row) => ({ ...row, interval: null, count: 3, reason: "價量異常", daysOnList: 3, nearDisposition: true })),
    changedTrading: [],
    counts: { aboutToDispose: 0, inDisposition: rows.length, aboutToRelease: 0, blockTrades: 0, attention: rows.length, changedTrading: 0 },
  };
}

export function apiResponse(url, method, scenario) {
  const path = url.pathname;
  const kind = scenario === "expired-session" ? "populated" : scenario;
  if (path === "/api/auth/me") {
    if (scenario === "expired-session") return { status: 401, body: { code: "AUTH_REQUIRED", error: "需要先登入" } };
    return { body: { user: { id: "browser-admin", username: "admin", displayName: "瀏覽器測試員", role: "admin" }, warnings: {} } };
  }
  if (path === "/api/watchlists") return { body: { ok: true, rev: 1, lists: { 1: [midPick.code], 2: [], 3: [] } } };
  if (path === "/api/alerts") return { body: { ok: true, rev: method === "PUT" ? 2 : 1, alerts: [] } };
  if (path === "/api/trades") return { body: { ok: true, schemaVersion: 2, rev: 1, settings: { feeDiscount: 0.6, minFee: 20 }, records: [], quarantinedRecords: [], portfolio: { holdings: [], realized: [], totals: { cost: 0, marketValue: 0, unrealizedPnl: 0, realizedPnl: 0 } }, missingCorporateActions: [] } };
  if (path === "/api/broker/settings") return { body: { configured: false, connected: false, message: "固定 fixture 未設定券商" } };
  if (path === "/api/sources") return { body: { ok: true, selected: "official", sources: { official: { ready: true, label: "官方資料" }, broker: { ready: false, message: "固定 fixture 未設定券商" } } } };
  if (path === "/api/market-session") return { body: { ok: true, session: "regular", isOpen: true, asOf: FIXED_NOW } };
  if (path === "/api/markets") return { body: { ok: true, source: "固定 fixture", generatedAt: FIXED_NOW, warnings: [], markets: { taiex: { key: "taiex", label: "加權", name: "加權指數", price: 24888, change: 188, changePct: 0.76, source: "TWSE", asOf: FIXED_NOW, session: "日盤" }, futures: { key: "futures", label: "台指", name: "臺股期貨", price: 24920, change: 120, changePct: 0.48, source: "TAIFEX", asOf: FIXED_NOW, session: "日盤" } } } };
  if (path === "/api/quotes") return { body: quotesPayload(url) };
  if (path === "/api/overnight") return { body: overnightPayload(kind) };
  if (path === "/api/overnight/verify") return { body: { ok: true, available: false, message: "固定 fixture 累積中" } };
  if (path === "/api/overnight/verify/history") return { body: overnightVerification };
  if (path === "/api/backtest/overnight") return { body: { ok: true, available: false, groups: {} } };
  if (path === "/api/market/breadth") return { body: { ok: true, asOf: AS_OF, stance: "neutral", summary: {}, warnings: [] } };
  if (path === "/api/swing") return { body: swingPayload(url.searchParams.get("scenario") || "midBandDefense", kind) };
  if (path === "/api/swing/verify") return { body: kind === "empty" ? { ...swingVerification, scenarios: [], recent: [], pendingCount: 0 }
    : kind === 'partial' ? swingVerification : measuredSwingVerification };
  if (path === "/api/surveillance-board") return { body: surveillancePayload(kind) };
  if (path === "/api/institutional") {
    const records = supplementalRecords(url, "institutional");
    return { body: { ok: true, date: AS_OF.replaceAll("-", ""), source: "固定 fixture", generatedAt: FIXED_NOW, recordCount: Object.keys(records).length, warnings: [], records } };
  }
  if (path === "/api/margin") {
    const records = supplementalRecords(url, "margin");
    return { body: { ok: true, date: AS_OF.replaceAll("-", ""), source: "固定 fixture", recordCount: Object.keys(records).length, warnings: [], records } };
  }
  if (path === "/api/notes" || path === "/api/notes/recent") return { body: { ok: true, rev: 0, notes: [] } };
  if (path === "/api/company") return { body: { ok: true, code: url.searchParams.get("code") || "", industry: "半導體", summary: "固定 fixture 公司簡介" } };
  if (path === "/api/fundamentals") return { body: { ok: true, code: url.searchParams.get("code") || "", source: "固定 fixture", revenue: null, eps: null, dividends: [] } };
  if (path === "/api/symbols") return { body: { ok: true, results: [...quoteByCode.values()].map(({ code, name, exchange }) => ({ code, name, exchange })) } };
  if (path === "/api/swing/inspect") return { body: { ok: false, error: "fixture 不執行健檢送出" } };
  if (path === "/api/app-version") return { body: { ok: true, build: {}, update: { state: "unknown" } } };
  return { status: 404, body: { error: `browser fixture 未定義 ${method} ${path}` } };
}

export function visibleNav(page, screen) {
  return page.locator(`.nav-action[data-screen="${screen}"]:visible`).first();
}

function rectEdges(box) {
  return { ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
}

async function expectedRect(locator, label) {
  assert.equal(await locator.count(), 1, `${label} 必須有且只有一個`);
  assert.equal(await locator.isVisible(), true, `${label} 必須可見`);
  const rendered = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0;
  });
  assert.equal(rendered, true, `${label} 不得以 display/visibility/opacity 隱藏`);
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${label} 必須有正尺寸：${JSON.stringify(box)}`);
  return rectEdges(box);
}

function assertInside(inner, outer, label) {
  assert.ok(
    inner.left >= outer.left - 1
      && inner.right <= outer.right + 1
      && inner.top >= outer.top - 1
      && inner.bottom <= outer.bottom + 1,
    `${label} 應在容器內：${JSON.stringify({ inner, outer })}`,
  );
}

function assertNoOverlap(items, label) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const left = items[leftIndex];
      const right = items[rightIndex];
      const overlaps = left.rect.left < right.rect.right - 0.5
        && left.rect.right > right.rect.left + 0.5
        && left.rect.top < right.rect.bottom - 0.5
        && left.rect.bottom > right.rect.top + 0.5;
      assert.equal(overlaps, false, `${label} 不可重疊：${left.label} ${JSON.stringify(left.rect)} / ${right.label} ${JSON.stringify(right.rect)}`);
    }
  }
}

export async function assertExpectedLayout(page, { width, detailOpen = false }) {
  assert.equal(page.viewportSize()?.width, width, `viewport 寬度應為 ${width}px`);
  const viewport = { left: 0, top: 0, right: width, bottom: page.viewportSize().height };
  if (detailOpen) {
    const detail = await expectedRect(page.locator("#detailPanel.is-open"), `${width}px 明細面板`);
    assert.ok(detail.left >= -1 && detail.right <= width + 1, `${width}px 明細面板不可橫向超出 viewport：${JSON.stringify(detail)}`);
    if (width < 1040) {
      const closeButton = await expectedRect(page.locator("#detailClose"), `${width}px 明細關閉按鈕`);
      assertInside(closeButton, detail, `${width}px 明細關閉按鈕`);
      assert.equal(await page.locator("#detailClose").evaluate((node) => !node.disabled && node.tabIndex >= 0), true, `${width}px 明細關閉按鈕必須可聚焦`);
    } else {
      assert.equal(await page.locator("#detailClose").isVisible(), false, `${width}px 桌面常駐明細的關閉按鈕應依現行設計隱藏`);
    }
    return;
  }
  const topbar = await expectedRect(page.locator(".topbar"), `${width}px 頂欄`);
  assertInside(topbar, viewport, `${width}px 頂欄`);
  const sourceControls = width < 1040
    ? [["#sourcePill", "資料來源 pill"]]
    : [
        ['[data-source-option="official"]', "官方資料按鈕"],
        ['[data-source-option="broker"]', "券商資料按鈕"],
      ];
  const topbarSelectors = [
    ["#marketPill", "市場指標按鈕"],
    ["#screenTitle", "畫面標題"],
    ["#screenHelp", "畫面說明按鈕"],
    ...sourceControls,
    ["#searchOpen", "搜尋按鈕"],
    ["#filterOpen", "篩選按鈕"],
    ["#glossaryOpen", "名詞解釋按鈕"],
  ];
  const topbarItems = [];
  for (const [selector, label] of topbarSelectors) {
    const locator = page.locator(selector);
    const rect = await expectedRect(locator, `${width}px ${label}`);
    assertInside(rect, topbar, `${width}px ${label}`);
    assertInside(rect, viewport, `${width}px ${label}`);
    topbarItems.push({ label, rect });
  }
  assertNoOverlap(topbarItems, `${width}px 頂欄子元素`);

  const card = await expectedRect(page.locator(".swing-card"), `${width}px 波段卡`);
  const actionRow = await expectedRect(page.locator(".swing-actions"), `${width}px 波段動作列`);
  assertInside(actionRow, card, `${width}px 波段動作列`);
  const actionSelectors = [
    ['.swing-open[data-swing-code="6488"]', "查看明細按鈕"],
    ['.swing-plan-alerts[data-plan-alerts="6488"]', "建立提醒按鈕"],
  ];
  const actionItems = [];
  for (const [selector, label] of actionSelectors) {
    const locator = page.locator(selector);
    const rect = await expectedRect(locator, `${width}px ${label}`);
    assertInside(rect, actionRow, `${width}px ${label}`);
    assert.ok(rect.left >= -1 && rect.right <= width + 1, `${width}px ${label} 不可橫向超出 viewport：${JSON.stringify(rect)}`);
    assert.equal(await locator.evaluate((node) => !node.disabled && node.tabIndex >= 0), true, `${width}px ${label} 必須可聚焦`);
    actionItems.push({ label, rect });
  }
  assertNoOverlap(actionItems, `${width}px 波段主要操作`);

  const scorecardsHost = await expectedRect(page.locator("#swingVerify .sv-chips"), `${width}px 成績卡容器`);
  const scorecardLocator = page.locator("#swingVerify .sv-chip");
  assert.equal(await scorecardLocator.count(), 2, `${width}px 必須恰有兩張成績卡`);
  const scorecardItems = [];
  for (let index = 0; index < 2; index += 1) {
    const label = `成績卡 ${index + 1}`;
    const rect = await expectedRect(scorecardLocator.nth(index), `${width}px ${label}`);
    assertInside(rect, scorecardsHost, `${width}px ${label}`);
    assert.ok(rect.left >= -1 && rect.right <= width + 1, `${width}px ${label} 不可橫向超出 viewport：${JSON.stringify(rect)}`);
    scorecardItems.push({ label, rect });
  }
  assertNoOverlap(scorecardItems, `${width}px 成績卡`);

}

export async function createBrowserFixture({ scenario, setupFailure } = {}) {
  assert.ok(SCENARIOS.has(scenario), `未知 browser scenario：${scenario}`);
  assert.ok(setupFailure === undefined || typeof setupFailure === "function", "setupFailure 必須是測試用 function");
  const server = await bootServer({ routes: [], env: { UPDATE_CHECK: "off", DISABLE_CLOSE_SCHEDULER: "1" } });
  assert.notEqual(new URL(server.baseUrl).port, "5174", "瀏覽器測試不得使用正式埠 5174");
  assert.doesNotMatch(server.dataDir, /[\\/]\.data(?:[\\/]|$)/, "瀏覽器測試不得使用正式 .data");

  let browser;
  let context;
  let page;
  const textZoomCss = "";
  let textZoomVersion = 0;
  let traceActive = false;
  let closed = false;
  const externalRequests = [];
  const apiCalls = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      reducedMotion: "reduce",
      colorScheme: "dark",
      serviceWorkers: "block",
      viewport: { width: 1280, height: 1000 },
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceActive = true;
    page = await context.newPage();
    await page.addInitScript(({ fixedNow }) => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }
        static now() {
          return fixedNow;
        }
      }
      window.Date = FixedDate;
    }, { fixedNow: Date.parse(FIXED_NOW) });
    if (scenario === "expired-session") {
      await page.addInitScript(() => localStorage.setItem("stock1.hadSession.v1", "1"));
    }
    // 手機底部導覽（M5）預設 5 籤，盤中選股／處置看板收進「更多」；既有 browser 測試都用 visibleNav 直接點這兩籤，
    // 所以 fixture 先種 7 籤。M5 的測試（mobile-shell）自己清掉旗標驗預設 5 籤。
    await page.addInitScript(() => localStorage.setItem("stock1.navTabs.v1", "7"));
    const allowedOrigin = new URL(server.baseUrl).origin;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== allowedOrigin) {
        externalRequests.push(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      if (url.pathname === "/__browser-text-zoom.css") {
        await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: textZoomCss });
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        await route.continue();
        return;
      }
      apiCalls.push(`${request.method()} ${url.pathname}${url.search}`);
      const response = apiResponse(url, request.method(), scenario);
      await route.fulfill({
        status: response.status || 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(response.body),
      });
    });
    await page.goto(`${server.baseUrl}/?screen=overnight`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".topbar").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#overnightGroups")?.textContent?.trim().length > 0);
    await setupFailure?.({ server, browser, context, page });
  } catch (error) {
    await mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {});
    await page?.screenshot({ path: resolve(ARTIFACT_DIR, `setup-${scenario}.png`), fullPage: true }).catch(() => {});
    if (traceActive) {
      await context?.tracing.stop({ path: resolve(ARTIFACT_DIR, `setup-${scenario}.zip`) }).catch(() => {});
      traceActive = false;
    }
    for (const cleanup of [
      () => page?.close(),
      () => context?.close(),
      () => browser?.close(),
      () => server.close(),
    ]) {
      await cleanup().catch(() => {});
    }
    throw error;
  }

  return {
    server,
    browser,
    context,
    page,
    apiCalls,
    externalRequests,
    advancePollingCycle: async () => {
      const response = await page.waitForResponse((candidate) => {
        const url = new URL(candidate.url());
        return url.origin === new URL(server.baseUrl).origin && url.pathname === "/api/markets";
      }, { timeout: 15_000 });
      await response.finished();
      await page.evaluate(async () => { await new Promise(requestAnimationFrame); await window.__stock1BrowserTextZoom?.running; });
    },
    emulateTextZoom: async (factor, trackedSelectors = [".swing-nm", ".swing-stat strong", ".swing-open", ".swing-plan-alerts"]) => {
      // A single same-origin sheet obeys the product CSP. Re-measure natural sizes
      // after child replacement, so live polling retains real text zoom.
      if (!textZoomVersion) {
        textZoomVersion = 1;
        await page.evaluate(() => new Promise((resolveLoad, rejectLoad) => {
          const link = document.createElement("link");
          link.id = "browserTextZoomStyles";
          link.rel = "stylesheet";
          link.href = "/__browser-text-zoom.css";
          link.onload = resolveLoad;
          link.onerror = () => rejectLoad(new Error("測試用文字放大樣式載入失敗"));
          document.head.append(link);
        }));
      }
      const tracked = await page.evaluate(async ({ factor, selectors }) => {
        if (!window.__stock1BrowserTextZoom) {
          const zoom = { factor: 1, bases: new WeakMap() };
          const sheet = document.getElementById("browserTextZoomStyles").sheet;
          zoom.frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          zoom.request = () => {
            zoom.pending = true;
            if (zoom.running) return zoom.running;
            zoom.running = (async () => {
              while (zoom.pending) {
                zoom.pending = false;
                sheet.ownerNode.media = "not all";
                // Chromium can retain the previous computed size through the first
                // frame after a mobile reflow. Read the unscaled cascade after paint.
                await zoom.frames();
                while (sheet.cssRules.length) sheet.deleteRule(0);
                const nodes = [...document.body.querySelectorAll("*")];
                const sizes = nodes.map(node => Number.parseFloat(getComputedStyle(node).fontSize));
                nodes.forEach((node, index) => {
                  const size = sizes[index];
                  if (!Number.isFinite(size) || size <= 0) return;
                  zoom.bases.set(node, size);
                  // Keep fixture markers out of the product's data-* focus identity.
                  node.setAttribute("browser-text-zoom", String(index));
                  sheet.insertRule(`[browser-text-zoom="${index}"]{font-size:${size * zoom.factor}px !important}`, sheet.cssRules.length);
                });
                sheet.ownerNode.media = "all";
                await zoom.frames();
              }
            })().finally(() => { zoom.running = null; });
            return zoom.running;
          };
          zoom.observer = new MutationObserver(() => zoom.request());
          zoom.observer.observe(document.body, { childList: true, subtree: true });
          window.__stock1BrowserTextZoom = zoom;
        }
        const zoom = window.__stock1BrowserTextZoom;
        zoom.factor = factor;
        await zoom.request();
        return selectors.map(selector => ({selector, before: zoom.bases.get(document.querySelector(selector)) || 0}));
      }, {factor, selectors: trackedSelectors});
      await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      const measurements = await page.evaluate(tracked => tracked.map(({selector, before}) => ({
        selector, before,
        after: Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize),
      })), tracked);
      for (const item of measurements) {
        assert.ok(item.before > 0, `文字放大目標不存在：${item.selector}`);
        assert.ok(Math.abs(item.after / item.before - factor) < 0.01, `${item.selector} 字級倍率應為 ${factor}x，實際 ${item.after / item.before}`);
      }
      return measurements;
    },
    captureFailure: async (name) => {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(ARTIFACT_DIR, `${name}-${scenario}.png`), fullPage: true }).catch(() => {});
      if (traceActive) {
        await context.tracing.stop({ path: resolve(ARTIFACT_DIR, `${name}-${scenario}.zip`) }).catch(() => {});
        traceActive = false;
      }
    },
    captureSnapshot: async (name) => {
      await page.evaluate(async () => { await window.__stock1BrowserTextZoom?.running; });
      await mkdir(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(ARTIFACT_DIR, `${name}.png`) });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      let cleanupError;
      const cleanups = [
        async () => {
          if (!traceActive) return;
          await context.tracing.stop();
          traceActive = false;
        },
        async () => { if (!page.isClosed()) await page.evaluate(() => window.__stock1BrowserTextZoom?.observer.disconnect()); },
        () => page.close(),
        () => context.close(),
        () => browser.close(),
        () => server.close(),
      ];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          cleanupError ||= error;
        }
      }
      assert.deepEqual(externalRequests, [], `瀏覽器曾嘗試外連：${externalRequests.join(", ")}`);
      if (cleanupError) throw cleanupError;
    },
  };
}
