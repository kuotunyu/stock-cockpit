// 資料保命（審計 A）：主 DB JSON 損壞 → 壞檔改名保留、自動用最新備份恢復、絕不靜默重建。
// DATA_DIR 在 import 前手動預埋（壞主檔＋好備份），一個行程只能測一種 loadDb 情境。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbrec-"));

// 好備份：帶一個 marker（自選股清單裡的 9999）證明資料真的是從備份來的。
const backupDb = {
  users: [{
    id: "u_backup", username: "keeper", displayName: "備份人", role: "user",
    passwordHash: "x", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
  }],
  sessions: [],
  watchLists: { u_backup: { 1: ["9999"], 2: [], 3: [] } },
};
await mkdir(join(dataDir, "backups"), { recursive: true });
await writeFile(join(dataDir, "backups", "stock1-db-20260601.json"), JSON.stringify(backupDb), "utf8");
// 壞主檔：模擬舊版非原子寫入被斷電截斷
await writeFile(join(dataDir, "stock1-db.json"), '{"users":[{"id":"u_half"', "utf8");

const { mod } = await importServer({ routes: [], dataDir });

test("壞主檔 → 用最新備份恢復（marker 存在）、壞檔改名保留、不拋錯", async () => {
  const db = await mod.loadDb();
  assert.ok(db.users.some((u) => u.id === "u_backup"), "資料應來自備份");
  assert.deepEqual(db.watchLists.u_backup?.["1"], ["9999"], "備份裡的自選股 marker 要在");
  const files = await readdir(dataDir);
  assert.ok(files.some((name) => name.startsWith("stock1-db.json.corrupt-")), `壞檔要被保留：${files.join(", ")}`);
  const rebuiltPrimary = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.deepEqual(rebuiltPrimary.watchLists.u_backup?.["1"], ["9999"], "恢復成功就要立刻重建主檔，不能等下一次編輯");
});

test("恢復後的第一次寫入：主檔是完整 JSON、無 .tmp 殘留", async () => {
  const db = await mod.loadDb();
  db.watchLists.u_backup["2"] = ["2330"];
  await mod.saveDb(db);
  const files = await readdir(dataDir);
  assert.ok(!files.some((name) => name.endsWith(".tmp")), "不得留 .tmp 殘檔");
  const reread = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.deepEqual(reread.watchLists.u_backup["2"], ["2330"], "寫回的主檔要可完整解析");
});
