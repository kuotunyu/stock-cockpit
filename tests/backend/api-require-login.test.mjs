// REQUIRE_LOGIN=on（對外部署）：除了健康探針與登入本身，所有 /api 都要有登入狀態。
// 公網上的免登入唯讀端點等於幫任何人放大對證交所／櫃買的請求，也把訊號與成績單攤給所有人看。
// 這裡的 fetch mock 是空表（tripwire）：只要伺服器替未登入的人打了任何上游，測試就會爆。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
before(async () => {
  srv = await bootServer({ routes: [], env: { REQUIRE_LOGIN: "on" } });
});
after(async () => {
  await srv.close();
});

test("未登入：唯讀行情、成績單、版本、維運狀態一律 401 並帶 requireLogin，且不打任何上游", async () => {
  for (const path of ["/api/overnight", "/api/overnight/verify/history", "/api/swing/verify", "/api/market/breadth", "/api/symbols?codes=2330", "/api/app-version", "/api/operational-status", "/api/notes/recent"]) {
    const response = await srv.raw(path);
    assert.equal(response.status, 401, path);
    const body = await response.json();
    assert.equal(body.code, "AUTH_REQUIRED", path);
    assert.equal(body.requireLogin, true, path);
    assert.match(body.error, /需要先登入/);
  }
  const write = await srv.raw("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "2330", text: "x" }) });
  assert.equal(write.status, 401);
  await write.text();
});

test("未登入：/api/auth/me 的 401 帶 requireLogin，健康探針仍 200 並說明模式", async () => {
  const me = await srv.raw("/api/auth/me");
  assert.equal(me.status, 401);
  const meBody = await me.json();
  assert.equal(meBody.requireLogin, true, "前端靠這個旗標分辨「訪客可看行情」與「站台非登入不可」");
  assert.match(meBody.error, /這個站台需要先登入/);
  const health = await srv.raw("/api/health");
  assert.equal(health.status, 200, "平台健康探針不可被登入閘擋住");
  const healthBody = await health.json();
  assert.equal(healthBody.requireLogin, true);
});

test("未登入：外殼靜態檔照常提供（登入畫面在殼裡），登入端點照常可用", async () => {
  const shell = await srv.raw("/");
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert.match(html, /id="loginGate"/);
  const worker = await srv.raw("/sw.js");
  assert.equal(worker.status, 200);
  await worker.text();
  const badLogin = await srv.raw("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "wrong-password-x" }) });
  assert.equal(badLogin.status, 401, "登入端點本身不被閘住（錯密碼是 401 帳密錯，不是 requireLogin）");
  const badBody = await badLogin.json();
  assert.equal(badBody.requireLogin, undefined);
});

test("已登入：唯讀端點恢復可用，/api/auth/me 回報 requireLogin 讓前端知道登出後要回到閘", async () => {
  const me = await srv.api("/api/auth/me");
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.requireLogin, true);
  assert.equal(meBody.user.username, "admin");
  const notes = await srv.api("/api/notes/recent");
  assert.equal(notes.status, 200);
  await notes.text();
  const status = await srv.api("/api/operational-status");
  assert.equal(status.status, 200);
  await status.text();
});
