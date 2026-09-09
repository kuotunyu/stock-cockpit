// 訪客到帳本的登入銜接（computer use 心得 F06／CUA-06）：
// 庫存空態與到價提醒框只叫人「到更多 → 帳號管理」，沒有原地入口；登入頁說「登入後才有自選股」但訪客本來就能加自選；
// 更嚴重的是訪客的本機自選在每次重載都被 /me 401 路徑清掉（N1）。登入成功後焦點也要有明確落點：
// activateAuthenticatedUser 會先清空 panel，舊登入按鈕不在，若不另行聚焦，焦點會留在已隱藏的登入閘裡落空（N5 修正後的實際結論）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const apps = [];
after(() => apps.forEach((app) => app.cleanup()));

const GUEST_ROUTES = { "/api/auth/me": { __status: 401, code: "AUTH_REQUIRED", error: "需要先登入" } };
const json = (app, expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

async function guestApp(options = {}) {
  const app = await createAppWindow({ fetchRoutes: GUEST_ROUTES, ...options });
  apps.push(app);
  await app.settle();
  return app;
}

test("訪客庫存空態：原地「登入以使用交易帳本」按鈕開登入閘並記住來源；不再只叫人去更多→帳號管理", async () => {
  const app = await guestApp();
  const result = json(app, `(() => {
    state.screen = "watchlist"; state.watchList = "hold"; render();
    const button = el.holdingsPanel.querySelector("[data-login-holdings]");
    if (!button) return { missing: true, text: el.holdingsPanel.textContent };
    button.focus(); button.click();
    return {
      missing: false, label: button.textContent.trim(),
      gateOpen: !document.getElementById("loginGate").hidden,
      message: document.getElementById("loginMessage").textContent,
      intent: authState.loginIntent,
      oldDetour: /更多 → 帳號管理/.test(el.holdingsPanel.textContent),
    };
  })()`);
  assert.equal(result.missing, false, `庫存空態要有登入按鈕：${result.text || ""}`);
  assert.match(result.label, /登入以使用交易帳本/);
  assert.equal(result.gateOpen, true);
  assert.match(result.message, /交易帳本/);
  assert.equal(result.intent, "holdings");
  assert.equal(result.oldDetour, false);
  app.evalIn(`closeDialogLayer(document.getElementById("loginGate"), { restoreFocus: false }); authState.loginIntent = null;`);
});

test("訪客到價提醒框：原地「登入後建立提醒」按鈕，不再指去更多→帳號管理", async () => {
  const app = await guestApp();
  const result = json(app, `(() => {
    stocks.length = 0;
    stocks.push({ code: "2330", name: "台積電", price: 1000, spark: [], groups: [], strategies: [] });
    state.selectedCode = "2330";
    renderPriceAlertBox(stocks[0]);
    const button = el.priceAlertBox.querySelector("[data-login-alerts]");
    if (!button) return { missing: true, text: el.priceAlertBox.textContent };
    button.focus(); button.click();
    return { missing: false, label: button.textContent.trim(), gateOpen: !document.getElementById("loginGate").hidden, intent: authState.loginIntent,
      oldDetour: /更多 → 帳號管理/.test(el.priceAlertBox.textContent) };
  })()`);
  assert.equal(result.missing, false, `提醒框要有登入按鈕：${result.text || ""}`);
  assert.match(result.label, /登入後建立提醒/);
  assert.equal(result.gateOpen, true);
  assert.equal(result.intent, "alerts");
  assert.equal(result.oldDetour, false);
  app.evalIn(`closeDialogLayer(document.getElementById("loginGate"), { restoreFocus: false }); authState.loginIntent = null;`);
});

test("取消登入：登入閘開著時行情輪詢重繪了庫存區，關閉後焦點仍回到同身分的新登入按鈕，來源清空", async () => {
  const app = await guestApp();
  app.evalIn(`
    state.screen = "watchlist"; state.watchList = "hold"; render();
    window.__loginButton = el.holdingsPanel.querySelector("[data-login-holdings]");
    window.__loginButton.focus(); window.__loginButton.click();
  `);
  await app.settle(8); // 登入閘的初始焦點在 requestAnimationFrame 內才移到帳號欄（jsdom 約 16ms 一幀）
  const rerendered = json(app, `(() => {
    // 模擬 10 秒輪詢：登入閘開著、焦點在帳號欄，panel 不在 activeElement 內所以會真的重繪，舊按鈕節點被換掉。
    const focusInGate = document.getElementById("loginGate").contains(document.activeElement);
    renderHoldingsPanel();
    const replaced = el.holdingsPanel.querySelector("[data-login-holdings]") !== window.__loginButton;
    document.getElementById("loginClose").click();
    return { focusInGate, replaced };
  })()`);
  assert.equal(rerendered.focusInGate, true, "前提：登入閘開啟後焦點在閘內");
  assert.equal(rerendered.replaced, true, "前提：輪詢重繪換掉了原本的 opener 節點");
  await app.settle(3);
  const result = json(app, `({ gateOpen: !document.getElementById("loginGate").hidden, intent: authState.loginIntent,
    focusedLoginButton: document.activeElement === el.holdingsPanel.querySelector("[data-login-holdings]"),
    stillGuest: authState.user === null })`);
  assert.equal(result.gateOpen, false);
  assert.equal(result.intent, null);
  assert.equal(result.focusedLoginButton, true, "取消要回到同身分的新登入按鈕（openerResolver）");
  assert.equal(result.stillGuest, true);
});

test("登入成功：庫存直接顯示帳本表單，焦點落在表單代號欄，而不是被移除的登入按鈕", async () => {
  const app = await guestApp();
  const result = JSON.parse(await app.evalIn(`(async () => {
    state.screen = "watchlist"; state.watchList = "hold"; render();
    const button = el.holdingsPanel.querySelector("[data-login-holdings]");
    button.focus(); button.click();
    const now = new Date().toISOString();
    const routes = {
      "/api/auth/login": { ok: true, user: { id: "u9", username: "friend", displayName: "朋友", role: "user" }, warnings: {} },
      // 第一個載入慢一點回來，讓關閘的回焦 rAF 在任何回應之前先觸發，時序與真瀏覽器一致。
      // 實測：activateAuthenticatedUser 已先清空 panel，舊按鈕不在，回焦不會發生；沒有明確聚焦的話焦點會留在隱藏的登入閘裡落空。
      "/api/watchlists": new Promise((resolve) => setTimeout(() => resolve({ ok: true, rev: 1, lists: { 1: [], 2: [], 3: [] } }), 60)),
      "/api/alerts": { ok: true, rev: 1, alerts: [] },
      "/api/trades": { ok: true, schemaVersion: 2, rev: 1, settings: { feeDiscount: 0.6, minFee: 20 }, records: [], quarantinedRecords: [],
        portfolio: { holdings: [], realized: [], totals: { cost: 0, marketValue: 0, unrealizedPnl: 0, realizedPnl: 0 } }, missingCorporateActions: [] },
      "/api/broker/settings": { configured: false, connected: false, message: "未設定" },
      "/api/sources": { ok: true, selected: "official", sources: { official: { ready: true, label: "官方資料" }, broker: { ready: false, message: "未設定" } } },
      "/api/quotes": { ok: true, sourceKey: "official", source: "測試", generatedAt: now, realtimeCount: 0, fallbackCount: 0, warnings: [], quotes: [] },
      "/api/markets": { ok: true, source: "測試", generatedAt: now, warnings: [], markets: {} },
      "/api/overnight": { ok: true, asOf: "2026-09-08", source: "測試", surveillanceCount: 0, warnings: [], groups: { strongContinuation: [], volumeDanger: [], pullbackReversal: [] } },
    };
    window.__origFetchApi = fetchApi;
    fetchApi = async (path) => {
      const key = Object.keys(routes).find((prefix) => String(path).startsWith(prefix));
      if (key) return routes[key];
      throw Object.assign(new Error("unrouted " + path), { status: 404 });
    };
    try { await loginWithCredentials("friend", "pw"); } finally { fetchApi = window.__origFetchApi; }
    await new Promise((resolve) => setTimeout(resolve, 40));
    const active = document.activeElement;
    return JSON.stringify({
      user: authState.user ? authState.user.username : null,
      gateOpen: !document.getElementById("loginGate").hidden,
      panelText: el.holdingsPanel.textContent.replace(/\\s+/g, " ").slice(0, 160),
      hasForm: Boolean(el.holdingsPanel.querySelector("[data-trade-form]")),
      activeInPanel: el.holdingsPanel.contains(active),
      activeName: active ? (active.getAttribute("name") || active.tagName) : null,
      intent: authState.loginIntent,
    });
  })()`));
  assert.equal(result.user, "friend");
  assert.equal(result.gateOpen, false);
  assert.doesNotMatch(result.panelText, /需要登入/, "登入後庫存不可卡在需要登入畫面");
  assert.equal(result.hasForm, true, "登入後要看到記一筆表單");
  assert.equal(result.activeInPanel, true, "焦點要留在庫存區");
  assert.equal(result.activeName, "code", "焦點落在表單代號欄");
  assert.equal(result.intent, null);
});

test("從未登入過的訪客：/me 401 不清本機自選，重新整理後清單還在，登入閘維持安靜", async () => {
  const app = await guestApp({
    beforeApp: (win) => {
      win.localStorage.removeItem("stock1.hadSession.v1");
      win.localStorage.setItem("stock1-watch-lists-v1", JSON.stringify({ 1: ["2330", "0050"], 2: ["6488"], 3: [] }));
    },
  });
  assert.equal(app.evalIn(`authState.user`), null);
  assert.equal(app.evalIn(`watchLists[1].has("2330") && watchLists[1].has("0050") && watchLists[2].has("6488")`), true, "訪客本機自選不得被 401 清掉");
  assert.deepEqual(JSON.parse(app.evalIn(`localStorage.getItem("stock1-watch-lists-v1")`)), { 1: ["2330", "0050"], 2: ["6488"], 3: [] });
  assert.equal(app.evalIn(`document.getElementById("loginGate").hidden`), true, "從沒登入過的 401 維持安靜");
});

test("從未登入過的訪客：/me 回 503 或斷線也不清本機自選（沒有東西可清，不看狀態碼）", async () => {
  const app = await guestApp({
    fetchRoutes: { "/api/auth/me": { __status: 503, error: "暫時無法確認登入狀態" } },
    beforeApp: (win) => {
      win.localStorage.removeItem("stock1.hadSession.v1");
      win.localStorage.setItem("stock1-watch-lists-v1", JSON.stringify({ 1: ["2330"], 2: [], 3: [] }));
    },
  });
  assert.equal(app.evalIn(`authState.user`), null);
  assert.equal(app.evalIn(`watchLists[1].has("2330")`), true, "5xx 也不得清訪客的本機自選");
  assert.deepEqual(JSON.parse(app.evalIn(`localStorage.getItem("stock1-watch-lists-v1")`)), { 1: ["2330"], 2: [], 3: [] });
});

test("登入成功時使用者已在別的欄位打字：不搶焦點、不清草稿", async () => {
  const app = await guestApp();
  const result = JSON.parse(await app.evalIn(`(async () => {
    state.screen = "watchlist"; state.watchList = "hold"; render();
    const button = el.holdingsPanel.querySelector("[data-login-holdings]");
    button.focus(); button.click();
    const now = new Date().toISOString();
    const routes = {
      "/api/auth/login": { ok: true, user: { id: "u9", username: "friend", role: "user" }, warnings: {} },
      // 等待期間使用者切去技術分析打了代號
      "/api/watchlists": new Promise((resolve) => setTimeout(() => {
        state.screen = "technical"; render();
        const input = document.getElementById("technicalCode"); input.value = "2454 打到一半"; input.focus();
        resolve({ ok: true, rev: 1, lists: { 1: [], 2: [], 3: [] } });
      }, 30)),
      "/api/alerts": { ok: true, rev: 1, alerts: [] },
      "/api/trades": { ok: true, schemaVersion: 2, rev: 1, settings: { feeDiscount: 0.6, minFee: 20 }, records: [], quarantinedRecords: [],
        portfolio: { holdings: [], realized: [], totals: { cost: 0, marketValue: 0, unrealizedPnl: 0, realizedPnl: 0 } }, missingCorporateActions: [] },
      "/api/broker/settings": { configured: false }, "/api/sources": { ok: true, selected: "official", sources: {} },
      "/api/quotes": { ok: true, sourceKey: "official", source: "測試", generatedAt: now, realtimeCount: 0, fallbackCount: 0, warnings: [], quotes: [] },
      "/api/markets": { ok: true, source: "測試", generatedAt: now, warnings: [], markets: {} },
      "/api/overnight": { ok: true, asOf: "2026-09-08", source: "測試", surveillanceCount: 0, warnings: [], groups: { strongContinuation: [], volumeDanger: [], pullbackReversal: [] } },
    };
    window.__origFetchApi = fetchApi;
    fetchApi = async (path) => { const key = Object.keys(routes).find((prefix) => String(path).startsWith(prefix)); if (key) return routes[key]; throw Object.assign(new Error("unrouted " + path), { status: 404 }); };
    try { await loginWithCredentials("friend", "pw"); } finally { fetchApi = window.__origFetchApi; }
    await new Promise((resolve) => setTimeout(resolve, 40));
    const active = document.activeElement;
    const out = { activeId: active ? active.id : null, value: document.getElementById("technicalCode").value, user: authState.user && authState.user.username };
    state.screen = "watchlist"; technicalInputDirty = false; document.getElementById("technicalCode").value = ""; render();
    return JSON.stringify(out);
  })()`));
  assert.equal(result.user, "friend");
  assert.equal(result.activeId, "technicalCode", "使用者正在打字的欄位不得被搶焦點");
  assert.equal(result.value, "2454 打到一半", "草稿不得被清掉");
});

test("曾登入過（旗標在）的 401：仍清掉上一個帳號的清單並開登入閘（既有到期契約不變）", async () => {
  const app = await guestApp({
    beforeApp: (win) => {
      win.localStorage.setItem("stock1.hadSession.v1", "1");
      win.localStorage.setItem("stock1-watch-lists-v1", JSON.stringify({ 1: ["2330"], 2: [], 3: [] }));
    },
  });
  assert.equal(app.evalIn(`watchLists[1].size`), 0, "到期的帳號快取要清");
  assert.equal(app.evalIn(`document.getElementById("loginGate").hidden`), false);
  assert.match(app.evalIn(`document.getElementById("loginMessage").textContent`), /登入已到期/);
  app.evalIn(`closeDialogLayer(document.getElementById("loginGate"), { restoreFocus: false });`);
});

test("更多→帳號管理卡：訪客看到登入入口文案，已登入維持帳號管理", async () => {
  const app = await guestApp();
  const guest = app.evalIn(`(() => { state.screen = "more"; render(); return document.querySelector('[data-setting="system"]').textContent.replace(/\\s+/g, " "); })()`);
  assert.match(guest, /登入帳號/);
  assert.doesNotMatch(guest, /建立朋友帳號與登出/);
  const admin = app.evalIn(`(() => { authState.user = { id: "u1", username: "admin", role: "admin" }; render(); const text = document.querySelector('[data-setting="system"]').textContent.replace(/\\s+/g, " "); authState.user = null; render(); return text; })()`);
  assert.match(admin, /建立朋友帳號與登出/);
});

test("登入頁與提醒說明的文案要符合實際能力：訪客可在本機保存自選、登入後改用帳號資料、背景監看與關瀏覽器收不到", async () => {
  const app = await guestApp();
  const gate = app.evalIn(`document.getElementById("loginGate").textContent.replace(/\\s+/g, " ")`);
  assert.match(gate, /不登入也能看行情/);
  assert.match(gate, /這台裝置|這台瀏覽器/, "要說訪客自選保存在本機");
  assert.doesNotMatch(gate, /登入後才有自選股/, "訪客本來就能加自選，不能說登入後才有");
  assert.doesNotMatch(gate, /行情資料、券商 API 設定與自選股都會依帳號分開保存/, "公共行情不是按帳號保存");
  assert.match(gate, /到價提醒/);
  assert.match(gate, /交易帳本|交易紀錄/);
  const hint = json(app, `(() => {
    authState.user = { id: "u1", username: "admin", role: "admin" };
    stocks.length = 0; stocks.push({ code: "2330", name: "台積電", price: 1000, spark: [], groups: [], strategies: [] });
    renderPriceAlertBox(stocks[0]);
    const text = el.priceAlertBox.textContent.replace(/\\s+/g, " ");
    authState.user = null;
    return text;
  })()`);
  assert.match(hint, /頁面顯示於前景/);
  assert.match(hint, /背景/, "要說背景分頁改走背景監看");
  assert.match(hint, /30 秒/, "背景最快 30 秒一輪");
  assert.match(hint, /瀏覽器整個關掉|關掉瀏覽器/, "關瀏覽器就收不到，沒有伺服器推播");
});
