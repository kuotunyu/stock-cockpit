// REQUIRE_LOGIN=on 的站台：/api/auth/me 的 401 帶 requireLogin → 開機只開登入閘（不可關），
// 資料請求一筆都不發（全部會 401、只會變成一片錯誤提示）；登入成功後補跑完整開機流程；登出回到閘。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const apps = [];
after(() => apps.forEach((app) => app.cleanup()));

const json = (app, expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

function lockedRoutes(session) {
  const user = { id: "u1", username: "admin", displayName: "管理者", role: "admin" };
  return {
    "/api/auth/me": () => (session.loggedIn
      ? { ok: true, requireLogin: true, user, warnings: {} }
      : { __status: 401, ok: false, code: "AUTH_REQUIRED", requireLogin: true, error: "這個站台需要先登入" }),
    "/api/auth/login": () => { session.loggedIn = true; return { ok: true, user, warnings: {} }; },
    "/api/auth/logout": () => { session.loggedIn = false; return { ok: true }; },
    "/api/overnight": { ok: true, generatedAt: "", groups: [], warnings: [] },
    "/api/markets": { ok: true, markets: [] },
    "/api/sources": { ok: true, sources: {} },
    "/api/quotes": { ok: true, stocks: [], warnings: [] },
    "/api/watchlists": { ok: true, lists: {}, rev: 1 },
    "/api/alerts": { ok: true, alerts: [], rev: 1 },
    "/api/trades": { ok: true, trades: [], rev: 1 },
    "/api/broker/settings": { ok: true, settings: null },
  };
}

test("未登入開機：只打 /api/auth/me，登入閘開著且關不掉，其他 API 一筆都不發", async () => {
  const session = { loggedIn: false };
  const app = await createAppWindow({ fetchRoutes: lockedRoutes(session) });
  apps.push(app);
  await app.settle(6);
  const calls = app.fetchLog.map((entry) => entry.path.split("?")[0]);
  assert.deepEqual([...new Set(calls)], ["/api/auth/me"], calls.join(", "));
  const state = json(app, `({
    gateOpen: !document.getElementById("loginGate").hidden,
    message: document.getElementById("loginMessage").textContent,
    closeHidden: document.getElementById("loginClose").hidden,
    requireLogin: authState.requireLogin, deferred: authState.bootDeferred, user: authState.user,
  })`);
  assert.equal(state.gateOpen, true);
  assert.match(state.message, /這個站台需要登入/);
  assert.equal(state.closeHidden, true, "站台鎖定時關閉鈕要藏起來");
  assert.equal(state.requireLogin, true);
  assert.equal(state.deferred, true);
  assert.equal(state.user, null);
  // 按 Escape／呼叫關閉：閘不能關（關掉只剩一片 401）
  app.evalIn(`setLoginGateVisible(false, "")`);
  assert.equal(json(app, `!document.getElementById("loginGate").hidden`), true, "鎖定中不可關閉登入閘");
});

test("登入成功後補跑完整開機流程；登出回到登入閘", async () => {
  const session = { loggedIn: false };
  const app = await createAppWindow({ fetchRoutes: lockedRoutes(session) });
  apps.push(app);
  await app.settle(6);
  app.fetchLog.length = 0;
  app.evalIn(`loginWithCredentials("admin", "correct-horse-battery-staple")`);
  await app.settle(12);
  const calls = [...new Set(app.fetchLog.map((entry) => entry.path.split("?")[0]))];
  assert.ok(calls.includes("/api/auth/login"), calls.join(", "));
  for (const path of ["/api/watchlists", "/api/alerts", "/api/trades", "/api/overnight"]) {
    assert.ok(calls.includes(path), `登入後要補抓 ${path}：${calls.join(", ")}`);
  }
  const afterLogin = json(app, `({ gateOpen: !document.getElementById("loginGate").hidden, deferred: authState.bootDeferred, user: authState.user?.username })`);
  assert.equal(afterLogin.gateOpen, false);
  assert.equal(afterLogin.deferred, false);
  assert.equal(afterLogin.user, "admin");
  app.evalIn(`logout()`);
  await app.settle(6);
  const afterLogout = json(app, `({ gateOpen: !document.getElementById("loginGate").hidden, message: document.getElementById("loginMessage").textContent, closeHidden: document.getElementById("loginClose").hidden, deferred: authState.bootDeferred })`);
  assert.equal(afterLogout.gateOpen, true, "站台鎖定：登出後回到登入閘，不是關掉閘");
  assert.match(afterLogout.message, /已登出/);
  assert.equal(afterLogout.closeHidden, true);
  assert.equal(afterLogout.deferred, true);
});

test("非鎖定站台（一般 401）行為不變：訪客可看行情、閘不強制開", async () => {
  const app = await createAppWindow({ fetchRoutes: { "/api/auth/me": { __status: 401, ok: false, code: "AUTH_REQUIRED", error: "需要先登入" } } });
  apps.push(app);
  await app.settle(6);
  const state = json(app, `({ gateOpen: !document.getElementById("loginGate").hidden, requireLogin: Boolean(authState.requireLogin), deferred: Boolean(authState.bootDeferred) })`);
  assert.equal(state.gateOpen, false);
  assert.equal(state.requireLogin, false);
  assert.equal(state.deferred, false);
  const calls = [...new Set(app.fetchLog.map((entry) => entry.path.split("?")[0]))];
  assert.ok(calls.length > 1, "訪客模式照常抓行情");
});
