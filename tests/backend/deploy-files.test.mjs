// 對外部署檔的契約：Dockerfile／.dockerignore／.nvmrc 不會被任何執行期測試碰到，
// 這裡把「為什麼是這樣」鎖成斷言，改動時至少要看過這些理由。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const dockerfile = read("Dockerfile");
const dockerignore = read(".dockerignore").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
const pkg = JSON.parse(read("package.json"));

test("Dockerfile：glibc 基底（fubon-neo 原生模組）、production、資料在 /data、非 root、探針打 /api/health", () => {
  assert.match(dockerfile, /^FROM node:24-bookworm-slim$/m, "alpine（musl）載不進 fubon-neo 的 linux-x64-gnu 模組");
  assert.match(dockerfile, /NODE_ENV=production/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /DATA_DIR=\/data/);
  assert.match(dockerfile, /TZ=Asia\/Taipei/, "排程與交易日判斷以台北時間為準");
  assert.match(dockerfile, /UPDATE_CHECK=off/, "映像裡沒有 .git，版本比對只會 unavailable");
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^VOLUME \["\/data"\]$/m);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/);
  assert.match(dockerfile, /^CMD \["node", "server\.mjs"\]$/m);
  assert.doesNotMatch(dockerfile, /REQUIRE_LOGIN|ADMIN_PASSWORD|APP_SECRET|PUBLIC_ORIGIN/, "密鑰與站台專屬設定由平台環境變數提供，不烙進映像");
});

test(".dockerignore：資料、密鑰、憑證、測試與本機開發檔不進映像；.env.example 保留", () => {
  for (const entry of ["node_modules", ".git", ".data", ".data-preview", ".env", "*.pfx", "*.p12", "*.pem", "*.key", "tests", "test-results", ".agents", ".claude", "CLAUDE.md"]) {
    assert.ok(dockerignore.includes(entry), `缺 ${entry}`);
  }
  assert.ok(dockerignore.includes("!.env.example"));
});

test(".nvmrc 與 package.json engines 一致；有 preflight 指令", () => {
  assert.equal(read(".nvmrc").trim(), "24");
  assert.match(pkg.engines.node, /24/);
  assert.match(pkg.scripts.preflight, /scripts\/preflight\.mjs/);
});
