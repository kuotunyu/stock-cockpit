// lease-only 出口必須阻止同模組重入／啟停誤放鎖，且不觸發 DB 讀取或遷移。
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

test("備份 lease-only context 拒絕重入及 start/shutdown，release 可重複且不釋放下次租約", async () => {
  const { mod, mock, dataDir } = await importServer({ env: { SCHEDULER: "off" } });
  let lease;
  try {
    const dbPath = join(dataDir, "stock1-db.json");
    await writeFile(dbPath, "{ deliberately broken");
    const acquiring = mod.acquireBackupSourceLease();
    await assert.rejects(mod.acquireBackupSourceLease(), { code: "BACKUP_LEASE_CONTEXT" });
    await assert.rejects(mod.startServer(0), { code: "BACKUP_LEASE_CONTEXT" });
    lease = await acquiring;
    await assert.rejects(mod.shutdownServer(), { code: "BACKUP_LEASE_CONTEXT" });
    lease.assertHealthy();
    assert.equal(await readFile(dbPath, "utf8"), "{ deliberately broken");
    assert.deepEqual(await readdir(dataDir), ["stock1-db.json"]);
    const previous = lease;
    await previous.release();
    lease = await mod.acquireBackupSourceLease();
    await previous.release();
    lease.assertHealthy();
    assert.equal(mock.calls.length, 0);
  } finally { await lease?.release(); mock.restore(); await rm(dataDir, { recursive: true, force: true }); }
});
