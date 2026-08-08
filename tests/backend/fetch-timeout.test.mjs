// fetchJson 逾時保護：上游「連線成功但永不回應」時要在 timeoutMs 內放棄（丟中文逾時錯誤），
// 否則 single-flight 快取會存住永不 resolve 的 promise，整個面板卡死到重開伺服器。
// 正常回應與其他網路錯誤不受逾時機制影響。掛死情境由本檔自行接管 globalThis.fetch 模擬。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({
  routes: [
    { match: /fast\.example/, reply: { ok: 1 } },
    { match: /boom\.example/, reply: { __error: "connect ECONNREFUSED" } },
  ],
});

test("正常回應：走 mock 路由，逾時機制不干擾", async () => {
  const body = await mod.fetchJson("https://fast.example/data", { timeoutMs: 5000 });
  assert.deepEqual(body, { ok: 1 });
});

test("上游永不回應 → timeoutMs 內以中文逾時錯誤收場（含主機名）", async () => {
  const original = globalThis.fetch;
  // 模擬掛死：只在 signal abort 時 reject（尊重 AbortSignal 的「永不回應」上游）。
  globalThis.fetch = (input, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  // Node 測試執行器在 20.20.2／22.23.2 上實測會誤判事件迴圈已空、提早把這個測試判定
  // cancelledByParent（本機 Node 24 不會，CI 用的兩個版本都會，已用 nvm 分別裝起來
  // 實測重現）——AbortSignal.timeout() 內部計時器沒有被視為「還有待處理工作」。
  // 用一個一般的 setInterval 佔住事件迴圈到逾時真正觸發為止，不影響下面的斷言。
  const keepAlive = setInterval(() => {}, 10);
  try {
    const started = Date.now();
    await assert.rejects(
      () => mod.fetchJson("https://hang.example/never", { timeoutMs: 80 }),
      /上游回應逾時.*hang\.example/
    );
    assert.ok(Date.now() - started < 2000, "應在逾時上限附近放棄，而不是掛住");
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = original;
  }
});

test("非逾時的網路錯誤原樣拋出（不被誤包成逾時）", async () => {
  await assert.rejects(() => mod.fetchJson("https://boom.example/x"), /ECONNREFUSED/);
});
