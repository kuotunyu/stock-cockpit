// P6 的反向守衛：主檔不存在**且沒有備份** ＝ 真正的第一次啟動，必須照常起空 DB。
//
// 「主檔不存在但有備份」要 fail-closed（見 db-missing-with-backups.test.mjs），
// 但那道防線不可以過度收緊到把全新安裝也擋下來——朋友拿到整包 code 第一次 npm start
// 就是這個情境。既有的 db-recovery*.test.mjs 全部是「主檔存在但壞掉」，
// 走不到 !existsSync 那條分支，所以擋不住「連第一次啟動也 fail-closed」這個突變。
//
// loadDb 情境一個行程只能測一種（dbCache 單例）→ 獨立成檔。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

// 全新的空目錄：沒有 stock1-db.json，也沒有 backups/。
const dataDir = await mkdtemp(join(tmpdir(), "stock1-firstrun-"));
const { mod } = await importServer({ routes: [], dataDir });

test("全新安裝（無主檔、無備份）→ 照常起空資料庫，不得 fail-closed", async () => {
  const db = await mod.loadDb();
  assert.ok(db, "第一次啟動必須拿得到資料庫");
  assert.ok(Array.isArray(db.users), "空 DB 的基本結構要在");
  // 全新安裝會建立初始 admin 並給預設自選清單（既有的刻意行為，不是這條要驗的東西）；
  // 這裡要驗的是「有跑完、沒有拋錯」，所以只檢查結構。
  assert.equal(db.users.length, 1, "第一次啟動要有初始 admin");
  assert.equal(db.users[0].role, "admin");
  assert.equal(typeof db.watchLists, "object");
  assert.deepEqual(db.trades, {}, "全新安裝不該有任何交易紀錄");
});

test("第一次啟動會建立初始 admin 並落盤（既有行為不變）", async () => {
  const files = await readdir(dataDir);
  assert.ok(files.includes("stock1-db.json"), "第一次啟動本來就該建立主檔");
});
