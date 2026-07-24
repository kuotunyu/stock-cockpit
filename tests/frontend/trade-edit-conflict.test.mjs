// 一般交易修正的 409 重放契約：必須套用最新版 v2 巢狀紀錄，且目標消失時不得送出空操作。
import test from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const settings = { feeDiscount: 0.6, minFee: 20 };

const emptyPortfolio = () => ({
  ok: true,
  holdings: [],
  realized: [],
  totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 },
});

const staleTarget = {
  id: "edit-target",
  code: "2330",
  market: "TWSE",
  instrumentType: "stock",
  instrumentSource: "user",
  side: "sell",
  tradeDate: "20260710",
  date: "20260710",
  executedAt: "2026-07-10T10:30:15+08:00",
  session: "regular",
  brokerAccountId: "account-stale",
  currency: "TWD",
  price: 100,
  shares: 1000,
  dayTrade: { status: "userConfirmed", matchedShares: 400, pairId: "pair-stale" },
  fee: 86,
  feeAmountTwd: 86,
  feeSource: "broker",
  tax: 240,
  taxAmountTwd: 240,
  taxSource: "broker",
  createdAt: "2026-07-10T11:00:00.000Z",
};

const otherTabRecord = {
  id: "other-tab-buy",
  code: "1101",
  market: "TWSE",
  instrumentType: "stock",
  instrumentSource: "official",
  side: "buy",
  tradeDate: "20260711",
  date: "20260711",
  session: "regular",
  brokerAccountId: "account-latest",
  currency: "TWD",
  price: 40,
  shares: 1000,
  dayTrade: { status: "none", matchedShares: 0, pairId: "" },
  fee: 34,
  feeAmountTwd: 34,
  feeSource: "broker",
  tax: 0,
  taxAmountTwd: 0,
  taxSource: "broker",
  createdAt: "2026-07-11T09:00:00.000Z",
};

function tradesPayload({ rev, records }) {
  return {
    ok: true,
    schemaVersion: 2,
    rev,
    settings,
    records,
    quarantinedRecords: [],
    portfolio: emptyPortfolio(),
  };
}

async function waitUntil(app, predicate, message) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await app.settle(1);
  }
  assert.fail(message);
}

function openEditAndChangePrice(app, price) {
  app.evalIn(`
    (() => {
      state.watchList = "hold";
      renderHoldingsPanel();
      el.holdingsPanel.querySelector('[data-trade-edit="edit-target"]').click();
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.price.value = ${JSON.stringify(String(price))};
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
}

test("409 後目標仍存在：在最新版 v2 dayTrade 上重放，並保留他方新增紀錄", async (t) => {
  let putCalls = 0;
  const putBodies = [];
  const latestTarget = {
    ...staleTarget,
    instrumentSource: "official",
    brokerAccountId: "account-latest",
    dayTrade: { ...staleTarget.dayTrade, pairId: "pair-latest" },
    externalRef: "latest-only",
  };

  const tradesRoute = (_raw, init) => {
    if ((init?.method || "GET") !== "PUT") {
      return putCalls === 0
        ? tradesPayload({ rev: 1, records: [staleTarget] })
        : tradesPayload({ rev: 2, records: [latestTarget, otherTabRecord] });
    }
    putCalls += 1;
    const body = JSON.parse(init.body);
    putBodies.push(body);
    if (putCalls === 1) {
      return { ok: false, code: "REV_CONFLICT", error: "帳本已更新", rev: 2, __status: 409 };
    }
    return tradesPayload({ rev: 3, records: body.records });
  };

  const app = await createAppWindow({ fetchRoutes: { "/api/trades": tradesRoute } });
  t.after(() => app.cleanup());
  openEditAndChangePrice(app, 101);
  await waitUntil(app, () => putCalls === 2 && app.evalIn("tradesState.mutating") === false, "修正應在 409 後完成第二次 PUT");

  assert.equal(putBodies.length, 2);
  assert.equal(putBodies[0].records.length, 1, "第一次 PUT 尚未看見另一分頁的新紀錄");
  assert.equal(putBodies[0].records[0].dayTrade.pairId, "pair-stale");

  const replay = putBodies[1];
  assert.equal(replay.schemaVersion, 2);
  assert.equal(replay.rev, 2, "重放必須使用同步後的 rev");
  assert.deepEqual(replay.records.map((record) => record.id).sort(), ["edit-target", "other-tab-buy"]);
  assert.deepEqual(replay.records.find((record) => record.id === "other-tab-buy"), otherTabRecord, "他方新增紀錄不可被覆蓋");

  const edited = replay.records.find((record) => record.id === "edit-target");
  assert.equal(edited.price, 101, "本分頁的修正仍須套用");
  assert.equal(edited.dayTrade.pairId, "pair-latest", "巢狀 dayTrade 必須從最新版目標重建");
  assert.equal(edited.brokerAccountId, "account-latest");
  assert.equal(edited.instrumentSource, "official");
  assert.equal(edited.externalRef, "latest-only", "最新版目標上的未知欄位也不可遺失");
  assert.equal(app.evalIn("tradesState.rev"), 3);
});

test("409 後目標已消失：不可送第二次 no-op PUT，也不可回報修正成功", async (t) => {
  let putCalls = 0;
  const putBodies = [];
  const tradesRoute = (_raw, init) => {
    if ((init?.method || "GET") !== "PUT") {
      return putCalls === 0
        ? tradesPayload({ rev: 1, records: [staleTarget] })
        : tradesPayload({ rev: 2, records: [otherTabRecord] });
    }
    putCalls += 1;
    putBodies.push(JSON.parse(init.body));
    if (putCalls === 1) {
      return { ok: false, code: "REV_CONFLICT", error: "帳本已更新", rev: 2, __status: 409 };
    }
    return tradesPayload({ rev: 3, records: [otherTabRecord] });
  };

  const app = await createAppWindow({ fetchRoutes: { "/api/trades": tradesRoute } });
  t.after(() => app.cleanup());
  openEditAndChangePrice(app, 102);
  await waitUntil(
    app,
    () => app.evalIn("tradesState.mutating") === false && app.evalIn("document.querySelector('#toastStack .toast:last-child')?.textContent.includes('交易紀錄修正失敗')") === true,
    "目標消失時應結束 mutation 並顯示失敗訊息",
  );

  assert.equal(putCalls, 1, "同步後目標不存在，不得送第二次空操作 PUT");
  assert.equal(putBodies[0].records.length, 1);
  assert.deepEqual(JSON.parse(app.evalIn("JSON.stringify(tradesState.records)")), [otherTabRecord], "畫面狀態應保留同步到的最新版帳本");
  const toastText = app.evalIn("[...document.querySelectorAll('#toastStack .toast')].map((toast) => toast.textContent).join('｜')");
  assert.match(toastText, /交易紀錄修正失敗：這筆交易已在其他視窗刪除，未進行修正/);
  assert.doesNotMatch(toastText, /交易紀錄已修正/);
  assert.doesNotMatch(toastText, /已自動同步並套用你這筆操作/);
});
