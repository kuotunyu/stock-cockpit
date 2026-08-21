// 背景到價監看：分頁切走後仍要判斷到價，但不可因此放寬新鮮度門檻、灌水資料可信度，
// 或在沒有提醒時憑空連網。
//
// 為什麼需要：到價判斷原本整條掛在 refreshLiveData 上，而它第一行就是
// `if (document.hidden) return`——分頁切走、視窗最小化就完全不判斷。
// 這裡釘住新增的背景路徑，以及它刻意保留的四道界線：
//   ① 前景不跑（避免兩條路各打一次）②沒有等待中的提醒就一個 request 都不發
//   ③ 只在盤中、最快 30 秒一輪 ④用跟前景一模一樣的 eligible 門檻，不用昨收誤觸發
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;

const USER = { id: "alert-user", username: "admin", displayName: "管理者", role: "admin" };

function quote(overrides = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    code: "2330",
    name: "台積電",
    market: "TWSE",
    price: 1100,
    previousClose: 1000,
    change: 100,
    changePct: 10,
    sourceKind: "realtime",
    priceStale: false,
    asOf: today,
    ...overrides,
  };
}

// 背景路徑的共同前提：已登入、有一筆等待中的提醒、分頁隱藏、盤中、官方來源。
function armBackgroundAlert(app, { quotes = [quote()], hidden = true, session = true } = {}) {
  app.evalIn(`
    activateAuthenticatedUser(${JSON.stringify(USER)});
    authState.checked = true;
    window.__quoteCalls = [];
    window.__quotePayload = ${JSON.stringify({ ok: true, quotes, generatedAt: new Date().toISOString(), realtimeCount: quotes.length, fallbackCount: 0 })};
    ensureMarketSessionStatus = async () => null;
    isTaiwanMarketSession = () => ${JSON.stringify(session)};
    isTaiwanFuturesNightSession = () => false;
    const realFetchApi = fetchApi;
    fetchApi = async (path, options) => {
      if (path.startsWith("/api/quotes")) {
        window.__quoteCalls.push(path);
        return window.__quotePayload;
      }
      if (path.startsWith("/api/alerts")) return { ok: true, alerts: priceAlertsState.alerts, rev: priceAlertsState.rev };
      return realFetchApi(path, options);
    };
    priceAlertsState.alerts = [
      { id: "a1", code: "2330", op: ">=", price: 1050, note: "", active: true, createdAt: "2026-08-01T00:00:00.000Z", triggeredAt: "" },
    ];
    priceAlertsState.loaded = true;
    Object.defineProperty(document, "hidden", { configurable: true, value: ${JSON.stringify(hidden)} });
  `);
}

function alertState(app) {
  return JSON.parse(app.evalIn("JSON.stringify(priceAlertsState.alerts[0])"));
}

beforeEach(async () => {
  app = await createAppWindow();
});

afterEach(() => app.cleanup());

test("分頁隱藏時到價仍會觸發，且只抓有提醒的那幾檔", async () => {
  armBackgroundAlert(app);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);

  const calls = JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)"));
  assert.equal(calls.length, 1, "應該打了一次報價");
  assert.match(calls[0], /codes=2330(&|$)/, "只抓有提醒的代號，不是整個市場");
  assert.ok(alertState(app).triggeredAt, "到價要被標記為已觸發");
  assert.equal(alertState(app).active, false);
});

test("前景時背景路徑必須完全不動（前景由 refreshLiveData 負責）", async () => {
  armBackgroundAlert(app, { hidden: false });
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")), []);
  assert.equal(alertState(app).triggeredAt, "");

  // 而且要在**進入函式的第一步**就退出，不能跑到「取得市場時段之後才發現是前景」——
  // 那樣會先把 30 秒節流的額度用掉，害真正切到背景後的第一輪被自己擋下來。
  app.evalIn(`Object.defineProperty(document, "hidden", { configurable: true, value: true });`);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.equal(
    JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")).length,
    1,
    "切到背景後應該立刻跑得起來，不該被前景那次呼叫的節流時間戳擋住",
  );
  assert.ok(alertState(app).triggeredAt);
});

test("沒有等待中的提醒就一個 request 都不發", async () => {
  armBackgroundAlert(app);
  app.evalIn(`priceAlertsState.alerts = [];`);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")), []);

  // 已觸發過的提醒也算「沒有等待中」——不可為了它繼續每 30 秒連網。
  app.evalIn(`priceAlertsState.alerts = [{ id: "done", code: "2330", op: ">=", price: 10, active: false, triggeredAt: "2026-08-01T01:00:00.000Z" }];`);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")), []);
});

test("非盤中不判斷（夜盤個股不動，判了也只是拿舊價重算）", async () => {
  armBackgroundAlert(app, { session: false });
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")), []);
  assert.equal(alertState(app).triggeredAt, "");
});

test("30 秒節流：連續呼叫只會真的跑一輪", async () => {
  armBackgroundAlert(app);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  app.evalIn(`priceAlertsState.alerts[0].triggeredAt = ""; priceAlertsState.alerts[0].active = true;`);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.equal(JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")).length, 1, "第二次應該被節流擋下");
});

test("新鮮度門檻與前景一致：昨收備援價不得觸發背景提醒", async () => {
  armBackgroundAlert(app, {
    quotes: [quote({ sourceKind: "fallback", priceStale: true })],
  });
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.equal(JSON.parse(app.evalIn("JSON.stringify(window.__quoteCalls)")).length, 1, "有打報價");
  assert.equal(alertState(app).triggeredAt, "", "但 priceStale 的價格不得觸發");
});

test("背景的部分更新不得寫進 dataState（否則資料可信度會把幾檔講成整個市場）", async () => {
  armBackgroundAlert(app);
  const before = JSON.parse(app.evalIn(`JSON.stringify({
    lastUpdated: dataState.lastUpdated,
    realtimeCount: dataState.realtimeCount,
    quoteCount: dataState.quoteCount,
    mode: dataState.mode,
  })`));
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  const after = JSON.parse(app.evalIn(`JSON.stringify({
    lastUpdated: dataState.lastUpdated,
    realtimeCount: dataState.realtimeCount,
    quoteCount: dataState.quoteCount,
    mode: dataState.mode,
  })`));
  assert.deepEqual(after, before);
});

// ===== 桌面通知 =====
function installFakeNotification(app, permission = "granted") {
  app.evalIn(`
    window.__notifications = [];
    window.Notification = function (title, options) {
      window.__notifications.push({ title, body: options?.body || "", tag: options?.tag || "" });
      this.close = () => {};
    };
    window.Notification.permission = ${JSON.stringify(permission)};
    window.Notification.requestPermission = async () => window.Notification.permission;
  `);
}

test("隱藏時到價會發桌面通知，tag 用 alert id 讓多筆不會被併成一則", async () => {
  armBackgroundAlert(app);
  installFakeNotification(app);
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  const notes = JSON.parse(app.evalIn("JSON.stringify(window.__notifications)"));
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /台積電 2330 到價/);
  assert.match(notes[0].body, /現價/);
  assert.equal(notes[0].tag, "stock1-alert-a1");
});

test("使用者正在看畫面時不發系統通知（toast＋音效就夠，不重複吵）", async () => {
  armBackgroundAlert(app, { hidden: false });
  installFakeNotification(app);
  app.evalIn(`
    document.hasFocus = () => true;
    // 直接走前景的判斷路徑
    stocks.length = 0;
    upsertStockFromQuote(window.__quotePayload.quotes[0]);
    checkPriceAlerts(eligibleAlertQuoteCodes(window.__quotePayload.quotes), { renderNow: false });
  `);
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__notifications)")), []);
  assert.ok(alertState(app).triggeredAt, "前景仍然要正常觸發，只是不發系統通知");
});

test("視窗被蓋住（沒隱藏但失焦）也要發通知", async () => {
  armBackgroundAlert(app, { hidden: false });
  installFakeNotification(app);
  app.evalIn(`
    document.hasFocus = () => false;
    stocks.length = 0;
    upsertStockFromQuote(window.__quotePayload.quotes[0]);
    checkPriceAlerts(eligibleAlertQuoteCodes(window.__quotePayload.quotes), { renderNow: false });
  `);
  await app.settle(2);
  assert.equal(JSON.parse(app.evalIn("JSON.stringify(window.__notifications)")).length, 1);
});

test("沒有授權就不發通知，但到價判斷照跑", async () => {
  armBackgroundAlert(app);
  installFakeNotification(app, "denied");
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(window.__notifications)")), []);
  assert.ok(alertState(app).triggeredAt, "沒有通知權限不影響到價判斷本身");
});

test("瀏覽器不支援 Notification 時整條路徑不得拋錯", async () => {
  armBackgroundAlert(app);
  app.evalIn("delete window.Notification;");
  assert.equal(app.evalIn("priceAlertNotificationPermission()"), "unsupported");
  await app.evalIn("refreshBackgroundPriceAlerts()");
  await app.settle(2);
  assert.ok(alertState(app).triggeredAt);
  assert.deepEqual(app.jsdomErrors, []);
});

test("已被封鎖時不重複要求權限（瀏覽器會直接忽略，重問只會像按了沒反應）", async () => {
  installFakeNotification(app, "denied");
  app.evalIn(`
    window.__permissionAsks = 0;
    window.Notification.requestPermission = async () => { window.__permissionAsks += 1; return "denied"; };
  `);
  await app.evalIn("requestPriceAlertNotifications({ silent: true })");
  await app.settle(2);
  assert.equal(app.evalIn("window.__permissionAsks"), 0);

  app.evalIn(`window.Notification.permission = "default";`);
  await app.evalIn("requestPriceAlertNotifications({ silent: true })");
  await app.settle(2);
  assert.equal(app.evalIn("window.__permissionAsks"), 1, "尚未決定時才問");
});
