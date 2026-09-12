// npm run preflight 的純函式：對外部署前把「不改就別上線」與「上線也行但要知道」分開列。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preflightChecks } from "../../scripts/preflight.mjs";

const dataDir = await mkdtemp(join(tmpdir(), "stock1-preflight-"));

const GOOD = {
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://stock1.example.zeabur.app",
  COOKIE_SECURE: "true",
  REQUIRE_LOGIN: "on",
  ADMIN_PASSWORD: "a-strong-admin-password-2026",
  APP_SECRET: "0123456789abcdef0123456789abcdef-very-long-secret",
  TRUST_PROXY: "on",
  TRUST_PROXY_HOPS: "1",
  DATA_DIR: dataDir,
  HOST: "0.0.0.0",
  SCHEDULER: "on",
  UPDATE_CHECK: "off",
};

test("齊全的對外設定：沒有 ✖，只剩單副本與備援提醒", () => {
  const result = preflightChecks(GOOD);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.notes.some((line) => /單一副本/.test(line)));
  assert.equal(result.summary.requireLogin, true);
  assert.equal(result.summary.origin, "https://stock1.example.zeabur.app");
});

test("本機範本原樣拿去部署：每個必要項都要被點名", () => {
  const result = preflightChecks({ NODE_ENV: "development", HOST: "127.0.0.1", PUBLIC_ORIGIN: "", COOKIE_SECURE: "false", DATA_DIR: ".data", APP_SECRET: "", ADMIN_PASSWORD: "" }, { probeDataDir: false });
  assert.equal(result.ok, false);
  const text = result.problems.join("\n");
  for (const needle of ["NODE_ENV", "PUBLIC_ORIGIN", "REQUIRE_LOGIN", "ADMIN_PASSWORD", "APP_SECRET"]) assert.match(text, new RegExp(needle), needle);
  assert.ok(result.warnings.some((line) => /DATA_DIR=\.data 是相對路徑/.test(line)), "相對 DATA_DIR 要提醒重新部署會遺失");
  assert.ok(result.warnings.some((line) => /HOST=127\.0\.0\.1/.test(line)));
  assert.ok(result.warnings.some((line) => /TRUST_PROXY/.test(line)));
});

test("http 的 PUBLIC_ORIGIN、範例密鑰、COOKIE_SECURE 漏設、代理層數不是正整數都是 ✖", () => {
  const result = preflightChecks({ ...GOOD, PUBLIC_ORIGIN: "http://stock1.example.test", COOKIE_SECURE: "false", APP_SECRET: "replace-with-a-long-random-secret", TRUST_PROXY_HOPS: "0" });
  const text = result.problems.join("\n");
  assert.match(text, /PUBLIC_ORIGIN 必須是 https/);
  assert.doesNotMatch(text, /COOKIE_SECURE/, "origin 不是 https 時不再重複點名 cookie（先把 https 弄對）");
  assert.match(text, /APP_SECRET/);
  assert.match(text, /TRUST_PROXY_HOPS/);
  const secure = preflightChecks({ ...GOOD, COOKIE_SECURE: "false" });
  assert.match(secure.problems.join("\n"), /COOKIE_SECURE 必須是 true/);
});

test("DATA_DIR 真的去探：不存在是 ✖，存在且可寫才過", () => {
  const missing = preflightChecks({ ...GOOD, DATA_DIR: join(dataDir, "nope") });
  assert.ok(missing.problems.some((line) => /不存在/.test(line)));
  const ok = preflightChecks({ ...GOOD, DATA_DIR: dataDir });
  assert.deepEqual(ok.problems, []);
});

test("登入有效期超過 14 天與關閉排程只是 ⚠，不擋上線", () => {
  const result = preflightChecks({ ...GOOD, SESSION_MAX_AGE_MS: String(30 * 24 * 60 * 60 * 1000), SCHEDULER: "off" });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((line) => /SESSION_MAX_AGE_MS/.test(line)));
  assert.ok(result.warnings.some((line) => /SCHEDULER/.test(line)));
});
