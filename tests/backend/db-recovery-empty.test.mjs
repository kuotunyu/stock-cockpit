// 資料保命最後防線：主檔壞、所有備份也壞 → 以空 DB 啟動（大聲警告），仍要能開新帳、能寫入。
// 一個行程只能測一種 loadDb 情境 → 獨立成檔。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-dbrec3-"));

await mkdir(join(dataDir, "backups"), { recursive: true });
await writeFile(join(dataDir, "backups", "stock1-db-20260601.json"), "not json at all", "utf8");
await writeFile(join(dataDir, "stock1-db.json"), '{"broken', "utf8");

const warns = [];
const origWarn = console.warn;
console.warn = (...args) => { warns.push(args.join(" ")); origWarn(...args); };

const { mod } = await importServer({ routes: [], dataDir });

test("主檔與全部備份都壞 → 空 DB 啟動＋初始 admin 重建＋大聲警告", async () => {
  const db = await mod.loadDb();
  console.warn = origWarn;
  assert.ok(Array.isArray(db.users) && db.users.length >= 1, "空 DB 會重建初始 admin");
  assert.ok(db.users.every((u) => u.id !== "u_backup" && u.id !== "u_older"), "不該撿到任何壞備份的內容");
  const files = await readdir(dataDir);
  assert.ok(files.some((name) => name.startsWith("stock1-db.json.corrupt-")), "壞主檔要保留鑑識");
  assert.ok(warns.some((w) => w.includes("沒有可用備份")), `要大聲說明走到最後防線：${warns.join(" / ")}`);
});

test("空 DB 之後仍能正常寫入完整 JSON", async () => {
  const db = await mod.loadDb();
  db.watchLists.smoke = { 1: ["2330"], 2: [], 3: [] };
  await mod.saveDb(db);
  const files = await readdir(dataDir);
  assert.ok(!files.some((name) => name.endsWith(".tmp")), "不得留 .tmp 殘檔");
});
