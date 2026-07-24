// 帳本寫入鎖：快速連點不能被 rev 重放機制合併成兩筆合法但重複的交易。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let releasePut;
const putGate = new Promise((resolve) => { releasePut = resolve; });
let putCalls = 0;

const tradesRoute = async (_raw, init) => {
  if ((init?.method || "GET") !== "PUT") {
    return { ok: true, rev: 1, settings: { feeDiscount: 0.6, minFee: 20 }, records: [], portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0 } } };
  }
  putCalls += 1;
  const body = JSON.parse(init.body);
  await putGate;
  return { ok: true, rev: 2, settings: body.settings, records: body.records, portfolio: { ok: true, holdings: [], realized: [], totals: { cost: 0, realizedPnl: 0 } } };
};

const app = await createAppWindow({ fetchRoutes: { "/api/trades": tradesRoute } });
after(() => app.cleanup());

test("兩次同步新增只送一個 PUT，第二次在第一筆完成前被拒絕", async () => {
  app.evalIn(`
    tradesState.rev = 1;
    tradesState.records = [];
    tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
  `);
  const fields = { code: "2330", side: "buy", kind: "stock", price: 100, shares: 1000, date: "2026-07-02" };
  const first = app.win.addTradeRecord(fields);
  const second = app.win.addTradeRecord(fields);
  assert.equal(await second, false, "寫入中再次提交要立即拒絕");
  assert.equal(putCalls, 1);
  releasePut();
  assert.equal(await first, true);
  assert.equal(putCalls, 1);
  assert.equal(JSON.parse(app.evalIn(`JSON.stringify(tradesState.records.length)`)), 1);
  assert.equal(JSON.parse(app.evalIn(`JSON.stringify(tradesState.mutating)`)), false);
});
