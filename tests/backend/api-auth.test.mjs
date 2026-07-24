// HTTP 整合：登入／登出／session、401 政策矩陣（哪些端點要登入、哪些刻意開放）。
// 臨時埠（startServer(0)），絕不碰 5174。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";
import { surveillanceRoutes } from "../helpers/fixtures.mjs";

const o = {};
let srv;
before(async () => {
  srv = await bootServer({ routes: surveillanceRoutes(o) });
});
after(async () => {
  await srv.close();
});

test("login：錯誤密碼 → 401；GET → 405", async () => {
  const bad = await srv.raw("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  assert.equal(bad.status, 401);
  const badBody = await bad.json();
  assert.ok(badBody.error.includes("帳號或密碼錯誤"));

  const get = await srv.raw("/api/auth/login", { method: "GET" });
  assert.equal(get.status, 405);
});

test("me：帶 cookie → 200 admin；不帶 → 401", async () => {
  const me = await srv.api("/api/auth/me");
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.user.username, "admin");
  assert.equal(body.user.role, "admin");
  assert.equal(body.warnings.defaultAdminPassword, false, "測試有設 ADMIN_PASSWORD");

  const anon = await srv.raw("/api/auth/me");
  assert.equal(anon.status, 401);
});

test("401 政策矩陣：個人資料端點須登入", async () => {
  const protectedCalls = [
    ["/api/admin/users", {}],
    ["/api/watchlists", {}],
    ["/api/alerts", {}],
    ["/api/trades", {}],
    ["/api/broker/settings", {}],
    ["/api/broker/test", { method: "POST" }],
    ["/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "2330", text: "x" }) }],
  ];
  for (const [path, init] of protectedCalls) {
    const res = await srv.raw(path, init);
    assert.equal(res.status, 401, `${path} 未登入應 401`);
    const body = await res.json();
    assert.equal(body.code, "AUTH_REQUIRED", `${path} 應帶 AUTH_REQUIRED`);
  }
});

test("開放政策：行情／看板／備註讀取刻意免登入（釘住現行政策）", async () => {
  const openCalls = [
    "/api/notes?code=2330",
    "/api/notes/recent",
    "/api/surveillance-board",
    "/api/company?code=2330",
  ];
  for (const path of openCalls) {
    const res = await srv.raw(path);
    assert.equal(res.status, 200, `${path} 應開放未登入`);
  }
});

test("寫入 API：外部 Origin 被擋、帶 body 必須 application/json，且不得落資料", async () => {
  const foreign = await srv.raw("/api/notes", {
    method: "POST",
    headers: {
      cookie: srv.cookie,
      origin: "https://evil.example",
      "content-type": "text/plain",
    },
    body: JSON.stringify({ code: "2330", text: "不該寫入" }),
  });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).code, "ORIGIN_FORBIDDEN");

  const wrongType = await srv.raw("/api/notes", {
    method: "POST",
    headers: {
      cookie: srv.cookie,
      origin: srv.baseUrl,
      "content-type": "text/plain",
    },
    body: JSON.stringify({ code: "2330", text: "也不該寫入" }),
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).code, "JSON_REQUIRED");

  const notes = await srv.raw("/api/notes?code=2330");
  assert.deepEqual((await notes.json()).notes, [], "被拒絕的請求不能留下備註");
});

test("admin/users：GET 列表、POST 建立、非管理員 403、驗證規則", async () => {
  const list = await srv.api("/api/admin/users");
  assert.equal(list.status, 200);
  const users = (await list.json()).users;
  assert.ok(users.some((u) => u.username === "admin"));
  assert.ok(!JSON.stringify(users).includes("passwordHash"), "sanitizeUser 不得洩漏雜湊");

  // 驗證規則
  const short = await srv.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: "ab", password: "12345678" }) });
  assert.equal(short.status, 400);
  const weak = await srv.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: "friend1", password: "123" }) });
  assert.equal(weak.status, 400);

  // 建立一般使用者
  const created = await srv.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: "friend1", password: "friend-pw-1", displayName: "朋友一號" }) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.role, "user");

  // 重複帳號 → 400
  const dup = await srv.api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: "friend1", password: "friend-pw-1" }) });
  assert.equal(dup.status, 400);

  // 以 friend1 登入 → 管理端點 403
  const login = await srv.raw("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "friend1", password: "friend-pw-1" }),
  });
  assert.equal(login.status, 200);
  const cookie2 = (login.headers.get("set-cookie") || "").split(";")[0];
  const forbidden = await srv.raw("/api/admin/users", { headers: { cookie: cookie2 } });
  assert.equal(forbidden.status, 403);
});

test("成功登入：運行中清掉過期 session，並限制同帳號的有效 session 數", async () => {
  const db = await srv.mod.loadDb();
  const admin = db.users.find((user) => user.username === "admin");
  assert.ok(admin);
  db.sessions.push({
    id: "s_expired_runtime_test",
    userId: admin.id,
    tokenHash: "expired-runtime-test",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  });

  const expectedMax = 10;
  const cookies = [];
  for (let index = 0; index < expectedMax + 2; index += 1) {
    const response = await srv.raw("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-admin-pw" }),
    });
    assert.equal(response.status, 200);
    cookies.push((response.headers.get("set-cookie") || "").split(";")[0]);
    await response.json();
  }

  const activeAdminSessions = db.sessions.filter((session) => session.userId === admin.id);
  assert.equal(srv.mod.MAX_SESSIONS_PER_USER, expectedMax, "session cap 是對外釘住的安全契約");
  assert.equal(activeAdminSessions.length, expectedMax);
  assert.ok(!db.sessions.some((session) => session.id === "s_expired_runtime_test"), "過期 session 不可留到重啟才清");

  const oldest = await srv.raw("/api/auth/me", { headers: { cookie: cookies[0] } });
  assert.equal(oldest.status, 401, "超過同帳號上限時應淘汰最舊 session");
  const newest = await srv.raw("/api/auth/me", { headers: { cookie: cookies.at(-1) } });
  assert.equal(newest.status, 200, "最新 session 必須保留");
  await newest.json();
});

test("logout：登出後舊 cookie 失效（放最後，會銷毀共用 session）", async () => {
  const out = await srv.api("/api/auth/logout", { method: "POST" });
  assert.equal(out.status, 200);
  const me = await srv.api("/api/auth/me");
  assert.equal(me.status, 401, "登出後舊 session 應失效");
});
