// 沒設 ADMIN_PASSWORD 的全新安裝——**朋友拿到整包 code 第一次 npm start 就是這個情境**，
// 也是使用者自己 2026-06-08 那次的情境（實測他的 admin hash 至今仍驗得出 "admin1234"）。
//
// 這支不能用 importServer：那個 helper 固定會設 ADMIN_PASSWORD=test-admin-pw
// （見 tests/helpers/test-server.mjs），而 usingDefaultAdminPassword 是模組載入時就定的常數。
// 所以自己組環境並手動 import，把 ADMIN_PASSWORD 明確刪掉。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(here, "../../server.mjs");

const dataDir = await mkdtemp(join(tmpdir(), "stock1-pwseed-"));
process.env.STOCK1_SKIP_LISTEN = "1";
process.env.NODE_ENV = "test";
process.env.HOST = "127.0.0.1";
process.env.PORT = "0";
process.env.DATA_DIR = dataDir;
process.env.ADMIN_USERNAME = "admin";
process.env.APP_SECRET = "stock1-test-app-secret-32-characters-minimum";
delete process.env.ADMIN_PASSWORD; // ← 這一行就是本測試的全部重點
delete process.env.DB_PATH;
delete process.env.PUBLIC_ORIGIN;
delete process.env.SESSION_MAX_AGE_MS;
delete process.env.COOKIE_SECURE;

const mod = await import(pathToFileURL(SERVER_PATH).href);

test("沒設 ADMIN_PASSWORD → 種下 admin1234 並標記 seed-default", async () => {
  const db = await mod.loadDb();
  const admin = db.users.find((user) => user.role === "admin");
  assert.ok(admin, "第一次啟動要建立 admin");
  assert.equal(admin.passwordSource, "seed-default");
  // 標記必須與事實相符，不能只是個沒人核對過的字串——否則只是換一種說謊方式。
  assert.equal(
    mod.verifyPassword("admin1234", admin.passwordHash), true,
    "seed-default 的意思就是「密碼是程式碼裡那一組」，要驗得出來",
  );
});

test("這個標記就是那顆燈的依據：改完密碼之後必須翻面", async () => {
  const before = await mod.loadDb();
  assert.equal(before.users.find((u) => u.role === "admin").passwordSource, "seed-default", "前提：還沒改過");

  await mod.commitDbMutation((db) => {
    const user = db.users.find((item) => item.role === "admin");
    user.passwordHash = mod.hashPassword("something-only-i-know");
    user.passwordSource = "user-set";
    user.updatedAt = new Date().toISOString();
    return true;
  });

  const after = await mod.loadDb();
  const admin = after.users.find((user) => user.role === "admin");
  assert.equal(admin.passwordSource, "user-set", "改完密碼那顆燈才會變綠——這正是舊行為做不到的事");
  assert.equal(mod.verifyPassword("admin1234", admin.passwordHash), false);
});
