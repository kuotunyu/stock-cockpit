// sidecar（月營收／EPS 歷史、處置快照、風險 last-good）讀檔失敗不得靜默重置成 {} 再被下一次 save 蓋掉。
// 舊寫法 catch 全吞：防毒隔離／OneDrive 鎖檔／磁碟錯誤一次，官方只回最新一期的營收歷史就歸零，而且沒有訊息。
// 現在：ENOENT 才是空白的第一次啟動；壞 JSON 另存 .corrupt-* 副本並標唯讀；其他 I/O 錯誤也唯讀。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootServer } from "../helpers/test-server.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-sidecar-"));
const corruptFundamentals = "{ this is not json";
await writeFile(join(dataDir, "fundamentals-cache.json"), corruptFundamentals, "utf8");
await writeFile(join(dataDir, "surveillance-history.json"), "[]garbage", "utf8");
const srv = await bootServer({ routes: [], dataDir });
after(async () => { await srv.close(); });

test("壞 JSON：保留 .corrupt-* 副本、標唯讀、health 揭露且不洩漏路徑", async () => {
  const history = await srv.mod.loadFundamentalsHistory();
  assert.ok(history && typeof history === "object");
  assert.deepEqual(Object.keys(history.revenue), [], "記憶體裡是空的，可以繼續看盤");
  const names = await readdir(dataDir);
  const corruptCopy = names.find((n) => n.startsWith("fundamentals-cache.json.corrupt-"));
  assert.ok(corruptCopy, names.join(","));
  assert.equal(await readFile(join(dataDir, corruptCopy), "utf8"), corruptFundamentals, "副本要原封不動");
  const health = await (await srv.raw("/api/health")).json();
  assert.equal(health.sidecars.fundamentals.readOnly, true);
  assert.equal(health.sidecars.fundamentals.reason, "corrupt");
  assert.ok(!JSON.stringify(health).includes(dataDir), "health 不得洩漏路徑");
});

test("唯讀時 save 回 false 且不覆寫原檔", async () => {
  const saved = await srv.mod.saveFundamentalsHistory();
  assert.equal(saved, false);
  assert.equal(await readFile(join(dataDir, "fundamentals-cache.json"), "utf8"), corruptFundamentals, "原檔不可被 {} 蓋掉");
});

test("處置快照同款保護", async () => {
  await srv.mod.loadSurveillanceHistory();
  const health = await (await srv.raw("/api/health")).json();
  assert.equal(health.sidecars.surveillance.readOnly, true);
  assert.equal(await readFile(join(dataDir, "surveillance-history.json"), "utf8"), "[]garbage");
});

test("ENOENT 才是正常的第一次啟動：risk-cache 不存在 → 可寫", async () => {
  await srv.mod.loadRiskSourceMemory();
  const health = await (await srv.raw("/api/health")).json();
  assert.equal(health.sidecars.risk.readOnly, false);
  assert.equal(health.sidecars.risk.reason, "");
});

test("loadSidecarJson：ENOENT 空物件可寫；壞 JSON 唯讀＋副本；正常檔原樣", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stock1-sidecar-unit-"));
  const missing = await srv.mod.loadSidecarJson(join(dir, "nope.json"), "nope.json");
  assert.deepEqual(missing, { value: {}, readOnly: false, reason: "" });
  await writeFile(join(dir, "ok.json"), JSON.stringify({ a: 1 }));
  const ok = await srv.mod.loadSidecarJson(join(dir, "ok.json"), "ok.json");
  assert.deepEqual(ok, { value: { a: 1 }, readOnly: false, reason: "" });
  await writeFile(join(dir, "bad.json"), "{{");
  const bad = await srv.mod.loadSidecarJson(join(dir, "bad.json"), "bad.json");
  assert.equal(bad.readOnly, true);
  assert.equal(bad.reason, "corrupt");
  assert.ok((await readdir(dir)).some((n) => n.startsWith("bad.json.corrupt-")));
});
