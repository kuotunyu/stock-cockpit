// 2026-09-17：handleApi 從 1,256 行 if 鏈改成路由表（方法、登入政策、handler）＋派發器。這裡釘住：
// 表本身合法、README 端點清單由表產生不漂移、app.js 打的每個路徑都存在、派發器的 405／401／404 順序。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bootServer } from "../helpers/test-server.mjs";
import { renderApiRoutesMarkdown, replaceApiRoutesBlock, AUTH_LABELS } from "../../scripts/api-routes.mjs";

const { mod, baseUrl, close } = await bootServer({ routes: [] });
test.after(async () => { await close(); });
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

test("路由表：路徑唯一、方法與登入政策合法、每條都有 handler", () => {
  const paths = mod.apiRoutes.map((route) => route.path);
  assert.equal(new Set(paths).size, paths.length, "路徑不可重複");
  for (const route of mod.apiRoutes) {
    assert.match(route.path, /^\/api\/[a-z0-9/-]+$/, route.path);
    assert.ok(route.methods.length >= 1 && route.methods.every((method) => METHODS.has(method)), `${route.path} methods`);
    assert.ok(route.auth in AUTH_LABELS, `${route.path} auth=${route.auth}`);
    assert.equal(typeof route.handler, "function", `${route.path} handler`);
  }
  assert.ok(mod.apiRoutes.length >= 40);
});

test("README 的端點清單與路由表一致（改了路由表就跑 node scripts/api-routes.mjs --write）", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  assert.equal(readme, replaceApiRoutesBlock(readme, renderApiRoutesMarkdown(mod.apiRoutes)));
});

test("app.js 呼叫的每個 /api 路徑都在路由表裡（前端打到不存在的端點就紅）", () => {
  const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
  const byPath = new Set(mod.apiRoutes.map((route) => route.path));
  const called = new Set([...app.matchAll(/["'`](\/api\/[A-Za-z0-9/_-]+)/g)].map((match) => match[1]));
  assert.ok(called.size >= 30, "app.js 應該打到三十幾個端點");
  for (const path of called) assert.ok(byPath.has(path), `app.js 打了不存在的 ${path}`);
});

test("派發器順序：未知路徑 404、方法不對先 405（不管有沒有登入）、需登入的路由未登入 401、open 路由免登入", async () => {
  assert.equal((await fetch(`${baseUrl}/api/nope`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/health`, { method: "DELETE" })).status, 405);
  assert.equal((await fetch(`${baseUrl}/api/watchlists`, { method: "PATCH" })).status, 405, "方法檢查在登入檢查前");
  const unauth = await fetch(`${baseUrl}/api/watchlists`);
  assert.equal(unauth.status, 401);
  assert.equal((await unauth.json()).code, "AUTH_REQUIRED");
  assert.equal((await fetch(`${baseUrl}/api/admin/users`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/sources`, { method: "POST" })).status, 405, "唯讀路由不再把 POST 當 GET 跑");
});
