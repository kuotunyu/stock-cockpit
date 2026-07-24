// Node 24 的原生 coverage 會把帶 query-string 的同一 ESM 視為多份來源，最後以其中一份
// 覆蓋掉其餘 worker 的聯集。先正常跑這兩個刻意 cache-bust 的測試，再只對穩定 URL 的測試
// 收集覆蓋率，才能同時保留完整回歸與可信的 server.mjs 指標。
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheBustNames = new Set([
  "dividend-schedule-resilience.test.mjs",
  "fundamentals-dividend-source-status.test.mjs",
]);

function testFiles(folder) {
  return readdirSync(join(root, "tests", folder))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => ({ name, path: join(root, "tests", folder, name) }));
}

function runNode(args, label) {
  console.log(`\n[coverage] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const backend = testFiles("backend");
const frontend = testFiles("frontend");
const cacheBust = backend.filter(({ name }) => cacheBustNames.has(name)).map(({ path }) => path);
const measurable = [
  ...backend.filter(({ name }) => !cacheBustNames.has(name)),
  ...frontend,
].map(({ path }) => path);

runNode(
  ["--test", ...cacheBust],
  "先驗證 7 項 cache-bust 韌性契約（不納入原生 coverage 合併）",
);
runNode(
  [
    "--test",
    "--test-concurrency=1",
    "--experimental-test-coverage",
    "--test-coverage-exclude=tests/**",
    ...measurable,
  ],
  "其餘測試序列執行並合併可信覆蓋率",
);
