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
  try {
    const started = Date.now();
    await assert.rejects(
      () => mod.fetchJson("https://hang.example/never", { timeoutMs: 80 }),
      /上游回應逾時.*hang\.example/
    );
    assert.ok(Date.now() - started < 2000, "應在逾時上限附近放棄，而不是掛住");
  } finally {
    globalThis.fetch = original;
  }
});

test("非逾時的網路錯誤原樣拋出（不被誤包成逾時）", async () => {
  await assert.rejects(() => mod.fetchJson("https://boom.example/x"), /ECONNREFUSED/);
});
