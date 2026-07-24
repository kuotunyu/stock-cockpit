// 交易帳本 v2 表單、相容顯示、一般交易修正與歷史分批載入契約。
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
let lastPutBody = null;
let rev = 1;

const emptyPortfolio = () => ({
  ok: true,
  holdings: [],
  realized: [],
  totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 },
});

before(async () => {
  app = await createAppWindow({
    fetchRoutes: {
      "/api/trades": (_raw, init) => {
        if (!init?.method || init.method === "GET") {
          return {
            ok: true,
            schemaVersion: 2,
            rev,
            settings: { feeDiscount: 0.6, minFee: 20 },
            records: [],
            quarantinedRecords: [],
            portfolio: emptyPortfolio(),
          };
        }
        lastPutBody = JSON.parse(init.body);
        rev += 1;
        return {
          ok: true,
          ...lastPutBody,
          rev,
          quarantinedRecords: [],
          portfolio: emptyPortfolio(),
        };
      },
    },
  });
});

after(() => app.cleanup());

beforeEach(() => {
  lastPutBody = null;
  app.evalIn(`
    tradesState.schemaVersion = 2;
    tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
    tradesState.records = [];
    tradesState.quarantinedRecords = [];
    tradesState.portfolio = ${JSON.stringify(emptyPortfolio())};
    tradesState.loaded = true;
    tradesState.mutating = false;
    tradesHistoryLimit = 40;
    tradesEditingId = "";
    state.watchList = "hold";
    stocks.length = 0;
    document.activeElement?.blur?.();
    renderHoldingsPanel();
  `);
});

test("v2 表單：英數 ETF 代號正規化，商品與券商實際 0 元無損送出", async () => {
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.code.value = "00725b";
      form.elements.instrumentType.value = "bondIndexEtf";
      form.elements.price.value = "30";
      form.elements.shares.value = "1000";
      form.elements.feeAmountTwd.value = "0";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(2);
  assert.ok(lastPutBody, "應送出 PUT");
  assert.equal(lastPutBody.schemaVersion, 2);
  const record = lastPutBody.records.at(-1);
  assert.equal(record.code, "00725B");
  assert.equal(record.instrumentType, "bondIndexEtf");
  assert.equal(record.instrumentSource, "user");
  assert.equal(record.feeAmountTwd, 0);
  assert.equal(record.feeSource, "broker");
  assert.equal(Object.hasOwn(record, "kind"), false, "新表單不再以 kind 混合商品與當沖");
  assert.deepEqual(record.dayTrade, { status: "none", matchedShares: 0, pairId: "" });
});

test("v2 表單：股票商品與部分當沖分開保存，實際 0 元證交稅仍保留", async () => {
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.code.value = "2330";
      form.elements.side.value = "sell";
      form.elements.side.dispatchEvent(new Event("change", { bubbles: true }));
      form.elements.instrumentType.value = "stock";
      form.elements.dayTradeStatus.value = "brokerConfirmed";
      form.elements.dayTradeStatus.dispatchEvent(new Event("change", { bubbles: true }));
      form.elements.price.value = "100";
      form.elements.shares.value = "1000";
      form.elements.matchedShares.value = "400";
      form.elements.taxAmountTwd.value = "0";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(2);
  const record = lastPutBody.records.at(-1);
  assert.equal(record.instrumentType, "stock");
  assert.deepEqual(record.dayTrade, { status: "brokerConfirmed", matchedShares: 400, pairId: "" });
  assert.equal(record.taxAmountTwd, 0);
  assert.equal(record.taxSource, "broker");
});

test("v2 表單：配對股數超過成交股數時前端攔截，不送 PUT", async () => {
  const putsBefore = app.fetchLog.filter((entry) => entry.path === "/api/trades" && entry.method === "PUT").length;
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.code.value = "2330";
      form.elements.side.value = "sell";
      form.elements.side.dispatchEvent(new Event("change", { bubbles: true }));
      form.elements.dayTradeStatus.value = "brokerConfirmed";
      form.elements.dayTradeStatus.dispatchEvent(new Event("change", { bubbles: true }));
      form.elements.price.value = "100";
      form.elements.shares.value = "1000";
      form.elements.matchedShares.value = "1001";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(1);
  const putsAfter = app.fetchLog.filter((entry) => entry.path === "/api/trades" && entry.method === "PUT").length;
  assert.equal(putsAfter, putsBefore);
  assert.match(app.evalIn(`document.querySelector("#toastStack .toast:last-child")?.textContent || ""`), /配對股數/);
});

test("v2 紀錄 render：商品、當沖股數、0 元費稅來源與待覆核都可見", () => {
  app.evalIn(`
    tradesState.records = [{
      id: "v2-render", code: "2330", side: "sell", tradeDate: "20260710", price: 100, shares: 1000,
      instrumentType: "stock", instrumentSource: "legacy",
      dayTrade: { status: "brokerConfirmed", matchedShares: 400, pairId: "p1" },
      feeAmountTwd: 0, fee: 0, feeSource: "broker",
      taxAmountTwd: 0, tax: 0, taxSource: "broker", taxRuleId: "manual-override",
      reviewStatus: "needsReview", reviewReasons: ["測試待覆核"]
    }];
    tradesState.quarantinedRecords = [{ index: 0, reasons: ["壞資料"], record: { id: "bad" } }];
    renderHoldingsPanel();
  `);
  const text = app.evalIn(`el.holdingsPanel.textContent`).replace(/\s+/g, " ");
  assert.match(text, /股票/);
  assert.match(text, /當沖 400 股/);
  assert.match(text, /手續費 0實/);
  assert.match(text, /證交稅 0實/);
  assert.match(text, /待覆核/);
  assert.match(text, /1 筆舊資料待整理/);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelectorAll('[data-trade-cost-source]').length`), 2);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[data-trade-review-status]').title`), "測試待覆核");
});

test("v1 render adapter：舊 fee/tax 不重算，來源明示為舊資料", () => {
  app.evalIn(`
    tradesState.records = [{
      id: "legacy-render", code: "0050", side: "sell", kind: "etf", date: "20260710",
      price: 100, shares: 1000, fee: 86, tax: 100
    }];
    renderHoldingsPanel();
  `);
  const text = app.evalIn(`el.holdingsPanel.textContent`).replace(/\s+/g, " ");
  assert.match(text, /舊 ETF/);
  assert.match(text, /手續費 86舊/);
  assert.match(text, /證交稅 100舊/);
});

test("切換股利會隱藏進階交易欄；切回賣出才開放實際稅與股票當沖", () => {
  const state = JSON.parse(app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.side.value = "dividend";
      form.elements.side.dispatchEvent(new Event("change", { bubbles: true }));
      const dividend = {
        actualsHidden: form.querySelector('[data-trade-actuals]').hidden,
        productDisabled: form.elements.instrumentType.disabled,
        receivedRequired: form.elements.receivedAmount.required
      };
      form.elements.side.value = "sell";
      form.elements.side.dispatchEvent(new Event("change", { bubbles: true }));
      return JSON.stringify({ dividend, sell: {
        actualsHidden: form.querySelector('[data-trade-actuals]').hidden,
        taxDisabled: form.elements.taxAmountTwd.disabled,
        dayTradeDisabled: form.elements.dayTradeStatus.disabled
      }});
    })()
  `));
  assert.deepEqual(state.dividend, { actualsHidden: true, productDisabled: true, receivedRequired: true });
  assert.deepEqual(state.sell, { actualsHidden: false, taxDisabled: false, dayTradeDisabled: false });
});

test("超過 40 筆可逐批顯示，不再形成無法操作的永久截斷", () => {
  const records = Array.from({ length: 45 }, (_, index) => ({
    id: `row-${index}`,
    code: "2330",
    side: "buy",
    date: "20260701",
    price: 100,
    shares: 1,
    fee: 0,
    tax: 0,
  }));
  app.evalIn(`tradesState.records = ${JSON.stringify(records)}; el.holdingsPanel.replaceChildren(); renderHoldingsPanel();`);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelectorAll('.trade-row').length`), 40);
  assert.equal(app.evalIn(`!!el.holdingsPanel.querySelector('[data-trade-load-more]')`), true);
  app.evalIn(`el.holdingsPanel.querySelector('[data-trade-load-more]').click()`);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelectorAll('.trade-row').length`), 45);
  assert.equal(app.evalIn(`!!el.holdingsPanel.querySelector('[data-trade-load-more]')`), false);
});

test("一般交易修正：完整帶入 v2 欄位，儲存後保留 id、createdAt 與未變動的配對識別", async () => {
  const record = {
    id: "edit-v2",
    code: "2330",
    market: "TWSE",
    instrumentType: "stock",
    instrumentSource: "official",
    side: "sell",
    date: "20260710",
    tradeDate: "20260710",
    executedAt: "2026-07-10T10:30:15+08:00",
    session: "regular",
    brokerAccountId: "account-a",
    currency: "TWD",
    price: 100,
    shares: 1000,
    dayTrade: { status: "userConfirmed", matchedShares: 400, pairId: "pair-1" },
    fee: 86,
    feeAmountTwd: 86,
    feeSource: "broker",
    feeRuleId: "broker-frozen",
    tax: 240,
    taxAmountTwd: 240,
    taxSource: "manual",
    taxRuleId: "manual-override",
    reviewStatus: "needsReview",
    reviewReasons: ["待核"],
    createdAt: "2026-07-10T11:00:00.000Z",
  };
  app.evalIn(`tradesState.records = ${JSON.stringify([record])}; renderHoldingsPanel(); el.holdingsPanel.querySelector('[data-trade-edit]').click();`);
  const populated = JSON.parse(app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      return JSON.stringify({
        editingId: form.dataset.editingId,
        product: form.elements.instrumentType.value,
        dayTradeStatus: form.elements.dayTradeStatus.value,
        matchedShares: form.elements.matchedShares.value,
        matchedDisabled: form.elements.matchedShares.disabled,
        fee: form.elements.feeAmountTwd.value,
        tax: form.elements.taxAmountTwd.value,
        time: form.elements.executedTime.value,
        actualsOpen: form.querySelector('[data-trade-actuals]').open,
      });
    })()
  `));
  assert.deepEqual(populated, {
    editingId: "edit-v2",
    product: "stock",
    dayTradeStatus: "userConfirmed",
    matchedShares: "400",
    matchedDisabled: false,
    fee: "86",
    tax: "240",
    time: "10:30:15",
    actualsOpen: true,
  });

  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.feeAmountTwd.value = "90";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(3);
  assert.equal(lastPutBody.records.length, 1, "修正不能新增複本");
  const saved = lastPutBody.records[0];
  assert.equal(saved.id, record.id);
  assert.equal(saved.createdAt, record.createdAt);
  assert.equal(saved.instrumentSource, "official");
  assert.equal(saved.brokerAccountId, "account-a");
  assert.deepEqual(saved.dayTrade, { status: "userConfirmed", matchedShares: 400, pairId: "pair-1" });
  assert.equal(saved.feeAmountTwd, 90);
  assert.equal(saved.feeSource, "broker");
  assert.equal(saved.taxAmountTwd, 240);
  assert.equal(saved.taxSource, "manual");
  assert.equal(Object.hasOwn(saved, "reviewStatus"), false);
  assert.equal(app.evalIn(`tradesEditingId`), "");
});

test("一般交易修正：清空非 legacy 實際費稅會完整移除 override，讓後端重新估算", async () => {
  const record = {
    id: "edit-estimate",
    code: "2330",
    market: "TWSE",
    instrumentType: "stock",
    instrumentSource: "user",
    side: "sell",
    date: "20260710",
    tradeDate: "20260710",
    session: "regular",
    price: 100,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    fee: 86,
    feeAmountTwd: 86,
    feeSource: "estimated",
    feeRuleId: "old-estimate",
    tax: 300,
    taxAmountTwd: 300,
    taxSource: "estimated",
    taxRuleId: "old-tax-rule",
    createdAt: "2026-07-10T11:00:00.000Z",
  };
  app.evalIn(`tradesState.records = ${JSON.stringify([record])}; renderHoldingsPanel(); el.holdingsPanel.querySelector('[data-trade-edit]').click();`);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[data-trade-form]').elements.feeAmountTwd.value`), "");
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[data-trade-form]').elements.taxAmountTwd.value`), "");
  app.evalIn(`el.holdingsPanel.querySelector('[data-trade-form]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))`);
  await app.settle(3);
  const saved = lastPutBody.records[0];
  for (const key of ["fee", "feeAmountTwd", "feeSource", "feeRuleId", "tax", "taxAmountTwd", "taxSource", "taxRuleId"]) {
    assert.equal(Object.hasOwn(saved, key), false, `${key} 應從 request 移除`);
  }
});

test("一般交易修正：舊 ETF 不會誤改成股票；變更配對條件會清除 pairId", async () => {
  const record = {
    id: "edit-legacy-etf",
    code: "0050",
    instrumentType: "unknownEtf",
    instrumentSource: "legacy",
    side: "buy",
    date: "20260710",
    tradeDate: "20260710",
    session: "regular",
    price: 50,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "stale-pair" },
    fee: 20,
    feeAmountTwd: 20,
    feeSource: "legacy",
    tax: 0,
    taxAmountTwd: 0,
    taxSource: "legacy",
    createdAt: "2026-07-10T11:00:00.000Z",
  };
  app.evalIn(`tradesState.records = ${JSON.stringify([record])}; renderHoldingsPanel(); el.holdingsPanel.querySelector('[data-trade-edit]').click();`);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[data-trade-form]').elements.instrumentType.value`), "unknownEtf");
  app.evalIn(`el.holdingsPanel.querySelector('[data-trade-form]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))`);
  await app.settle(3);
  assert.equal(lastPutBody.records[0].instrumentType, "unknownEtf");
  assert.equal(lastPutBody.records[0].dayTrade.pairId, "");
});

test("取消一般交易修正只還原表單，不送 PUT", async () => {
  const record = {
    id: "edit-cancel",
    code: "2330",
    instrumentType: "stock",
    side: "buy",
    date: "20260710",
    tradeDate: "20260710",
    session: "regular",
    price: 100,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    fee: 86,
    feeSource: "estimated",
    tax: 0,
    taxSource: "estimated",
    createdAt: "2026-07-10T11:00:00.000Z",
  };
  const putsBefore = app.fetchLog.filter((entry) => entry.path === "/api/trades" && entry.method === "PUT").length;
  app.evalIn(`tradesState.records = ${JSON.stringify([record])}; renderHoldingsPanel(); el.holdingsPanel.querySelector('[data-trade-edit]').click(); el.holdingsPanel.querySelector('[data-trade-edit-cancel]').click();`);
  await app.settle(1);
  const putsAfter = app.fetchLog.filter((entry) => entry.path === "/api/trades" && entry.method === "PUT").length;
  assert.equal(putsAfter, putsBefore);
  assert.equal(app.evalIn(`tradesEditingId`), "");
  assert.equal(app.evalIn(`!!el.holdingsPanel.querySelector('[data-trade-edit-cancel]')`), false);
});
