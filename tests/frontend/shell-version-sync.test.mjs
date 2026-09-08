// app.js 的 APP_SHELL_VERSION 與 sw.js 的 CACHE_NAME 必須是同一字串：改外殼資產只 bump 一邊，
// 版本面板會用舊分頁身份、Service Worker 卻換了快取，兩邊對不上。這條守衛讓漏改立刻轉紅。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../sw.js", import.meta.url), "utf8");

test("APP_SHELL_VERSION 與 CACHE_NAME 同步遞增", () => {
  const appVersion = app.match(/^const APP_SHELL_VERSION = "([A-Za-z0-9._-]+)";/m);
  const cacheName = sw.match(/^const CACHE_NAME = "([A-Za-z0-9._-]+)";/m);
  assert.ok(appVersion, "app.js 頂部必須維持 const APP_SHELL_VERSION = \"...\"; 的可讀格式（server 從磁碟讀這行）");
  assert.ok(cacheName, "sw.js 必須維持 const CACHE_NAME = \"...\"; 的可讀格式");
  assert.equal(appVersion[1], cacheName[1], "兩個版本字串必須相同");
  assert.match(appVersion[1], /^stock1-shell-v\d+$/, "沿用 stock1-shell-vN 命名");
});
