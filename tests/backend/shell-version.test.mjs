// 2026-09-17：外殼版本由伺服器以「所有外殼資產內容雜湊」代入 app.js／sw.js，不再手動同步兩檔遞增。
// 釘住：代入是純字串替換且只換那一行；雜湊只看內容不看時間；HTTP 送出的兩檔版本一致、格式固定；
// 代入後的 ETag 隨版本變（否則只改 styles.css 時瀏覽器會拿到 304、SW 快取名不換）。
import test from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";

const { mod, baseUrl, close } = await bootServer({ routes: [] });
test.after(async () => { await close(); });

test("applyShellVersion／shellVersionFromParts 純函式", () => {
  assert.equal(mod.applyShellVersion('x\nconst APP_SHELL_VERSION = "stock1-shell-dev";\ny', "stock1-shell-abc123"),
    'x\nconst APP_SHELL_VERSION = "stock1-shell-abc123";\ny');
  assert.equal(mod.applyShellVersion('const CACHE_NAME = "stock1-shell-dev";', "stock1-shell-abc123"), 'const CACHE_NAME = "stock1-shell-abc123";');
  assert.equal(mod.applyShellVersion("沒有佔位的內容", "v"), "沒有佔位的內容");
  const a = mod.shellVersionFromParts(["app.js:e1", "styles.css:e2"]);
  assert.match(a, /^stock1-shell-[0-9a-f]{12}$/);
  assert.equal(a, mod.shellVersionFromParts(["app.js:e1", "styles.css:e2"]), "同內容同版本");
  assert.notEqual(a, mod.shellVersionFromParts(["app.js:e1", "styles.css:e3"]), "任一資產內容變就換版本");
});

test("HTTP 送出的 app.js 與 sw.js 帶同一個內容雜湊版本；ETag 含版本", async () => {
  const version = await mod.computeShellVersion();
  assert.match(version, /^stock1-shell-[0-9a-f]{12}$/);
  const [app, sw] = await Promise.all([fetch(`${baseUrl}/app.js`), fetch(`${baseUrl}/sw.js`)]);
  const appText = await app.text();
  const swText = await sw.text();
  assert.equal(/const APP_SHELL_VERSION = "([^"]+)";/.exec(appText)?.[1], version);
  assert.equal(/const CACHE_NAME = "([^"]+)";/.exec(swText)?.[1], version);
  assert.doesNotMatch(appText, /stock1-shell-dev/);
  assert.doesNotMatch(swText, /stock1-shell-dev/);
  // 同版本再抓：ETag 命中 304
  const again = await fetch(`${baseUrl}/sw.js`, { headers: { "if-none-match": sw.headers.get("etag") } });
  assert.equal(again.status, 304);
  // ETag 是代入後內容的雜湊，不是原文的：跟原文 sha1 不同
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const rawEtag = `"${createHash("sha1").update(readFileSync(new URL("../../sw.js", import.meta.url))).digest("base64url")}"`;
  assert.notEqual(sw.headers.get("etag"), rawEtag);
});
