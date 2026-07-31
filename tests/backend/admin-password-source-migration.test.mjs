// 既有 DB 補標 passwordSource——這是實際會作用在使用者正式資料庫上的那一條。
//
// 2026-07-31 之前建立的帳號沒有這個欄位。判準必須是**實際驗一次 hash**，
// 不能用 `createdAt === updatedAt` 這種啟發式：那只說明「沒有任何欄位被改過」，
// 不代表密碼是哪一組（使用者可能改過 displayName、也可能改過密碼但那時沒動 updatedAt）。
//
// 這支檔案在 import server 之前先寫好一個「舊格式」的 DB。hash 用與 server.mjs:309
// 相同的演算法獨立產生（pbkdf2$<iterations>$<salt>$<hash>，sha256、32 bytes），
// 因為 hashPassword 要 import 之後才拿得到，而 dbCache 是單例、載入後就定了。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { importServer } from "../helpers/test-server.mjs";

const ITERATIONS = 210000;
const legacyHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), salt, ITERATIONS, 32, "sha256").toString("hex");
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
};

const CREATED = "2026-06-08T18:12:20.139Z";
const dataDir = await mkdtemp(join(tmpdir(), "stock1-pwmig-"));
await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify({
  version: 1,
  createdAt: CREATED,
  users: [
    // 使用者正式 DB 的形狀：自動種下的 admin，從建立以來沒被改過。
    { id: "u_seeded", username: "admin", displayName: "管理者", role: "admin",
      passwordHash: legacyHash("admin1234"), createdAt: CREATED, updatedAt: CREATED },
    // 朋友的帳號：管理者手動建立、密碼是自己輸入的。
    { id: "u_friend", username: "friend", displayName: "朋友", role: "user",
      passwordHash: legacyHash("friend-chose-this-one"), createdAt: CREATED, updatedAt: CREATED },
    // 曾經改過密碼、但改的時候還沒有這個欄位（舊版改密碼路徑）。
    { id: "u_changed", username: "careful", displayName: "已改過", role: "admin",
      passwordHash: legacyHash("already-changed-long-ago"), createdAt: CREATED, updatedAt: "2026-07-01T00:00:00.000Z" },
  ],
  sessions: [], watchLists: {}, priceAlerts: {}, trades: {},
  brokerCredentials: {}, dataRevs: {}, sharedRevs: {}, stockNotes: {},
  companyProfiles: {}, signalSnapshots: [], swingSnapshots: {}, swingVerification: {},
}), "utf8");

const { mod } = await importServer({ routes: [], dataDir });
const byId = (db, id) => db.users.find((user) => user.id === id);

test("密碼仍是系統種的那一組 → 補標 seed-default", async () => {
  const db = await mod.loadDb();
  assert.equal(byId(db, "u_seeded").passwordSource, "seed-default");
});

test("密碼是自己設的 → 補標 user-set（不可一律當成預設而亂報警告）", async () => {
  const db = await mod.loadDb();
  assert.equal(byId(db, "u_friend").passwordSource, "user-set");
  assert.equal(byId(db, "u_changed").passwordSource, "user-set");
});

test("補標不得動到 updatedAt", async () => {
  // 密碼沒有被改，只是把一個既有事實記下來。動了 updatedAt 會把
  // 「這個帳號從建立以來沒被改過」這個訊號抹掉，日後就查不出這件事了。
  const db = await mod.loadDb();
  assert.equal(byId(db, "u_seeded").updatedAt, CREATED);
  assert.equal(byId(db, "u_seeded").createdAt, CREATED);
  assert.equal(byId(db, "u_changed").updatedAt, "2026-07-01T00:00:00.000Z");
});

test("補標結果要落盤（不然每次啟動都要重算 pbkdf2）", async () => {
  await mod.flushPersistence?.();
  const raw = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.equal(raw.users.find((user) => user.id === "u_seeded").passwordSource, "seed-default");
  assert.equal(raw.users.find((user) => user.id === "u_friend").passwordSource, "user-set");
});

test("標記與真實 hash 一致：seed-default 的那個真的驗得出 admin1234", async () => {
  // 這條擋的是「補標寫死成某個值」——標記如果不反映事實，那顆燈只是換了一種說謊方式。
  const db = await mod.loadDb();
  assert.equal(mod.verifyPassword("admin1234", byId(db, "u_seeded").passwordHash), true);
  assert.equal(mod.verifyPassword("admin1234", byId(db, "u_friend").passwordHash), false);
  assert.equal(mod.verifyPassword("admin1234", byId(db, "u_changed").passwordHash), false);
});
