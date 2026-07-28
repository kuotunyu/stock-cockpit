// P6：主檔**不存在**但備份存在 ＝ 主檔遺失，不是第一次啟動。
//
// 舊行為：`else { dbCache = createEmptyDb(); }` → 下面立刻 saveDb 落盤，
// 唯一的 console 輸出是「Created initial admin user "admin"」，讀起來就像第一次開機。
// 隔天 backupDbDaily 會把這個空 DB 複製成當天的還原點，14 天後好備份全部被輪替掉
// → 交易帳本、自選股、共享備註全部永久消失，而好資料原本還躺在 backups/ 裡。
//
// 觸發路徑不罕見：防毒隔離、OneDrive 衝突改名、使用者看到 corrupt 訊息後手動刪檔、
// 或 corrupt → rename → saveDb 失敗 → 重跑。
//
// 三支既有的 db-recovery*.test.mjs 全部是「主檔存在但壞掉」，沒有一支測「主檔不存在」。
// loadDb 情境一個行程只能測一種（dbCache 單例）→ 獨立成檔，DATA_DIR 在 import 前預埋。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbmissing-"));
const good = {
  users: [{
    id: "u_real", username: "real", displayName: "真的使用者", role: "admin",
    passwordHash: "x", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z",
  }],
  sessions: [],
  watchLists: { u_real: { 1: ["2330", "0050"], 2: [], 3: [] } },
  trades: { u_real: { schemaVersion: 2, rev: 7, records: [{ id: "t1", code: "2330" }] } },
};
await mkdir(join(dataDir, "backups"), { recursive: true });
await writeFile(join(dataDir, "backups", "stock1-db-20260715.json"), JSON.stringify(good), "utf8");
await writeFile(join(dataDir, "backups", "stock1-db-20260726.json"), JSON.stringify(good), "utf8");
// 刻意**不**建立 stock1-db.json——這正是要測的情境。

const { mod } = await importServer({ routes: [], dataDir });

test("主檔不存在但有備份 → 必須 fail-closed，不得靜默起空 DB", async () => {
  await assert.rejects(
    () => mod.loadDb(),
    (error) => {
      assert.match(error.message, /不存在/, "要說主檔不見了");
      assert.match(error.message, /2 份備份/, "要講出有幾份備份可用");
      assert.match(error.message, /stock1-db-20260726\.json/, "要指名最新那份，使用者才知道要複製哪個");
      assert.match(error.message, /不會啟動/, "要說清楚為什麼停下來");
      // 兩條出路都要給：還原、或確定要全新開始。
      assert.match(error.message, /複製/, "要給還原的具體做法");
      assert.match(error.message, /移到別處/, "也要給「我確定要重來」的做法");
      // 「重來」的做法必須是移走而不是刪除——那是使用者唯一的資料，刪了就沒了。
      assert.match(error.message, /不要直接刪/, "要主動勸阻刪除");
      return true;
    },
  );
});

test("fail-closed 之後備份必須原封不動，主檔也不得被建立", async () => {
  const backups = await readdir(join(dataDir, "backups"));
  assert.deepEqual(backups.sort(), ["stock1-db-20260715.json", "stock1-db-20260726.json"]);
  // 最關鍵的一條：舊行為會在這裡留下一個空的 stock1-db.json，
  // 隔天就被複製成當天的還原點，開始輪替掉好備份。
  const files = await readdir(dataDir);
  assert.equal(files.includes("stock1-db.json"), false, "不得落盤空 DB——那是資料遺失的起點");
  // 備份內容也要完好（沒有被覆寫）。
  const restored = JSON.parse(await (await import("node:fs/promises")).readFile(
    join(dataDir, "backups", "stock1-db-20260726.json"), "utf8",
  ));
  assert.equal(restored.users[0].id, "u_real");
  assert.deepEqual(restored.watchLists.u_real["1"], ["2330", "0050"]);
});
