// 蓋寫防護前端行為（審計 D）：交易紀錄 PUT 收到 409 → 自動同步最新版＋重放這次操作一次。
// 用有狀態的 mock 路由：第一次 PUT 回 409，GET 回「別的分頁已加了一筆」的新版，第二次 PUT 成功。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const otherTabRecord = { id: "other1", code: "1101", side: "buy", kind: "stock", date: "20260630", price: 40, shares: 1000, fee: 34, tax: 0, note: "", createdAt: "2026-06-30T01:00:00.000Z" };
const calls = { put: 0, get: 0 };
let lastPutBody = null;

const tradesRoute = (raw, init) => {
  if ((init?.method || "GET") === "PUT") {
    calls.put += 1;
    lastPutBody = JSON.parse(init.body);
    if (calls.put === 1) {
      return { ok: false, code: "REV_CONFLICT", error: "資料已在其他視窗更新過", rev: 5, __status: 409 };
    }
    return { ok: true, rev: 6, settings: { feeDiscount: 0.6, minFee: 20 }, records: lastPutBody.records, portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 } } };
  }
  calls.get += 1;
  return { ok: true, rev: 5, settings: { feeDiscount: 0.6, minFee: 20 }, records: [otherTabRecord], portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 } } };
};

let app;
before(async () => {
  app = await createAppWindow({ fetchRoutes: { "/api/trades": tradesRoute } });
});
after(() => app.cleanup());

test("409 → 重新 GET 同步 → 以新狀態重放操作 → 第二次 PUT 帶新 rev 且包含雙方的紀錄", async () => {
  app.evalIn(`
    tradesState.rev = 3; // 本分頁的過期版本
    tradesState.records = [];
    tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
  `);
  const getBefore = calls.get; // initializeApp 開機時已 GET 過一次
  const ok = await app.win.addTradeRecord({ code: "2330", side: "buy", kind: "stock", price: 100, shares: 1000, date: "2026-07-02" });
  assert.equal(ok, true, "重放後應成功");
  assert.equal(calls.put, 2, "PUT 兩次（409 → 重試）");
  assert.equal(calls.get, getBefore + 1, "409 後要重新 GET 同步一次");
  assert.equal(lastPutBody.rev, 5, "重試的 PUT 要帶伺服器給的新 rev");
  const codes = lastPutBody.records.map((r) => r.code).sort();
  assert.deepEqual(codes, ["1101", "2330"], "重放後要同時保住別的分頁那筆（1101）和自己這筆（2330）");
  assert.equal(JSON.parse(app.evalIn(`JSON.stringify(tradesState.rev)`)), 6, "成功後套用最新 rev");
});
