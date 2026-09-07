// 真實獨立程序的載入、落盤與 graceful shutdown；只接受明確臨時 DATA_DIR。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { importServer } from "./test-server.mjs";

const { mod, mock, dataDir } = await importServer({ dataDir: process.argv[2], routes: [] });
const evidence = db => ({ signalSnapshots: db.signalSnapshots, swingVerification: db.swingVerification, swingVerificationRetry: db.swingVerificationRetry });
const fingerprint = db => createHash("sha256").update(JSON.stringify(evidence(db))).digest("hex");
try {
  const server = await mod.startServer(0, "127.0.0.1");
  const db = await mod.loadDb();
  await mod.saveDb(db);
  await mod.flushPersistence();
  const disk = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  console.log("RETENTION_RESULT:" + JSON.stringify({ port: server.address().port,
    fingerprint: fingerprint(db), diskFingerprint: fingerprint(disk), snapshots: db.signalSnapshots.length,
    swingDays: Object.keys(db.swingVerification).length,
    pending: Object.values(db.swingVerification).flat().filter(e=>e.status==="pending").length,
    retry: db.swingVerificationRetry, upstreamRequests: mock.calls.length }));
} finally { await mod.shutdownServer({ reason: "retention-restart-test" }); mock.restore(); }
