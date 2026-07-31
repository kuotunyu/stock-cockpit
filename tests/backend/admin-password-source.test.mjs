// AUDIT.md P1-02 的後半：「這個帳號現在的密碼是不是系統種的那一組」必須由 DB 回答，不是環境變數。
//
// 舊行為只看 process.env.ADMIN_PASSWORD，於是那顆燈**兩個方向都說錯話**：
//   ① 在 UI 改完密碼 → env 沒變 → 燈還是說「仍是預設密碼」（使用者合理結論：這功能壞了）
//   ② 在既有 DB 上設 ADMIN_PASSWORD → 燈變綠，但種 admin 只在空 DB 生效，hash 根本沒換
//      → 謊報「已變更」，比不說還糟
//
// 實測起點（使用者的正式 DB，2026-07-31）：admin 的 createdAt === updatedAt === 2026-06-08，
// 直接驗 hash：verifyPassword("admin1234", hash) === true。
//
// `usingDefaultAdminPassword`（環境變數判準）刻意保留不動——那是 validateStartupSecurity 的
// fail-closed 依據，回答的是「這個行程的設定安不安全」，與「這個帳號的密碼是什麼」是兩件事。
//
// **這支測「有設 ADMIN_PASSWORD」的組態**（importServer helper 固定會設）。
// 另外兩種起點各自獨立成檔，因為 usingDefaultAdminPassword 是模組層常數、dbCache 是單例：
//   admin-password-seed-default.test.mjs   沒設 ADMIN_PASSWORD 的全新安裝（朋友的情境）
//   admin-password-source-migration.test.mjs  既有 DB 補標
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-pwsrc-"));
const { mod } = await importServer({ routes: [], dataDir });

test("有設 ADMIN_PASSWORD 的全新安裝 → 標記 user-set（不可一律標成 seed-default）", async () => {
  // 標成 seed-default 會讓一個已經設好密碼的部署永遠掛著假警告。
  const db = await mod.loadDb();
  const admin = db.users.find((user) => user.role === "admin");
  assert.ok(admin, "第一次啟動要建立 admin");
  assert.equal(admin.passwordSource, "user-set");
  assert.equal(mod.verifyPassword("admin1234", admin.passwordHash), false, "種下去的不是預設密碼");
  assert.equal(mod.verifyPassword("test-admin-pw", admin.passwordHash), true);
});

test("改密碼 → 標記維持 user-set、舊密碼失效、createdAt 不動", async () => {
  const before = await mod.loadDb();
  const { createdAt } = before.users.find((user) => user.role === "admin");

  await mod.commitDbMutation((db) => {
    const user = db.users.find((item) => item.role === "admin");
    user.passwordHash = mod.hashPassword("a-much-better-password");
    user.passwordSource = "user-set";
    user.updatedAt = new Date().toISOString();
    return true;
  });

  const after = await mod.loadDb();
  const updated = after.users.find((user) => user.role === "admin");
  assert.equal(updated.passwordSource, "user-set");
  assert.equal(mod.verifyPassword("test-admin-pw", updated.passwordHash), false, "舊密碼要失效");
  assert.equal(mod.verifyPassword("a-much-better-password", updated.passwordHash), true);
  assert.equal(updated.createdAt, createdAt, "createdAt 不可被動到");
});

test("標記要落盤，不能只活在記憶體裡", async () => {
  // 沒落盤的話重啟又會回到未判定狀態，每次啟動都要重算一次 pbkdf2。
  const raw = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.equal(raw.users.find((user) => user.role === "admin").passwordSource, "user-set");
});

test("已有標記的帳號重載後不會被重新判定", async () => {
  const first = await mod.loadDb();
  const stamp = first.users.find((user) => user.role === "admin").updatedAt;
  const second = await mod.loadDb();
  assert.equal(second.users.find((user) => user.role === "admin").updatedAt, stamp, "重載不得改動任何欄位");
});
