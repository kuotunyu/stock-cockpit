// 還原測試使用的獨立 port 0 程序：離線載入並回傳實際已載入欄位，收到訊息才完整關機。
import { importServer } from "./test-server.mjs";
import { once } from "node:events";
const { mod, mock } = await importServer({ dataDir: process.argv[2], dbPath: process.argv[3], env: { SCHEDULER: "off" } });
try {
  const server = await mod.startServer(0, "127.0.0.1");
  const db = await mod.loadDb();
  const fundamentals = await mod.loadFundamentalsHistory();
  const fields = Object.fromEntries(["trades", "tradePlans", "verificationPublications", "verificationCaptures", "signalSnapshots", "swingVerification"].map(key => [key, db[key]]));
  process.send({ ready: true, port: server.address().port, fields, fundamentals, upstreamRequests: mock.calls.length });
  await once(process, "message");
} catch (error) { process.send({ error: error.code || error.message }); process.exitCode = 1; }
finally { await mod.shutdownServer({ reason: "backup-restore-test" }); mock.restore(); process.disconnect(); }
