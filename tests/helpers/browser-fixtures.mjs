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

function apiResponse(url, method, scenario) {
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
  if (path === "/api/overnight/verify/history") return { body: { ok: true, rows: [], summary: {} } };
  if (path === "/api/backtest/overnight") return { body: { ok: true, available: false, groups: {} } };
  if (path === "/api/market/breadth") return { body: { ok: true, asOf: AS_OF, stance: "neutral", summary: {}, warnings: [] } };
  if (path === "/api/swing") return { body: swingPayload(url.searchParams.get("scenario") || "midBandDefense", kind) };
  if (path === "/api/swing/verify") return { body: kind === "empty" ? { ...swingVerification, scenarios: [], recent: [], pendingCount: 0 } : swingVerification };
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

export async function createBrowserFixture({ scenario } = {}) {
  assert.ok(SCENARIOS.has(scenario), `未知 browser scenario：${scenario}`);
  const server = await bootServer({ routes: [], env: { UPDATE_CHECK: "off", DISABLE_CLOSE_SCHEDULER: "1" } });
  assert.notEqual(new URL(server.baseUrl).port, "5174", "瀏覽器測試不得使用正式埠 5174");
  assert.doesNotMatch(server.dataDir, /[\\/]\.data(?:[\\/]|$)/, "瀏覽器測試不得使用正式 .data");

  let browser;
  let context;
  let page;
  let textZoomSession;
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
    const allowedOrigin = new URL(server.baseUrl).origin;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== allowedOrigin) {
        externalRequests.push(request.url());
        await route.abort("blockedbyclient");
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
  } catch (error) {
    if (traceActive) await context?.tracing.stop().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await server.close().catch(() => {});
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
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
    },
    emulateTextZoom: async (factor) => {
      const setup = await page.evaluate((zoomFactor) => {
        const trackedSelectors = [".swing-nm", ".swing-stat strong", ".swing-open", ".swing-plan-alerts"];
        const tracked = trackedSelectors.map((selector) => {
          const node = document.querySelector(selector);
          return { selector, node, before: node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0 };
        });
        const elements = [...document.body.querySelectorAll("*")];
        const originalSizes = elements.map((node) => Number.parseFloat(getComputedStyle(node).fontSize));
        const rules = [];
        elements.forEach((node, index) => {
          const size = originalSizes[index];
          if (!Number.isFinite(size) || size <= 0) return;
          node.dataset.browserTextZoom = String(index);
          rules.push(`[data-browser-text-zoom="${index}"]{font-size:${size * zoomFactor}px !important}`);
        });
        return {
          rules: rules.join("\n"),
          tracked: tracked.map(({ selector, before }) => ({ selector, before })),
        };
      }, factor);
      textZoomSession = await context.newCDPSession(page);
      await textZoomSession.send("DOM.enable");
      await textZoomSession.send("CSS.enable");
      const frameTree = await textZoomSession.send("Page.getFrameTree");
      const { styleSheetId } = await textZoomSession.send("CSS.createStyleSheet", {
        frameId: frameTree.frameTree.frame.id,
      });
      await textZoomSession.send("CSS.setStyleSheetText", { styleSheetId, text: setup.rules });
      const measurements = await page.evaluate((tracked) => tracked.map(({ selector, before }) => {
        const node = document.querySelector(selector);
        return {
          selector,
          before,
          after: node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0,
        };
      }), setup.tracked);
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
        () => textZoomSession?.detach(),
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
