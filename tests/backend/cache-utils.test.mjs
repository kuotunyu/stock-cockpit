// 有界 TTL 快取原語的直接契約測試：不開伺服器、不碰 DB、不打網路，只用普通 Map 與假時鐘。
// 這幾條 invariant 原本只能透過 buildSwingBoard／buildOvernightSignals／buildBacktest 間接驗，
// 每個都要完整 import server.mjs 加臨時 DATA_DIR、DB 與 fetch mock；搬進獨立模組後可以直接驗。
// 既有的 swing-cache-bounds 與 heavy-runtime-cache 仍是端到端那一層的權威，這裡不取代它們。
import test from "node:test";
import assert from "node:assert/strict";
import { setBoundedDateCache, getFreshTtlCacheEntry } from "../../cache-utils.mjs";

const entry = (expiresAt, value = null) => ({ expiresAt, value });
// 必須真的在未來：沒開假時鐘的測試用的是真實 Date.now()（約 1.79e12），
// 之前寫 9e9 反而是 1970 年代的過去時間，會讓每一筆都被當成過期。
const FAR = 9_000_000_000_000;

test("寫入會清掉整個 Map 的過期項，不只是正在寫的那個 key", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const cache = new Map([["stale", entry(1)], ["fresh", entry(FAR)]]);
  setBoundedDateCache(cache, "new", entry(FAR));
  assert.deepEqual([...cache.keys()], ["fresh", "new"], "無關的過期兄弟項也要被清掉");
});

test("命中條件是 expiresAt > now；expiresAt === now 算 miss 並順手刪除", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const cache = new Map([["k", entry(1_000_000)]]);
  assert.equal(getFreshTtlCacheEntry(cache, "k"), null, "剛好等於 now 不算新鮮");
  assert.equal(cache.has("k"), false, "miss 要把該 key 刪掉，不留給下一次誤判");
});

test("讀取命中會把 key 移到最後——這才是 LRU 而不是 FIFO 的來源", () => {
  const cache = new Map([["a", entry(FAR)], ["b", entry(FAR)], ["c", entry(FAR)]]);
  getFreshTtlCacheEntry(cache, "a");
  assert.deepEqual([...cache.keys()], ["b", "c", "a"], "命中應刷新新鮮度");
});

test("重寫既有 key 也會刷新新鮮度（先 delete 再 set）", () => {
  const cache = new Map([["a", entry(FAR)], ["b", entry(FAR)]]);
  setBoundedDateCache(cache, "a", entry(FAR));
  assert.deepEqual([...cache.keys()], ["b", "a"]);
});

test("maxEntries 預設 16，淘汰從 LRU 前端開始；剛寫入的 key 一定留得住", () => {
  const cache = new Map();
  for (let i = 0; i < 20; i += 1) setBoundedDateCache(cache, `k${i}`, entry(FAR));
  assert.equal(cache.size, 16, "institutionalCache／marginCache 就是吃這個預設值");
  assert.equal([...cache.keys()][0], "k4", "最舊的先被淘汰");

  const tight = new Map([["old", entry(FAR)]]);
  setBoundedDateCache(tight, "win", entry(FAR), 1);
  assert.deepEqual([...tight.keys()], ["win"], "maxEntries=1 時不可把剛寫入的那筆淘汰掉");
});

test("跨 module 邊界後仍跟著 mock timers 的假時鐘走", (t) => {
  // setBoundedDateCache 內部那個 Date.now() 不可注入，而 swing-cache-bounds 是用
  // mock timers 驅動 TTL 過期的。mock timers 換掉的是 globalThis.Date（整個 realm 共用），
  // 所以可注入的讀取路徑與不可注入的寫入路徑都照樣受控——這是搬移安全的前提。
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const cache = new Map();
  setBoundedDateCache(cache, "k", entry(1000));
  assert.equal(getFreshTtlCacheEntry(cache, "k")?.expiresAt, 1000, "t=0 時仍新鮮");

  t.mock.timers.setTime(1001);
  assert.equal(getFreshTtlCacheEntry(cache, "k"), null, "假時鐘前進後應過期");

  const sweep = new Map([["stale", entry(500)]]);
  setBoundedDateCache(sweep, "other", entry(FAR));
  assert.equal(sweep.has("stale"), false, "寫入路徑內部的 Date.now() 同樣受假時鐘控制");
});
