// HTTP 端到端：「更多 → 帳號管理」那顆密碼狀態燈，必須跟著實際的密碼變動翻面。
// 臨時埠（startServer(0)），絕不碰 5174。
//
// 這支釘的是 AUDIT.md P1-02 未完成那半造成的**兩個方向的謊**：
//   ① 在 UI 改完密碼 → 舊碼看 env（沒變）→ 燈還是說「仍是預設密碼」
//   ② 在既有 DB 上設了 ADMIN_PASSWORD → 舊碼說「已變更」，但種 admin 只在空 DB 生效，
//      hash 根本沒換 → 謊報安全，比不說還糟
//
// 測試環境**有設** ADMIN_PASSWORD（helper 固定會設），所以第一個斷言在舊碼下會是 false、
// 新碼下是 true——它就是 ② 的回歸守衛。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { bootServer } from "../helpers/test-server.mjs";

const ITERATIONS = 210000;
const hash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `pbkdf2$${ITERATIONS}$${salt}$${pbkdf2Sync(String(password), salt, ITERATIONS, 32, "sha256").toString("hex")}`;
};

const dataDir = await mkdtemp(join(tmpdir(), "stock1-pwwarn-"));
const CREATED = "2026-06-08T18:12:20.139Z";
// 預埋一個「密碼還是系統種的那一組」的 admin。密碼本身用 helper 登入時要用的那一組，
// 這樣才登得進去；燈的依據是 passwordSource 這個欄位，不是密碼字面值。
await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify({
  version: 1,
  createdAt: CREATED,
  users: [{
    id: "u_seeded", username: "admin", displayName: "管理者", role: "admin",
    passwordHash: hash("test-admin-pw"), passwordSource: "seed-default",
    createdAt: CREATED, updatedAt: CREATED,
  }, {
    // 朋友的帳號，也還停在系統種的那一組——用來測「管理者重設他人密碼」那條路。
    id: "u_legacy", username: "friend", displayName: "朋友", role: "user",
    passwordHash: hash("admin1234"), passwordSource: "seed-default",
    createdAt: CREATED, updatedAt: CREATED,
  }],
  sessions: [], watchLists: {}, priceAlerts: {}, trades: {},
  brokerCredentials: {}, dataRevs: {}, sharedRevs: {}, stockNotes: {},
  companyProfiles: {}, signalSnapshots: [], swingSnapshots: {}, swingVerification: {},
}), "utf8");

let srv;
before(async () => {
  srv = await bootServer({ routes: [], dataDir });
});
after(async () => {
  await srv.close();
});

test("密碼仍是系統種的那一組 → 即使 ADMIN_PASSWORD 有設，兩個端點都要亮警告", async () => {
  // warnings 在 /api/auth/login 與 /api/auth/me **兩處各自組一次**，改一處漏一處就會前後不一致；
  // 兩個都要驗，只驗一個的話另一處退回讀 env 也不會被抓到（實測：突變抽查就是這樣漏掉的）。
  const login = await srv.raw("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-admin-pw" }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200, JSON.stringify(loginBody));
  assert.equal(
    loginBody.warnings.defaultAdminPassword, true,
    "登入回應：舊碼在這裡會回 false（env 有設 ADMIN_PASSWORD）——正是謊報「已變更」的那個方向",
  );

  const me = await srv.api("/api/auth/me");
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.warnings.defaultAdminPassword, true, "/api/auth/me 要給出同一個答案");
});

test("改完密碼 → 同一顆燈必須翻成安全，而且是立刻", async () => {
  const changed = await srv.api("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword: "test-admin-pw", newPassword: "a-much-better-password" }),
  });
  assert.equal(changed.status, 200, await changed.text());

  // 改密碼會把其他裝置的 session 登出、保留目前這個，所以同一個 cookie 仍然有效。
  const me = await srv.api("/api/auth/me");
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(
    body.warnings.defaultAdminPassword, false,
    "舊碼在這裡永遠是 false→false 或 true→true，看 env 而不看實際密碼",
  );
});

test("重新登入（新密碼）拿到的 payload 也要一致", async () => {
  // 登入與 /api/auth/me 是兩處各自組 warnings 的地方，改一處漏一處就會前後不一致。
  const login = await srv.raw("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "a-much-better-password" }),
  });
  // body 只能讀一次：不可把 `await login.text()` 當成斷言訊息，那會把它消耗掉。
  const body = await login.json();
  assert.equal(login.status, 200, JSON.stringify(body));
  assert.equal(body.warnings.defaultAdminPassword, false);
  assert.equal(body.user.username, "admin");
  // 內部欄位不得外洩：sanitizeUser 是白名單。
  assert.deepEqual(Object.keys(body.user).sort(), ["displayName", "id", "role", "username"]);
});

test("管理者重設他人密碼 → 對方的標記也要翻面（朋友忘記密碼時走的就是這條）", async () => {
  const before = await srv.mod.loadDb();
  assert.equal(
    before.users.find((user) => user.id === "u_legacy").passwordSource, "seed-default",
    "前提：朋友的帳號還停在系統種的那一組",
  );

  // 目前的 cookie 是改完密碼之後那一次登入拿到的，仍然有效（改密碼只登出其他裝置）。
  const reset = await srv.api("/api/admin/users", {
    method: "PATCH",
    body: JSON.stringify({ id: "u_legacy", password: "reset-by-admin-2026" }),
  });
  const resetBody = await reset.json();
  assert.equal(reset.status, 200, JSON.stringify(resetBody));

  const after = await srv.mod.loadDb();
  const friend = after.users.find((user) => user.id === "u_legacy");
  assert.equal(friend.passwordSource, "user-set", "重設密碼也是「有人刻意設過」，標記必須跟著翻");
  assert.equal(srv.mod.verifyPassword("admin1234", friend.passwordHash), false, "舊密碼要失效");
  assert.equal(srv.mod.verifyPassword("reset-by-admin-2026", friend.passwordHash), true);
});
