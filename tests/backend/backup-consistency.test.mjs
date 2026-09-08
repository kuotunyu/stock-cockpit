// 整機備份的真 CLI writer 互斥、落盤故障、canonical 目的地與停止服務後隔離還原。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, writeFile, copyFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bootServer } from "../helpers/test-server.mjs";
import { compactTradingDay } from "../helpers/fixtures.mjs";
import { verifyMachineBackup } from "../../scripts/backup.mjs";
const script = resolve("scripts/backup.mjs");
const preload = pathToFileURL(resolve("tests/helpers/backup-fs-preload.mjs")).href;
function child(args, env, config) {
  const proc = spawn(process.execPath, args, { env: { ...process.env, PORT: "0", SCHEDULER: "off", DB_PATH: "", STOCK1_SKIP_LISTEN: "", APP_SECRET: "synthetic-safe-secret-32-characters", ...env }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let out = "", err = "";
  proc.stdout.on("data", chunk => { out += chunk; });
  proc.stderr.on("data", chunk => { err += chunk; });
  const closed = new Promise((done, reject) => { proc.on("error", reject); proc.on("close", code => done({ code, out, err })); });
  if (config) proc.send(config);
  return { proc, closed };
}
const cli = (dataDir, target, config, dbPath = "") => child([...(config ? ["--import", preload] : []), script, target], { DATA_DIR: dataDir, DB_PATH: dbPath }, config);
async function tree(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) result[entry.name] = entry.isDirectory() ? await tree(join(directory, entry.name)) : (await readFile(join(directory, entry.name))).toString("base64");
  return result;
}

test("真 CLI 持鎖時拒絕 server 與第二份備份；I/O 失敗不發布／不輪替／不動來源", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "stock1-machine-fault-"));
  const source = join(root, "source"), target = join(root, "target");
  await mkdir(source); await mkdir(target);
  const dbPath = join(source, "stock1-db.json");
  await writeFile(dbPath, JSON.stringify({ users: [], trades: {} }));
  await writeFile(join(source, "fundamentals-cache.json"), JSON.stringify({ revenue: {} }));
  const processes = [];
  try {
    assert.equal((await cli(source, target).closed).code, 0);
    const old = await tree(target), sourceBefore = await tree(source);
    for (const mode of ["read-fail", "write-fail", "sync-fail", "rename-fail"]) {
      const result = await cli(source, target, { mode, source: join(source, "fundamentals-cache.json") }).closed;
      assert.equal(result.code, 1, result.out + result.err);
      assert.equal(result.out.includes("備份完成"), false);
      assert.deepEqual(await tree(target), old, mode);
      assert.deepEqual(await tree(source), sourceBefore, "備份不遷移或寫入來源");
    }
    const paused = cli(source, target, { mode: "pause-read", source: dbPath }); processes.push(paused);
    const [message] = await once(paused.proc, "message"); assert.equal(message.paused, true);
    const second = await cli(source, target).closed;
    assert.equal(second.code, 1); assert.match(second.err, /DATA_DIR_IN_USE/);
    const contender = child([resolve("tests/helpers/backup-restore-child.mjs"), source, dbPath], {}); processes.push(contender);
    const [denied] = await once(contender.proc, "message"); assert.equal(denied.error, "DATA_DIR_IN_USE");
    assert.equal((await contender.closed).code, 1);
    paused.proc.send({ resume: true });
    assert.equal((await paused.closed).code, 0);
    assert.equal((await readdir(target)).length, 2);
    assert.deepEqual(await tree(source), sourceBefore);
    // 租約釋放後同一資料可正常啟動。
    const next = child([resolve("tests/helpers/backup-restore-child.mjs"), source, dbPath], {}); processes.push(next);
    const [ready] = await once(next.proc, "message"); assert.equal(ready.ready, true);
    next.proc.send({ stop: true }); assert.equal((await next.closed).code, 0);
  } finally { for (const item of processes) if (item.proc.exitCode === null) { item.proc.kill(); await item.closed; } await rm(root, { recursive: true, force: true }); }
});

test("canonical 目的地擋資料 junction，允許名稱只有共同前綴的外部目錄", async () => {
  const root = await mkdtemp(join(tmpdir(), "stock1-machine-path-"));
  try {
    const source = join(root, "source"), alias = join(root, "alias");
    await mkdir(source); await writeFile(join(source, "stock1-db.json"), "{}");
    await symlink(source, alias, process.platform === "win32" ? "junction" : "dir");
    const result = await cli(source, join(alias, "nested")).closed;
    assert.equal(result.code, 1); assert.match(result.err, /BACKUP_TARGET_UNSAFE/);
    assert.deepEqual(await readdir(source), ["stock1-db.json"]);
    assert.equal((await cli(source, join(root, "source-other")).closed).code, 0);
    const outside = join(root, "outside.json"); await writeFile(outside, "{}");
    const unsafe = await cli(source, join(root, "target"), undefined, outside).closed;
    assert.equal(unsafe.code, 1); assert.match(unsafe.err, /DB_PATH_OUTSIDE_DATA_DIR/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("完整成功包驗 hash 後還原至自訂 DB_PATH，停止原程序再啟動保留帳本／計畫／正式 identity／pending-final／基本面", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "stock1-machine-restore-"));
  const source = join(root, "source"), target = join(root, "target"), restored = join(root, "restored");
  await mkdir(source); await mkdir(restored);
  const sourceDb = join(source, "active.json");
  let srv, restoredProcess;
  try {
    srv = await bootServer({ dataDir: source, dbPath: sourceDb, env: { SCHEDULER: "off" } });
    const liveDenied = await cli(source, target, undefined, sourceDb).closed;
    assert.equal(liveDenied.code, 1); assert.match(liveDenied.err, /DATA_DIR_IN_USE/);
    const db = await srv.mod.loadDb(), user = db.users[0].id;
    const planResponse = await srv.api("/api/trade-plans", { method: "PUT", body: JSON.stringify({ schemaVersion: 1, rev: 0, plans: [{ planId: "00000000-0000-4000-8000-000000000001", code: "2330", exchange: "TWSE", strategy: "swing", signalId: null, status: "draft", reason: "備份測試" }] }) });
    assert.equal(planResponse.status, 200, await planResponse.text());
    const day = compactTradingDay(-4);
    const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
    const publication = await srv.mod.commitDbMutation(draft => srv.mod.publishVerification(draft, "swing", {
      asOf: date, formulaVersion: srv.mod.SWING_FORMULA_VERSION, generatedAt: new Date().toISOString(),
      coverage: { complete: true }, requestScope: { maxCandidates: 240, scenarioKey: "", limit: 40 },
      scanQuality: { candidateCount: 2, completedCount: 2, reliable: true, coverageRate: 100 },
      sourceTimes: { twse: { sourceAsOf: date, precision: "date", observedAt: new Date().toISOString() } },
      picks: ["2330", "1101"].map(code => ({ code, name: code, exchange: "TWSE", scenario: { key: "midBandDefense" }, plan: { entry: 100, structuralStop: 95, target: 110 } })),
    }));
    assert.equal(publication.kind, "formal");
    await srv.mod.confirmVerificationPublication(publication);
    await srv.mod.commitDbMutation(draft => {
      draft.trades[user] = srv.mod.normalizeTradesPayload({ records: [{ id: "legacy-buy", code: "2330", side: "buy", kind: "stock", date: day, price: 100, shares: 1000, fee: 86, tax: 0 }] });
      assert.equal(draft.trades[user].records.length, 1);
      const rows = draft.swingVerification[day];
      assert.equal(rows.length, 2);
      rows[0].verificationRetry = { reason: "market-unknown" };
      rows[1].status = "win"; rows[1].resultPct = 10; rows[1].resolvedAt = day;
    });
    await srv.mod.shutdownServer({ reason: "stop-before-machine-backup" });
    const fundamentals = { revenue: { "2330": { "202001": { revenue: 100 } } }, eps: { "2330": { "2020Q1": { eps: 2 } } }, valuation: {}, dividends: {}, corporateActionResults: {}, corporateActionResultMonths: {} };
    await writeFile(join(source, "fundamentals-cache.json"), JSON.stringify(fundamentals));
    await writeFile(join(source, "surveillance-history.json"), JSON.stringify({ history: [{ date: "20200102", codes: ["2330"] }] }));
    const sourceBefore = await tree(source);
    const result = await cli(source, target, undefined, sourceDb).closed; assert.equal(result.code, 0, result.err);
    assert.deepEqual(await tree(source), sourceBefore);
    const [folder] = await readdir(target), pkg = join(target, folder);
    const manifest = await verifyMachineBackup(pkg);
    const verified = await child([script, "--verify", pkg], {}).closed;
    assert.equal(verified.code, 0); assert.match(verified.out, /驗證通過/);
    const restoredDb = join(restored, "ledger.json");
    for (const file of manifest.files) await copyFile(join(pkg, file.file), file.file === "stock1-db.json" ? restoredDb : join(restored, file.file));
    const expected = JSON.parse(await readFile(sourceDb, "utf8"));
    restoredProcess = child([resolve("tests/helpers/backup-restore-child.mjs"), restored, restoredDb], {});
    const [loaded] = await once(restoredProcess.proc, "message");
    assert.equal(loaded.ready, true, JSON.stringify(loaded)); assert.notEqual(loaded.port, 5174); assert.equal(loaded.upstreamRequests, 0);
    for (const [key, value] of Object.entries(loaded.fields)) assert.deepEqual(value, expected[key], key);
    assert.deepEqual(loaded.fundamentals, fundamentals);
    restoredProcess.proc.send({ stop: true }); assert.equal((await restoredProcess.closed).code, 0);
    await writeFile(join(pkg, "stock1-db.json"), "{}");
    await assert.rejects(verifyMachineBackup(pkg), /雜湊或長度不符/);
    assert.equal((await child([script, "--verify", pkg], {}).closed).code, 1);
  } finally {
    if (restoredProcess?.proc.exitCode === null) { restoredProcess.proc.kill(); await restoredProcess.closed; }
    await srv?.close(); await rm(root, { recursive: true, force: true });
  }
});

test("成功才輪替 30 份已驗證的新包，舊分鐘包與不完整包保持原樣", async () => {
  const { cp } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const root = await mkdtemp(join(tmpdir(), "stock1-machine-rotation-"));
  try {
    const source = join(root, "source"), target = join(root, "target");
    await mkdir(source); await writeFile(join(source, "stock1-db.json"), "{}");
    assert.equal((await cli(source, target).closed).code, 0);
    const [initial] = await readdir(target);
    for (let index = 0; index < 31; index++) {
      const createdAt = new Date(Date.now() - (index + 1) * 60000).toISOString();
      const name = `stock1-backup-${createdAt.replace(/[-:.]/g, "")}-${randomUUID()}`;
      const destination = join(target, name);
      await cp(join(target, initial), destination, { recursive: true });
      const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
      manifest.createdAt = createdAt;
      await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest));
    }
    const legacy = join(target, "stock1-backup-20200101-0000");
    await mkdir(legacy); await writeFile(join(legacy, "stock1-db.json"), '{"legacy":true}');
    const legacyCheck = await child([script, "--verify", legacy], {}).closed;
    assert.equal(legacyCheck.code, 0); assert.match(legacyCheck.out, /舊格式/); assert.match(legacyCheck.out, /無法證明跨檔一致/);
    const incomplete = join(target, ".stock1-backup-incomplete-abandoned");
    await mkdir(incomplete); await writeFile(join(incomplete, "partial"), "leave-alone");
    const before = await tree(target);
    assert.equal((await cli(source, target, { mode: "rename-fail" }).closed).code, 1);
    assert.deepEqual(await tree(target), before, "失敗不得輪替");
    assert.equal((await cli(source, target).closed).code, 0);
    assert.equal((await readdir(target)).length, 32);
    assert.equal(await readFile(join(legacy, "stock1-db.json"), "utf8"), '{"legacy":true}');
    assert.equal(await readFile(join(incomplete, "partial"), "utf8"), "leave-alone");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("輪替排除本身是有效成功包的現役 DATA_DIR，canonical alias 同樣保留來源且其他包維持 30 份", async () => {
  const { cp } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const root = await mkdtemp(join(tmpdir(), "stock1-machine-source-retention-"));
  try {
    const seed = join(root, "seed"), target = join(root, "target");
    await mkdir(seed);
    await writeFile(join(seed, "stock1-db.json"), '{"users":[],"trades":{"fixture":"keep-source"}}');
    await writeFile(join(seed, "fundamentals-cache.json"), '{"revenue":{"fixture":100}}');
    assert.equal((await cli(seed, target).closed).code, 0);
    const [initial] = await readdir(target);
    const source = join(target, `stock1-backup-20000101T000000000Z-${randomUUID()}`);
    await cp(join(target, initial), source, { recursive: true });
    const sourceManifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
    sourceManifest.createdAt = "2000-01-01T00:00:00.000Z";
    await writeFile(join(source, "manifest.json"), JSON.stringify(sourceManifest));
    for (let index = 0; index < 29; index++) {
      const createdAt = new Date(Date.now() - (index + 1) * 60000).toISOString();
      const name = `stock1-backup-${createdAt.replace(/[-:.]/g, "")}-${randomUUID()}`;
      const destination = join(target, name);
      await cp(join(target, initial), destination, { recursive: true });
      const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
      manifest.createdAt = createdAt;
      await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest));
    }
    assert.equal((await readdir(target)).length, 31);
    await verifyMachineBackup(source);
    const before = await tree(source);
    const alias = join(root, "source-alias");
    await symlink(source, alias, process.platform === "win32" ? "junction" : "dir");
    for (const dataDir of [source, alias]) {
      const result = await cli(dataDir, target).closed;
      assert.equal(result.code, 0, result.out + result.err);
      assert.match(result.out, /備份完成/);
      assert.deepEqual(await tree(source), before, "現役來源目錄與所有 bytes 必須原封不動");
      assert.equal((await readdir(target)).length, 31, "來源不計入可輪替成功包，其他包保留 30 份");
      await verifyMachineBackup(source);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
