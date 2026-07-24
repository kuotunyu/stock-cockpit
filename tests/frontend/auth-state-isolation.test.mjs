// 驗證帳號登出／失效時清除私人前端資料，且舊帳號的延遲回應不會污染新帳號。
import assert from "node:assert/strict";
import test from "node:test";
import { createAppWindow } from "../helpers/dom-harness.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const USER_A = { id: "user-a", username: "alpha", displayName: "甲帳號", role: "user" };
const USER_B = { id: "user-b", username: "beta", displayName: "乙帳號", role: "user" };

const PRIVATE_A = {
  lists: { 1: ["9292"], 2: [], 3: [] },
  alerts: [{ id: "alert-a", code: "9191", op: ">=", price: 91, active: true, triggeredAt: "" }],
  settings: { feeDiscount: 0.6, minFee: 20 },
  records: [{ id: "trade-a", code: "9393", side: "buy", kind: "stock", price: 93, shares: 1000, date: compactToday(-2), fee: 80, tax: 0 }],
  portfolio: {
    holdings: [{ code: "9393", shares: 1000, avgCost: 93, cost: 93080, dividends: 0 }],
    totals: { cost: 93080, realizedPnl: 0, dividendIncome: 0 },
    realized: [],
  },
};

const PRIVATE_B = {
  lists: { 1: [], 2: ["8292"], 3: [] },
  alerts: [{ id: "alert-b", code: "8191", op: "<=", price: 81, active: true, triggeredAt: "" }],
  settings: { feeDiscount: 0.45, minFee: 20 },
  records: [{ id: "trade-b", code: "8393", side: "buy", kind: "stock", price: 83, shares: 2000, date: compactToday(-1), fee: 120, tax: 0 }],
  portfolio: {
    holdings: [{ code: "8393", shares: 2000, avgCost: 83, cost: 166120, dividends: 0 }],
    totals: { cost: 166120, realizedPnl: 0, dividendIncome: 0 },
    realized: [],
  },
};

function accountRoutes(overrides = {}) {
  return {
    "/api/auth/me": { ok: true, user: USER_A, warnings: {} },
    "/api/auth/login": { ok: true, user: USER_B, warnings: {} },
    "/api/auth/logout": { ok: true },
    "/api/watchlists": { ok: true, lists: PRIVATE_A.lists, rev: 11 },
    "/api/alerts": { ok: true, alerts: PRIVATE_A.alerts, rev: 12 },
    "/api/trades": { ok: true, settings: PRIVATE_A.settings, records: PRIVATE_A.records, portfolio: PRIVATE_A.portfolio, rev: 13 },
    "/api/broker/settings": { ok: true, configured: false },
    "/api/sources": { ok: true, sources: { official: { available: true }, broker: { configured: false } } },
    "/api/markets": { ok: true },
    "/api/overnight": { ok: true, signals: [] },
    ...overrides,
  };
}

function privateSnapshot(app) {
  return JSON.parse(app.evalIn(`JSON.stringify({
    watch: Object.values(watchLists).flatMap((list) => [...list]),
    watchRev: watchListsRev,
    alerts: priceAlertsState.alerts,
    alertsLoaded: priceAlertsState.loaded,
    alertsRev: priceAlertsState.rev,
    records: tradesState.records,
    portfolio: tradesState.portfolio,
    tradesLoaded: tradesState.loaded,
    tradesRev: tradesState.rev,
    mutating: tradesState.mutating,
    tracked: getTrackedQuoteCodes()
  })`));
}

function renderPrivateDom(app) {
  app.evalIn(`
    state.screen = "watchlist";
    state.watchList = "hold";
    render();
    state.screen = "more";
    state.morePanel = "alerts";
    render();
  `);
}

function assertUserScopeCleared(app) {
  const snapshot = privateSnapshot(app);
  assert.deepEqual(snapshot.watch, [], "三組自選股不可殘留前一個帳號的代號");
  assert.equal(snapshot.watchRev, 0, "自選股 rev 應回到未載入狀態");
  assert.deepEqual(snapshot.alerts, [], "到價提醒應清空");
  assert.equal(snapshot.alertsLoaded, false);
  assert.equal(snapshot.alertsRev, 0);
  assert.deepEqual(snapshot.records, [], "交易紀錄應清空");
  assert.equal(snapshot.portfolio, null, "庫存彙總應清空");
  assert.equal(snapshot.tradesLoaded, false);
  assert.equal(snapshot.tradesRev, 0);
  assert.equal(snapshot.mutating, false);
  for (const code of ["9191", "9292", "9393"]) {
    assert.equal(snapshot.tracked.includes(code), false, `${code} 不可再進入即時報價追蹤`);
    assert.equal(app.doc.body.textContent.includes(code), false, `${code} 不可殘留在可讀或隱藏 DOM`);
  }
  assert.match(app.doc.body.textContent, /登入後才能設定與同步到價提醒|庫存損益需要登入/);
}

test("logout 會同步清空自選、提醒、帳本、隱藏 DOM 與私人追蹤代號", async (t) => {
  const app = await createAppWindow({ fetchRoutes: accountRoutes() });
  t.after(() => app.cleanup());

  renderPrivateDom(app);
  const before = privateSnapshot(app);
  assert.ok(before.tracked.includes("9191"));
  assert.ok(before.tracked.includes("9292"));
  assert.ok(before.tracked.includes("9393"));
  assert.match(app.doc.body.textContent, /9191/);
  assert.match(app.doc.body.textContent, /9393/);

  await app.evalIn("logout()");

  assert.equal(app.evalIn("authState.user"), null);
  assertUserScopeCleared(app);
});

test("任何受保護 API 回 401 時，也走同一套私人資料清除流程", async (t) => {
  const app = await createAppWindow({ fetchRoutes: accountRoutes() });
  t.after(() => app.cleanup());

  renderPrivateDom(app);
  const handled = app.evalIn(`handleAuthRequired(Object.assign(new Error("登入已逾期"), { status: 401, code: "AUTH_REQUIRED" }))`);

  assert.equal(handled, true);
  assert.equal(app.evalIn("authState.user"), null);
  assertUserScopeCleared(app);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("A 的延遲 watchlists／alerts／trades 回應在 B 登入後一律作廢", async (t) => {
  let phase = "initial";
  const staleWatch = deferred();
  const staleAlerts = deferred();
  const staleTrades = deferred();
  const routes = accountRoutes({
    "/api/watchlists": () => {
      if (phase === "stale-a") return staleWatch.promise;
      const owner = phase === "login-b" ? PRIVATE_B : PRIVATE_A;
      return { ok: true, lists: owner.lists, rev: phase === "login-b" ? 21 : 11 };
    },
    "/api/alerts": () => {
      if (phase === "stale-a") return staleAlerts.promise;
      const owner = phase === "login-b" ? PRIVATE_B : PRIVATE_A;
      return { ok: true, alerts: owner.alerts, rev: phase === "login-b" ? 22 : 12 };
    },
    "/api/trades": () => {
      if (phase === "stale-a") return staleTrades.promise;
      const owner = phase === "login-b" ? PRIVATE_B : PRIVATE_A;
      return { ok: true, settings: owner.settings, records: owner.records, portfolio: owner.portfolio, rev: phase === "login-b" ? 23 : 13 };
    },
  });
  const app = await createAppWindow({ fetchRoutes: routes });
  t.after(() => app.cleanup());

  phase = "stale-a";
  const staleLoads = app.evalIn("Promise.all([loadWatchListsFromServer(), loadAlertsFromServer(), loadTradesFromServer()])");
  await app.settle(1);

  await app.evalIn("logout()");
  phase = "login-b";
  await app.evalIn(`loginWithCredentials("beta", "pw")`);
  renderPrivateDom(app);

  staleWatch.resolve({ ok: true, lists: PRIVATE_A.lists, rev: 31 });
  staleAlerts.resolve({ ok: true, alerts: PRIVATE_A.alerts, rev: 32 });
  staleTrades.resolve({ ok: true, settings: PRIVATE_A.settings, records: PRIVATE_A.records, portfolio: PRIVATE_A.portfolio, rev: 33 });
  await staleLoads;
  await app.settle(1);

  assert.equal(app.evalIn("authState.user.id"), USER_B.id);
  const snapshot = privateSnapshot(app);
  assert.deepEqual(snapshot.watch, ["8292"]);
  assert.equal(snapshot.watchRev, 21);
  assert.deepEqual(snapshot.alerts.map((alert) => alert.code), ["8191"]);
  assert.equal(snapshot.alertsRev, 22);
  assert.deepEqual(snapshot.records.map((record) => record.code), ["8393"]);
  assert.equal(snapshot.portfolio.holdings[0].code, "8393");
  assert.equal(snapshot.tradesRev, 23);
  assert.equal(snapshot.tracked.includes("8191"), true);
  assert.equal(snapshot.tracked.includes("8292"), true);
  assert.equal(snapshot.tracked.includes("8393"), true);
  for (const code of ["9191", "9292", "9393"]) {
    assert.equal(snapshot.tracked.includes(code), false, `${code} 是 A 的私人資料，不可污染 B`);
    assert.equal(app.doc.body.textContent.includes(code), false, `${code} 不可被 A 的慢回應重新畫回 DOM`);
  }
});
