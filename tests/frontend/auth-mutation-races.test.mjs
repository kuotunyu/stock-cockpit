// 帳號範圍與整包同步競態：舊帳號／舊 GET 回應不可污染目前帳號或較新的 canonical 狀態。
import assert from "node:assert/strict";
import test from "node:test";
import { createAppWindow } from "../helpers/dom-harness.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const USER_A = { id: "race-user-a", username: "alpha", displayName: "甲帳號", role: "admin" };
const USER_B = { id: "race-user-b", username: "beta", displayName: "乙帳號", role: "user" };
const SETTINGS = { feeDiscount: 0.6, minFee: 20 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitUntil(app, predicate, message) {
  for (let round = 0; round < 30; round += 1) {
    if (predicate()) return;
    await app.settle(1);
  }
  assert.fail(message);
}

function emptyPortfolio() {
  return {
    ok: true,
    holdings: [],
    realized: [],
    totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 },
  };
}

test("交易 409 retry：A 的延遲 GET 在切換 B 後不可重送或污染 B 帳本", async (t) => {
  let phase = "init";
  let putCount = 0;
  let secondPutBody = null;
  const staleGet = deferred();
  const staleARecord = {
    id: "stale-a",
    code: "1111",
    side: "buy",
    kind: "stock",
    price: 10,
    shares: 100,
    date: compactToday(-3),
    fee: 20,
    tax: 0,
  };
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/trades": (_raw, init) => {
        if (phase === "init") {
          return { ok: true, settings: SETTINGS, records: [], portfolio: emptyPortfolio(), rev: 0 };
        }
        if (init?.method === "PUT") {
          putCount += 1;
          if (putCount === 1) {
            return { ok: false, code: "REV_CONFLICT", error: "資料已更新", rev: 1, __status: 409 };
          }
          secondPutBody = JSON.parse(init.body);
          return {
            ok: true,
            settings: secondPutBody.settings,
            records: secondPutBody.records,
            portfolio: emptyPortfolio(),
            rev: 2,
          };
        }
        return staleGet.promise;
      },
    },
  });
  t.after(() => app.cleanup());

  app.evalIn(`
    activateAuthenticatedUser(${JSON.stringify(USER_A)});
    applyTradesPayload({ settings: ${JSON.stringify(SETTINGS)}, records: [], portfolio: ${JSON.stringify(emptyPortfolio())}, rev: 0 });
  `);
  phase = "race";
  const mutation = app.evalIn(`addTradeRecord({
    code: "2222", side: "buy", kind: "stock", price: 20, shares: 100, date: "${compactToday(-2)}"
  })`);
  await waitUntil(app, () => putCount === 1, "第一次 PUT 應先收到 409");

  app.evalIn(`
    activateAuthenticatedUser(${JSON.stringify(USER_B)});
    applyTradesPayload({ settings: { feeDiscount: 0.45, minFee: 20 }, records: [], portfolio: ${JSON.stringify(emptyPortfolio())}, rev: 0 });
  `);
  staleGet.resolve({
    ok: true,
    settings: SETTINGS,
    records: [staleARecord],
    portfolio: emptyPortfolio(),
    rev: 1,
  });
  await mutation;

  assert.equal(app.evalIn("authState.user.id"), USER_B.id);
  assert.equal(putCount, 1, "帳號已切換後不可用 A 的 GET 結果對 B 發第二次 PUT");
  assert.equal(secondPutBody, null);
  assert.deepEqual(
    JSON.parse(app.evalIn("JSON.stringify(tradesState.records)")),
    [],
    "B 的帳本不可被 A 的舊紀錄或未完成操作污染",
  );
});

test("冷啟動 auth/me=401：清除未驗證的 legacy localStorage 自選股", async (t) => {
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/auth/me": { ok: false, code: "AUTH_REQUIRED", error: "登入已逾期", __status: 401 },
    },
    beforeApp(win) {
      win.localStorage.setItem("stock1-watch-lists-v1", JSON.stringify({ 1: ["9292"], 2: [], 3: [] }));
    },
  });
  t.after(() => app.cleanup());

  assert.equal(app.evalIn("authState.user"), null);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify([...watchLists[1]])")), []);
  assert.equal(app.evalIn("getTrackedQuoteCodes().includes('9292')"), false);
  assert.equal(app.evalIn("localStorage.getItem(WATCH_LIST_STORAGE_KEY)"), null);
});

test("同帳號延遲 GET：不可蓋掉 watch／alerts／trades 較新的 PUT canonical", async (t) => {
  let phase = "init";
  const staleWatch = deferred();
  const staleAlerts = deferred();
  const staleTrades = deferred();
  let watchGetStarted = false;
  let alertsGetStarted = false;
  let tradesGetStarted = false;
  const newTrade = {
    id: "new-trade",
    code: "7777",
    side: "buy",
    kind: "stock",
    price: 77,
    shares: 100,
    date: compactToday(-1),
    fee: 20,
    tax: 0,
  };
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/watchlists": (_raw, init) => {
        if (phase === "init") return { ok: true, lists: { 1: [], 2: [], 3: [] }, rev: 0 };
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body);
          return { ok: true, lists: body.lists, rev: 1 };
        }
        watchGetStarted = true;
        return staleWatch.promise;
      },
      "/api/alerts": (_raw, init) => {
        if (phase === "init") return { ok: true, alerts: [], rev: 0 };
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body);
          return { ok: true, alerts: body.alerts, rev: 1 };
        }
        alertsGetStarted = true;
        return staleAlerts.promise;
      },
      "/api/trades": (_raw, init) => {
        if (phase === "init") {
          return { ok: true, settings: SETTINGS, records: [], portfolio: emptyPortfolio(), rev: 0 };
        }
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body);
          return { ok: true, settings: body.settings, records: body.records, portfolio: emptyPortfolio(), rev: 1 };
        }
        tradesGetStarted = true;
        return staleTrades.promise;
      },
    },
  });
  t.after(() => app.cleanup());

  phase = "race";
  const oldLoads = app.evalIn("Promise.all([loadWatchListsFromServer(), loadAlertsFromServer(), loadTradesFromServer()])");
  await waitUntil(
    app,
    () => watchGetStarted && alertsGetStarted && tradesGetStarted,
    "三個舊 GET 都應已送出",
  );

  await app.evalIn(`
    watchLists[1] = new Set(["9999"]);
    watchListMutationVersion += 1;
    syncWatchListsToServer()
  `);
  await app.evalIn(`
    priceAlertsState.alerts = [{ id: "new-alert", code: "8888", op: ">=", price: 88, active: true, triggeredAt: "" }];
    alertMutationVersion += 1;
    syncAlertsToServer()
  `);
  await app.evalIn(`putTrades({
    settings: ${JSON.stringify(SETTINGS)},
    records: [${JSON.stringify(newTrade)}]
  })`);

  staleWatch.resolve({ ok: true, lists: { 1: [], 2: [], 3: [] }, rev: 0 });
  staleAlerts.resolve({ ok: true, alerts: [], rev: 0 });
  staleTrades.resolve({ ok: true, settings: SETTINGS, records: [], portfolio: emptyPortfolio(), rev: 0 });
  await oldLoads;

  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify([...watchLists[1]])")), ["9999"]);
  assert.equal(app.evalIn("watchListsRev"), 1);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(priceAlertsState.alerts.map((alert) => alert.code))")), ["8888"]);
  assert.equal(app.evalIn("priceAlertsState.rev"), 1);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(tradesState.records.map((record) => record.code))")), ["7777"]);
  assert.equal(app.evalIn("tradesState.rev"), 1);
  assert.deepEqual(JSON.parse(app.evalIn("localStorage.getItem(WATCH_LIST_STORAGE_KEY)")), {
    1: ["9999"], 2: [], 3: [],
  });
});

test("clearUserScopedState：離開更多頁後 hidden #moreDetail 不可殘留帳號秘密", async (t) => {
  const app = await createAppWindow();
  t.after(() => app.cleanup());
  const secret = "friend-secret-account";

  app.evalIn(`
    authState.user = ${JSON.stringify(USER_A)};
    adminUsersState.users = [{ id: "secret-user", username: "${secret}", displayName: "秘密朋友", role: "user" }];
    state.screen = "more";
    state.morePanel = "system";
    render();
  `);
  assert.equal(app.evalIn(`document.querySelector("#moreDetail").textContent.includes("${secret}")`), true);

  app.evalIn(`
    state.screen = "overnight";
    render();
    clearUserScopedState();
  `);

  assert.equal(app.evalIn(`document.querySelector("#moreDetail").textContent.includes("${secret}")`), false);
  assert.equal(app.evalIn(`document.body.textContent.includes("${secret}")`), false);
});
