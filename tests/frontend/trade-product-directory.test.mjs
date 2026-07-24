import test from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const emptyPortfolio = () => ({
  ok: true,
  holdings: [],
  realized: [],
  totals: { cost: 0, realizedPnl: 0, dividendIncome: 0 },
});

const emptyTrades = () => ({
  ok: true,
  schemaVersion: 2,
  rev: 1,
  settings: { feeDiscount: 0.6, minFee: 20 },
  records: [],
  quarantinedRecords: [],
  portfolio: emptyPortfolio(),
});

function officialResponse({
  code,
  instrumentType,
  market = "TWSE",
  instrumentAsOf = "20260712",
}) {
  return {
    ok: true,
    code,
    status: "official",
    profile: {
      code,
      name: `官方商品 ${code}`,
      market,
      instrumentType,
      instrumentSource: "official",
      instrumentRuleId: "official-product-directory-v1:test",
      instrumentAsOf,
    },
    warnings: [],
    dataQuality: { degraded: false },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createTradeApp(t, instrumentRoute) {
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/trades": emptyTrades(),
      "/api/instrument-profile": instrumentRoute,
    },
  });
  t.after(() => app.cleanup());
  app.evalIn(`
    tradesState.schemaVersion = 2;
    tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
    tradesState.records = [];
    tradesState.quarantinedRecords = [];
    tradesState.portfolio = ${JSON.stringify(emptyPortfolio())};
    tradesState.loaded = true;
    tradesState.mutating = false;
    tradesEditingId = "";
    tradesHistoryLimit = 40;
    state.watchList = "hold";
    state.selectedCode = "";
    stocks.length = 0;
    renderHoldingsPanel();
  `);
  return app;
}

function changeCode(app, code) {
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.code.value = ${JSON.stringify(code)};
      form.elements.code.dispatchEvent(new Event("change", { bubbles: true }));
    })();
  `);
}

function changeInstrument(app, instrumentType) {
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.instrumentType.value = ${JSON.stringify(instrumentType)};
      form.elements.instrumentType.dispatchEvent(new Event("change", { bubbles: true }));
    })();
  `);
}

function formSnapshot(app) {
  return JSON.parse(app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      const status = form.querySelector('[data-trade-product-status]');
      return JSON.stringify({
        code: form.elements.code.value,
        instrumentType: form.elements.instrumentType.value,
        userEditVersion: form.dataset.productUserEditVersion || "0",
        statusText: status.textContent,
        statusTone: status.dataset.tone,
      });
    })()
  `));
}

function instrumentProfileCalls(app) {
  return app.fetchLog.filter((entry) => entry.path.startsWith("/api/instrument-profile?"));
}

test("代號變更會查官方分類、自動帶入商品並顯示市場與資料日", async (t) => {
  const app = await createTradeApp(t, (raw) => {
    const code = new URL(raw, "http://127.0.0.1").searchParams.get("code");
    return officialResponse({ code, instrumentType: "bondIndexEtf", market: "TPEx", instrumentAsOf: "20260712" });
  });

  changeCode(app, "00725b");
  await app.settle(2);

  const form = formSnapshot(app);
  assert.equal(instrumentProfileCalls(app).length, 1);
  assert.match(instrumentProfileCalls(app)[0].path, /code=00725B$/);
  assert.equal(form.code, "00725B");
  assert.equal(form.instrumentType, "bondIndexEtf");
  assert.equal(form.statusTone, "official");
  assert.match(form.statusText, /官方主檔：債券指數 ETF/);
  assert.match(form.statusText, /上櫃/);
  assert.match(form.statusText, /資料日 2026\/07\/12/);
});

test("較晚完成的舊代號回應不能污染目前代號", async (t) => {
  const pending = new Map();
  const app = await createTradeApp(t, (raw) => {
    const code = new URL(raw, "http://127.0.0.1").searchParams.get("code");
    const request = deferred();
    pending.set(code, request);
    return request.promise;
  });

  changeCode(app, "0050");
  changeCode(app, "00725B");
  await app.settle(1);
  assert.equal(pending.size, 2);

  pending.get("00725B").resolve(officialResponse({
    code: "00725B",
    instrumentType: "bondIndexEtf",
    market: "TPEx",
  }));
  await app.settle(1);
  assert.equal(formSnapshot(app).instrumentType, "bondIndexEtf");

  pending.get("0050").resolve(officialResponse({
    code: "0050",
    instrumentType: "equityEtf",
    market: "TWSE",
  }));
  await app.settle(1);

  const form = formSnapshot(app);
  assert.equal(form.code, "00725B");
  assert.equal(form.instrumentType, "bondIndexEtf");
  assert.match(form.statusText, /債券指數 ETF/);
  assert.match(form.statusText, /上櫃/);
  assert.doesNotMatch(form.statusText, /股票 ETF/);
});

test("查詢途中手動修改商品後，官方回應只提示而不能覆寫選擇", async (t) => {
  const request = deferred();
  const app = await createTradeApp(t, () => request.promise);

  changeCode(app, "00980A");
  await app.settle(1);
  changeInstrument(app, "bondIndexEtf");
  request.resolve(officialResponse({
    code: "00980A",
    instrumentType: "activeEtf",
    market: "TWSE",
  }));
  await app.settle(2);

  const form = formSnapshot(app);
  assert.equal(form.instrumentType, "bondIndexEtf", "使用者手動選擇的商品類型優先");
  assert.equal(form.userEditVersion, "1");
  assert.equal(form.statusTone, "official");
  assert.match(form.statusText, /主動式 ETF/, "仍應顯示官方建議供使用者比較");
});

test("官方主檔 unresolved／degraded 時顯示待覆核，且不能默認成股票", async (t) => {
  const app = await createTradeApp(t, (raw) => ({
    ok: true,
    code: new URL(raw, "http://127.0.0.1").searchParams.get("code"),
    status: "unresolved",
    profile: null,
    warnings: ["TPEx 暫時無法取得"],
    dataQuality: { degraded: true },
  }));

  changeCode(app, "1234");
  await app.settle(2);

  const form = formSnapshot(app);
  assert.equal(form.statusTone, "review");
  assert.match(form.statusText, /主檔目前不完整/);
  assert.match(form.statusText, /待覆核/);
  assert.notEqual(form.instrumentType, "stock", "查無可信分類時不可靜默套用股票稅則");
});

test("編輯既有交易且代號未變時不重新查詢官方主檔", async (t) => {
  let routeCalls = 0;
  const app = await createTradeApp(t, () => {
    routeCalls += 1;
    return officialResponse({ code: "00725B", instrumentType: "bondIndexEtf", market: "TWSE" });
  });
  const record = {
    id: "edit-product",
    code: "00725B",
    market: "TWSE",
    instrumentType: "bondIndexEtf",
    instrumentSource: "official",
    instrumentRuleId: "official-product-directory-v1:test",
    instrumentAsOf: "20260712",
    side: "buy",
    date: "20260710",
    tradeDate: "20260710",
    session: "regular",
    price: 30,
    shares: 1000,
    dayTrade: { status: "none", matchedShares: 0, pairId: "" },
    fee: 20,
    feeAmountTwd: 20,
    feeSource: "estimated",
    tax: 0,
    taxAmountTwd: 0,
    taxSource: "estimated",
    createdAt: "2026-07-10T11:00:00.000Z",
  };

  app.evalIn(`
    tradesState.records = ${JSON.stringify([record])};
    renderHoldingsPanel();
    el.holdingsPanel.querySelector('[data-trade-edit="edit-product"]').click();
    const form = el.holdingsPanel.querySelector('[data-trade-form]');
    form.elements.code.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  await app.settle(2);

  const form = formSnapshot(app);
  assert.equal(routeCalls, 0);
  assert.equal(instrumentProfileCalls(app).length, 0);
  assert.equal(form.instrumentType, "bondIndexEtf");
  assert.equal(form.statusTone, "official");
  assert.match(form.statusText, /已保存的官方分類/);
  assert.match(form.statusText, /未更換代號時不重新改寫歷史分類/);
});
