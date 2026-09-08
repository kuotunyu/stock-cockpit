// scripts/backup.mjs：異地備份。無 APP_SECRET（或範例值）時券商憑證等同明文，必須剝掉再複製；
// 有 secret 原樣複製；來源損壞中止且不留半套資料夾。用子行程跑真正的 script。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp as makeTemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/backup.mjs");
const temporaryDirs = [];
async function mkdtemp(prefix) { const directory = await makeTemp(prefix); temporaryDirs.push(directory); return directory; }
after(async () => { for (const directory of temporaryDirs) await rm(directory, { recursive: true, force: true }); });

function run(args, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, PORT: "0", DB_PATH: "", STOCK1_ENV_FILE: join(env.DATA_DIR, "absent.env"), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => done({ code, out, err }));
  });
}

async function makeDataDir(dbContent) {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-bk-src-"));
  await writeFile(join(dataDir, "stock1-db.json"), dbContent ?? JSON.stringify({
    users: [],
    brokerCredentials: { u1: { provider: "fubon", encrypted: "abc", updatedAt: "2026-01-01T00:00:00.000Z" } },
    trades: { u1: { schemaVersion: 2, records: [] } },
  }));
  return dataDir;
}

// 測試不可讀到使用者真實的 .env（可能真的有 APP_SECRET），所以把 STOCK1_ENV_FILE 指到不存在的檔。
const noEnvFile = (dataDir) => join(dataDir, "no.env");

test("無 APP_SECRET：備份裡沒有 brokerCredentials、其餘完整，並印出提醒", async () => {
  const dataDir = await makeDataDir();
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const { code, out, err } = await run([target], { DATA_DIR: dataDir, APP_SECRET: "", STOCK1_ENV_FILE: noEnvFile(dataDir) });
  assert.equal(code, 0, out + err);
  const [folder] = await readdir(target);
  const db = JSON.parse(await readFile(join(target, folder, "stock1-db.json"), "utf8"));
  assert.equal(db.brokerCredentials, undefined);
  assert.ok(db.trades?.u1, "其他資料要完整");
  assert.ok(out.includes("券商憑證"), out);
});

test("範例值的 APP_SECRET 一樣視為沒設", async () => {
  const dataDir = await makeDataDir();
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const { code } = await run([target], { DATA_DIR: dataDir, APP_SECRET: "replace-with-a-long-random-secret", STOCK1_ENV_FILE: noEnvFile(dataDir) });
  assert.equal(code, 0);
  const [folder] = await readdir(target);
  const db = JSON.parse(await readFile(join(target, folder, "stock1-db.json"), "utf8"));
  assert.equal(db.brokerCredentials, undefined);
});

test("有 APP_SECRET：原樣複製（含 brokerCredentials）", async () => {
  const dataDir = await makeDataDir();
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const { code, out } = await run([target], { DATA_DIR: dataDir, APP_SECRET: "x".repeat(40), STOCK1_ENV_FILE: noEnvFile(dataDir) });
  assert.equal(code, 0, out);
  const [folder] = await readdir(target);
  const db = JSON.parse(await readFile(join(target, folder, "stock1-db.json"), "utf8"));
  assert.ok(db.brokerCredentials?.u1);
  assert.ok(!out.includes("已略過"), "有 secret 就不該說略過");
});

test("APP_SECRET 從 .env 檔讀得到", async () => {
  const dataDir = await makeDataDir();
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const envFile = join(dataDir, "custom.env");
  await writeFile(envFile, `PORT=5174\nAPP_SECRET="${"y".repeat(40)}"\n`);
  const env = { DATA_DIR: dataDir, STOCK1_ENV_FILE: envFile };
  delete process.env.APP_SECRET;
  const { code } = await run([target], { ...env, APP_SECRET: undefined });
  assert.equal(code, 0);
  const [folder] = await readdir(target);
  const db = JSON.parse(await readFile(join(target, folder, "stock1-db.json"), "utf8"));
  assert.ok(db.brokerCredentials?.u1, ".env 裡的 secret 要被採信");
});

test("來源損壞：中止且不留半套資料夾", async () => {
  const dataDir = await makeDataDir("{ broken");
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const { code } = await run([target], { DATA_DIR: dataDir, APP_SECRET: "x".repeat(40), STOCK1_ENV_FILE: noEnvFile(dataDir) });
  assert.equal(code, 1);
  assert.deepEqual(await readdir(target), []);
});

test("自訂 DB_PATH 備份現役主檔，manifest 不含私密路徑且可核對雜湊", async () => {
  const dataDir = await makeDataDir();
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const active = join(dataDir, "active.json");
  await writeFile(active, JSON.stringify({ users: [], trades: { active: true } }));
  const result = await run([target], { DATA_DIR: dataDir, DB_PATH: active, APP_SECRET: "x".repeat(40) });
  assert.equal(result.code, 0, result.out + result.err);
  const [folder] = await readdir(target);
  const db = JSON.parse(await readFile(join(target, folder, "stock1-db.json"), "utf8"));
  assert.deepEqual(db.trades, { active: true });
  const manifestText = await readFile(join(target, folder, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.format, "stock1-machine-backup");
  assert.equal(manifest.consistency, "stopped-writer");
  assert.equal(manifestText.includes(dataDir), false);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
});

test("同分鐘第二次失敗不污染成功包；可選檔消失後新包不殘留", async () => {
  const dataDir = await makeDataDir();
  const target = await mkdtemp(join(tmpdir(), "stock1-bk-dst-"));
  const env = { DATA_DIR: dataDir, DB_PATH: "", APP_SECRET: "x".repeat(40) };
  const optional = join(dataDir, "fundamentals-cache.json");
  await writeFile(optional, JSON.stringify({ original: true }));
  assert.equal((await run([target], env)).code, 0);
  const [first] = await readdir(target);
  const original = Object.fromEntries(await Promise.all((await readdir(join(target, first))).map(async name => [name, (await readFile(join(target, first, name))).toString("base64")])));
  await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify({ changed: true }));
  await writeFile(optional, "{ broken");
  const failed = await run([target], env);
  assert.equal(failed.code, 1);
  assert.equal(failed.out.includes("備份完成"), false);
  for (const [name, bytes] of Object.entries(original)) assert.equal((await readFile(join(target, first, name))).toString("base64"), bytes);
  const { unlink } = await import("node:fs/promises");
  await unlink(optional);
  assert.equal((await run([target], env)).code, 0);
  const folders = await readdir(target);
  assert.equal(folders.length, 2);
  const second = folders.find(name => name !== first);
  assert.equal((await readdir(join(target, second))).includes("fundamentals-cache.json"), false);
});

test("DATA_DIR 外置時仍拒絕以資料目錄作備份目的地", async () => {
  const dataDir = await makeDataDir();
  const before = await readdir(dataDir);
  const result = await run([dataDir], { DATA_DIR: dataDir, DB_PATH: "", APP_SECRET: "x".repeat(40) });
  assert.equal(result.code, 1, result.out + result.err);
  assert.deepEqual(await readdir(dataDir), before);
});
