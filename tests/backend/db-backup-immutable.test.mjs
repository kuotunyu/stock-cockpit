// 同日重啟保命：今天的 rollback point 已存在時，第一次 saveDb 也不可覆寫它。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbbak-immutable-"));
const dbPath = join(dataDir, "stock1-db.json");
const backupDir = join(dataDir, "backups");
const backupPath = join(backupDir, `stock1-db-${compactToday()}.json`);
const original = {
  marker: "original-before-restart",
  users: [{
    id: "u1", username: "keeper", displayName: "人", role: "user",
    passwordHash: "x", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
  }],
  sessions: [],
  watchLists: {},
};
await mkdir(backupDir, { recursive: true });
await writeFile(dbPath, JSON.stringify(original), "utf8");
await writeFile(backupPath, "IMMUTABLE_ROLLBACK_POINT", "utf8");

const { mod } = await importServer({ routes: [], dataDir });

test("同一天重啟後 saveDb 不覆寫已存在的每日備份", async () => {
  const db = await mod.loadDb();
  db.marker = "new-state-after-restart";
  await mod.saveDb(db);

  assert.equal(await readFile(backupPath, "utf8"), "IMMUTABLE_ROLLBACK_POINT");
  const saved = JSON.parse(await readFile(dbPath, "utf8"));
  assert.equal(saved.marker, "new-state-after-restart", "備份不可變不應阻擋主資料正常寫入");
});
