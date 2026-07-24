import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const workerUrl = new URL("../../sw.js", import.meta.url);

test("service worker activation only removes old Stock1 shell caches", async () => {
  const source = await readFile(workerUrl, "utf8");
  // 現役版號從 sw.js 動態讀出，bump CACHE_NAME 時測試不必再手動同步
  const currentCache = source.match(/CACHE_NAME = "(stock1-shell-v\d+)"/)?.[1];
  assert.ok(currentCache, "sw.js 應宣告 CACHE_NAME");
  const listeners = new Map();
  const deleted = [];
  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      claim: async () => {},
    },
    skipWaiting() {},
  };
  const caches = {
    async keys() {
      return ["stock1-shell-v1", "stock1-shell-v3", currentCache, "another-app-cache"];
    },
    async delete(key) {
      deleted.push(key);
      return true;
    },
  };

  vm.runInNewContext(source, {
    URL,
    Response,
    caches,
    fetch: async () => new Response(),
    self,
  });

  const activate = listeners.get("activate");
  assert.equal(typeof activate, "function");
  let activation;
  activate({ waitUntil(promise) { activation = promise; } });
  await activation;

  assert.deepEqual(deleted, ["stock1-shell-v1", "stock1-shell-v3"]);
});
