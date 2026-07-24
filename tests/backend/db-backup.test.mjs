// 資料保命（審計 A）：每日備份輪替——第一次寫入前備份現有主檔、只保留最近 14 份。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbbak-"));

// 有效主檔（帶 users，避免 loadDb 建 admin 時提早觸發 saveDb/備份）
const validDb = {
  users: [{
    id: "u1", username: "keeper", displayName: "人", role: "user",
    passwordHash: "x", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
  }],
  sessions: [],
  watchLists: {},
};
await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify(validDb), "utf8");
// 預埋 15 份舊備份（日期遞增），寫入後應裁到 14 份且最舊的被刪
const backupDir = join(dataDir, "backups");
await mkdir(backupDir, { recursive: true });
const oldDates = Array.from({ length: 15 }, (_, i) => `202501${String(i + 1).padStart(2, "0")}`);
for (const d of oldDates) {
  await writeFile(join(backupDir, `stock1-db-${d}.json`), "{}", "utf8");
}

const { mod } = await importServer({ routes: [], dataDir });

test("第一次 saveDb：先備份今天一份、總數裁到 14、最舊的被刪", async () => {
  const db = await mod.loadDb();
  await mod.saveDb(db);
  const backups = (await readdir(backupDir)).filter((n) => /^stock1-db-\d{8}\.json$/.test(n)).sort();
  const todayCompact = compactToday();
  assert.ok(backups.includes(`stock1-db-${todayCompact}.json`), `今天的備份要在：${backups.join(", ")}`);
  assert.equal(backups.length, 14, "只留最近 14 份");
  assert.ok(!backups.includes("stock1-db-20250101.json"), "最舊的要被刪");
  assert.ok(!backups.includes("stock1-db-20250102.json"), "第二舊的也要被刪（15+1−14=2 份出局）");
});

test("同一天第二次 saveDb：不重複備份（lastDbBackupDay 節流）", async () => {
  const before = (await readdir(backupDir)).length;
  const db = await mod.loadDb();
  await mod.saveDb(db);
  assert.equal((await readdir(backupDir)).length, before, "同日不再新增備份");
});
