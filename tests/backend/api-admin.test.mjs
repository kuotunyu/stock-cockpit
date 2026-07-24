// 帳號管理與登入防護：自改密碼、admin 重設密碼、刪除帳號（個資連動清除）、登入防爆破。
// 全 HTTP 整合：真伺服器綁臨時埠、只打 127.0.0.1。
// 注意：每個回應的 body 都要消費完；Windows 上 undici 未讀完的 body 會殘留 HTTP handle，造成測試不乾淨退場。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
before(async () => {
  srv = await bootServer();
});
after(async () => {
  await srv.close();
});

// 一律回 { status, body, cookie }，body 保證消費完。
async function call(path, init = {}, cookie = "") {
  const res = await srv.raw(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    body,
    cookie: (res.headers.get("set-cookie") || "").split(";")[0],
  };
}

const login = (username, password) =>
  call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });

async function createUser(username, password, role = "user") {
  const res = await call(
    "/api/admin/users",
    { method: "POST", body: JSON.stringify({ username, password, displayName: username, role }) },
    srv.cookie
  );
  assert.equal(res.status, 201, `建立 ${username} 應成功：${JSON.stringify(res.body)}`);
  return res.body.user;
}

test("自改密碼：驗舊密碼、長度下限、踢掉其他裝置、新舊密碼切換", async () => {
  await createUser("friend01", "friend-pw-1");
  const deviceA = (await login("friend01", "friend-pw-1")).cookie;
  const deviceB = (await login("friend01", "friend-pw-1")).cookie;

  const wrongCurrent = await call(
    "/api/auth/password",
    { method: "POST", body: JSON.stringify({ currentPassword: "nope", newPassword: "new-pw-12345" }) },
    deviceA
  );
  assert.equal(wrongCurrent.status, 400);
  assert.match(wrongCurrent.body.error, /目前密碼不正確/);

  const tooShort = await call(
    "/api/auth/password",
    { method: "POST", body: JSON.stringify({ currentPassword: "friend-pw-1", newPassword: "short" }) },
    deviceA
  );
  assert.equal(tooShort.status, 400);

  const notLoggedIn = await call("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: "x", newPassword: "whatever-8" }),
  });
  assert.equal(notLoggedIn.status, 401);

  const ok = await call(
    "/api/auth/password",
    { method: "POST", body: JSON.stringify({ currentPassword: "friend-pw-1", newPassword: "friend-pw-2" }) },
    deviceA
  );
  assert.equal(ok.status, 200);

  assert.equal((await call("/api/auth/me", {}, deviceB)).status, 401, "其他裝置被登出");
  assert.equal((await call("/api/auth/me", {}, deviceA)).status, 200, "目前裝置保持登入");
  assert.equal((await login("friend01", "friend-pw-1")).status, 401, "舊密碼失效");
  assert.equal((await login("friend01", "friend-pw-2")).status, 200, "新密碼可登入");
});

test("admin 重設密碼：目標全 session 失效、新密碼生效、參數驗證", async () => {
  const user = await createUser("friend02", "friend02-pw");
  const session = (await login("friend02", "friend02-pw")).cookie;

  const reset = await call(
    "/api/admin/users",
    { method: "PATCH", body: JSON.stringify({ id: user.id, password: "reset-pw-99" }) },
    srv.cookie
  );
  assert.equal(reset.status, 200);

  assert.equal((await call("/api/auth/me", {}, session)).status, 401, "重設後舊 session 全踢");
  assert.equal((await login("friend02", "friend02-pw")).status, 401);
  assert.equal((await login("friend02", "reset-pw-99")).status, 200);

  const tooShort = await call(
    "/api/admin/users",
    { method: "PATCH", body: JSON.stringify({ id: user.id, password: "short" }) },
    srv.cookie
  );
  assert.equal(tooShort.status, 400);

  const missing = await call(
    "/api/admin/users",
    { method: "PATCH", body: JSON.stringify({ id: "u_no_such", password: "whatever-8" }) },
    srv.cookie
  );
  assert.equal(missing.status, 404);
});

test("刪除帳號：個資連動清除；不能刪自己；一般使用者 403", async () => {
  const user = await createUser("friend03", "friend03-pw");
  const session = (await login("friend03", "friend03-pw")).cookie;

  // 幫他放一點個資（自選股）再刪，驗證連動清除。
  const wl = await call("/api/watchlists", {}, session);
  assert.equal(wl.status, 200);
  const put = await call(
    "/api/watchlists",
    { method: "PUT", body: JSON.stringify({ rev: wl.body.rev, lists: { 1: ["2330"], 2: [], 3: [] } }) },
    session
  );
  assert.equal(put.status, 200);

  const note = await call(
    "/api/notes",
    { method: "POST", body: JSON.stringify({ code: "2330", text: "刪帳號時也要刪掉" }) },
    session
  );
  assert.equal(note.status, 201);
  for (let i = 0; i < 10; i++) await login("friend03", `wrong-before-delete-${i}`);

  const forbidden = await call(`/api/admin/users?id=${user.id}`, { method: "DELETE" }, session);
  assert.equal(forbidden.status, 403, "一般使用者不能碰 admin API");

  const del = await call(`/api/admin/users?id=${user.id}`, { method: "DELETE" }, srv.cookie);
  assert.equal(del.status, 200);
  assert.ok(!del.body.users.some((u) => u.username === "friend03"), "回傳清單已不含被刪帳號");

  assert.equal((await login("friend03", "friend03-pw")).status, 401, "帳號已不存在");
  assert.equal((await call("/api/auth/me", {}, session)).status, 401, "session 立即失效");

  const db = await srv.mod.loadDb();
  assert.ok(!db.users.some((u) => u.id === user.id));
  assert.equal(db.watchLists[user.id], undefined, "自選股連動刪除");
  assert.equal(db.dataRevs?.[user.id], undefined, "資料版本號連動刪除");
  assert.ok(!Object.values(db.stockNotes || {}).flat().some((n) => n.userId === user.id), "公開備註也要連動刪除");
  const publicNotes = await call("/api/notes?code=2330");
  assert.ok(!publicNotes.body.notes.some((n) => n.userId === user.id), "匿名讀取不得再看到已刪帳號內容");

  await createUser("friend03", "friend03-new-pw");
  assert.equal((await login("friend03", "friend03-new-pw")).status, 200, "重建同名帳號不可沿用舊登入鎖");

  const me = await call("/api/auth/me", {}, srv.cookie);
  const selfDel = await call(`/api/admin/users?id=${me.body.user.id}`, { method: "DELETE" }, srv.cookie);
  assert.equal(selfDel.status, 400, "不能刪除自己");

  const notFound = await call("/api/admin/users?id=u_no_such", { method: "DELETE" }, srv.cookie);
  assert.equal(notFound.status, 404);
});

test("登入防爆破：同帳號 10 次失敗 → 429（正確密碼也擋）；別的帳號不受影響；admin 重設可解鎖", async () => {
  await createUser("bruteme", "bruteme-pw-1");
  for (let i = 0; i < 10; i++) {
    assert.equal((await login("bruteme", `wrong-${i}`)).status, 401);
  }
  const blocked = await login("bruteme", "bruteme-pw-1");
  assert.equal(blocked.status, 429, "超過上限後連正確密碼也先擋");
  assert.match(blocked.body.error, /暫時鎖定/);

  assert.equal((await login("admin", "test-admin-pw")).status, 200, "其他帳號不受影響");

  const db = await srv.mod.loadDb();
  const target = db.users.find((u) => u.username === "bruteme");
  const reset = await call(
    "/api/admin/users",
    { method: "PATCH", body: JSON.stringify({ id: target.id, password: "bruteme-pw-2" }) },
    srv.cookie
  );
  assert.equal(reset.status, 200);
  assert.equal((await login("bruteme", "bruteme-pw-2")).status, 200, "重設密碼同時解鎖");
});

test("成功登入清零失敗計數：9 失敗＋1 成功後，再失敗不會直接鎖定", async () => {
  await createUser("resetcount", "resetcount-pw");
  for (let i = 0; i < 9; i++) {
    assert.equal((await login("resetcount", "bad")).status, 401);
  }
  assert.equal((await login("resetcount", "resetcount-pw")).status, 200, "第 10 次成功登入（計數歸零）");
  assert.equal((await login("resetcount", "bad-again")).status, 401, "重新累計，只算 1 次失敗");
  assert.equal((await login("resetcount", "resetcount-pw")).status, 200, "沒有被鎖");
});
