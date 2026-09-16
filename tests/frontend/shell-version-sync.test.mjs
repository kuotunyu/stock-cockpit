// 2026-09-17 起外殼版本不再手寫 vN：app.js 的 APP_SHELL_VERSION 與 sw.js 的 CACHE_NAME 在原始碼裡都是佔位
// "stock1-shell-dev"，伺服器送出時代入「所有外殼資產內容雜湊」。這條守衛釘住：佔位格式不能改（伺服器用正則代入）、
// 兩檔佔位相同、代入函式只換那一行。真的經 HTTP 代入後兩檔一致由 tests/backend/shell-version.test.mjs 驗。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../sw.js", import.meta.url), "utf8");

test("APP_SHELL_VERSION 與 CACHE_NAME 都是可代入的佔位字串", () => {
  const appVersion = app.match(/^const APP_SHELL_VERSION = "([A-Za-z0-9._-]+)";/m);
  const cacheName = sw.match(/^const CACHE_NAME = "([A-Za-z0-9._-]+)";/m);
  assert.ok(appVersion, "app.js 頂部必須維持 const APP_SHELL_VERSION = \"...\"; 的可讀格式（伺服器用正則代入）");
  assert.ok(cacheName, "sw.js 必須維持 const CACHE_NAME = \"...\"; 的可讀格式");
  assert.equal(appVersion[1], "stock1-shell-dev", "原始碼裡只放佔位，不再手寫 vN");
  assert.equal(cacheName[1], "stock1-shell-dev");
});
