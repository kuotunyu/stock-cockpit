import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

test("每日備份暫時失敗後，同日下一次 saveDb 會重試並保留前一版", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbbak-retry-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });
  const dbPath = join(dataDir, "stock1-db.json");
  const backupDir = join(dataDir, "backups");
  const backupPath = join(backupDir, `stock1-db-${compactToday()}.json`);
  const original = {
    marker: "original",
    users: [{
      id: "u1", username: "keeper", displayName: "人", role: "user",
      passwordHash: "x", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
    }],
    sessions: [],
    watchLists: {},
  };
  await writeFile(dbPath, JSON.stringify(original), "utf8");
  await writeFile(backupDir, "temporary obstruction", "utf8");

  const { mod } = await importServer({ routes: [], dataDir });
  const db = await mod.loadDb();
  db.marker = "after-first-save";
  await mod.saveDb(db);
  await rm(backupDir);

  db.marker = "after-second-save";
  await mod.saveDb(db);

  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  assert.equal(backup.marker, "after-first-save", "重試備份應捕捉第二次覆寫前的主檔");
  const saved = JSON.parse(await readFile(dbPath, "utf8"));
  assert.equal(saved.marker, "after-second-save", "備份重試仍不可阻擋主資料寫入");
});
