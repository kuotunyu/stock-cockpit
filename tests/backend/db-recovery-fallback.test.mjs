// 資料保命深層路徑：主檔壞＋「最新備份也壞」→ 要繼續退到更舊的好備份（不能停在第一份就放棄）。
// loadDb 情境測試一個行程只能測一種（dbCache 單例）→ 獨立成檔，DATA_DIR 在 import 前預埋。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbrec2-"));

// 次舊備份是好的（帶 marker）；最新備份也是壞 JSON。
const olderGood = {
  users: [{
    id: "u_older", username: "older", displayName: "更舊備份", role: "user",
    passwordHash: "x", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z",
  }],
  sessions: [],
  watchLists: { u_older: { 1: ["8888"], 2: [], 3: [] } },
};
await mkdir(join(dataDir, "backups"), { recursive: true });
await writeFile(join(dataDir, "backups", "stock1-db-20260601.json"), JSON.stringify(olderGood), "utf8");
await writeFile(join(dataDir, "backups", "stock1-db-20260620.json"), '{"users":[{"broken', "utf8");
await writeFile(join(dataDir, "stock1-db.json"), '{"also":"broken', "utf8");

const { mod } = await importServer({ routes: [], dataDir });

test("主檔壞＋最新備份也壞 → 跳過壞備份、用更舊的好備份恢復", async () => {
  const db = await mod.loadDb();
  assert.ok(db.users.some((u) => u.id === "u_older"), "應該退到 0601 那份好備份");
  assert.deepEqual(db.watchLists.u_older?.["1"], ["8888"], "更舊備份的 marker 要在");
  const files = await readdir(dataDir);
  assert.ok(files.some((name) => name.startsWith("stock1-db.json.corrupt-")), "壞主檔要保留鑑識");
});
