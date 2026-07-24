// 現金股利前端契約：官方事件先記應收，待實際匯款後以原紀錄確認入帳，摘要分開呈現認列、待收與實收。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const todayCompact = compactToday();
const todayIso = `${todayCompact.slice(0, 4)}-${todayCompact.slice(4, 6)}-${todayCompact.slice(6, 8)}`;
const eventId = `cash-dividend:TWSE:2330:${todayCompact}`;
const recordId = `div:TWSE:2330:${todayCompact}`;
const putBodies = [];

function dividendTotals(records) {
  const dividends = records.filter((record) => record.side === "dividend");
  const recognizedGross = dividends.reduce((sum, record) => sum + Number(record.price) * Number(record.shares), 0);
  const receivableGross = dividends
    .filter((record) => record.status === "receivable")
    .reduce((sum, record) => sum + Number(record.price) * Number(record.shares), 0);
  const receivedNet = dividends
    .filter((record) => record.status === "received")
    .reduce((sum, record) => sum + Number(record.receivedAmount), 0);
  return {
    cost: 0,
    realizedPnl: 0,
    dividendRecognizedGross: recognizedGross,
    dividendReceivableGross: receivableGross,
    dividendReceivedNet: receivedNet,
  };
}

const tradesRoute = async (_raw, init) => {
  if ((init?.method || "GET") !== "PUT") {
    return {
      ok: true,
      rev: 1,
      settings: { feeDiscount: 0.6, minFee: 20 },
      records: [],
      portfolio: { ok: true, holdings: [], realized: [], totals: dividendTotals([]) },
    };
  }
  const body = JSON.parse(init.body);
  putBodies.push(body);
  return {
    ok: true,
    rev: Number(body.rev || 0) + 1,
    settings: body.settings,
    records: body.records,
    portfolio: { ok: true, holdings: [], realized: [], totals: dividendTotals(body.records) },
  };
};

const app = await createAppWindow({ fetchRoutes: { "/api/trades": tradesRoute } });
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

function seed({ records = [], totals = dividendTotals(records), holdings = [] } = {}) {
  app.evalIn(`
    tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
    tradesState.records = ${JSON.stringify(records)};
    tradesState.portfolio = ${JSON.stringify({ ok: true, holdings, realized: [], totals })};
    tradesState.loaded = true;
    tradesState.rev = 1;
    tradesState.mutating = false;
    stocks.length = 0;
    stocks.push({
      code: "2330", name: "台積電", exchange: "TWSE", price: 100,
      groups: [], strategies: [], spark: [],
      dividend: {
        exDate: ${JSON.stringify(todayIso)}, kind: "除息", cash: 3,
        stockRatio: 0, isToday: true, daysUntil: 0
      }
    });
    state.watchList = "hold";
    renderHoldingsPanel();
  `);
}

test("官方除息快速鈕明示『記應收股利』，送出的新紀錄為 receivable", async () => {
  putBodies.length = 0;
  seed({
    records: [
      { id: "buy-1", code: "2330", side: "buy", kind: "stock", date: compactToday(-2), price: 100, shares: 1000, fee: 86, tax: 0 },
    ],
    holdings: [{ code: "2330", shares: 1000, avgCost: 100.086, cost: 100086 }],
  });

  const quickText = app.evalIn(`el.holdingsPanel.querySelector('[data-dividend-quick]').textContent`).replace(/\s+/g, " ").trim();
  assert.equal(quickText, "記應收股利 · 1,000 股");
  app.evalIn(`el.holdingsPanel.querySelector('[data-dividend-quick]').click()`);
  await app.settle(3);

  assert.equal(putBodies.length, 1, "快速鈕只可送出一次帳本 PUT");
  const dividend = putBodies[0].records.find((record) => record.side === "dividend");
  assert.ok(dividend, "PUT 應包含官方股利紀錄");
  assert.equal(dividend.status, "receivable", "除息日只認列應收，不可假裝已匯入銀行");
  assert.equal(dividend.id, recordId);
  assert.equal(dividend.eventId, eventId);
  assert.equal(dividend.source, "official-event");
});

test("待入帳紀錄顯示狀態與確認表單；入帳日不得超過台北今天，並提供實收金額欄位", () => {
  seed({
    records: [{
      id: recordId, eventId, code: "2330", side: "dividend", status: "receivable",
      date: todayCompact, exDate: todayCompact, price: 3, shares: 1000, fee: 0, tax: 0,
      entitledShares: 1000, source: "official-event",
    }],
  });

  const status = app.evalIn(`el.holdingsPanel.querySelector('[data-dividend-status="receivable"]')?.textContent || ""`).trim();
  assert.match(status, /待入帳/);
  assert.equal(json(`el.holdingsPanel.querySelectorAll('[data-dividend-receive-form]').length`), 1);
  assert.equal(app.evalIn(`el.holdingsPanel.querySelector('[data-dividend-receive-form] [name="receivedDate"]').max`), todayIso);
  const amount = json(`(() => {
    const input = el.holdingsPanel.querySelector('[data-dividend-receive-form] [name="receivedAmount"]');
    return { type: input?.type, step: input?.step, min: input?.min, value: input?.value, label: input?.getAttribute('aria-label'), placeholder: input?.placeholder };
  })()`);
  assert.equal(amount.type, "number");
  assert.equal(amount.step, "0.01");
  assert.equal(amount.min, "0");
  assert.equal(amount.value, "", "實收金額不可預填認列毛額，必須由使用者依銀行入帳主動確認");
  assert.match(`${amount.label || ""} ${amount.placeholder || ""}`, /實收金額/);
  assert.equal(json(`!!el.holdingsPanel.querySelector('[data-dividend-receive]')`), true, "確認入帳要有明確的提交動作");
});

test("確認入帳更新原紀錄：保持 id/eventId，PUT 後狀態改為 received 並記錄實收資訊", async () => {
  putBodies.length = 0;
  seed({
    records: [
      { id: "buy-1", code: "2330", side: "buy", kind: "stock", date: compactToday(-2), price: 100, shares: 1000, fee: 86, tax: 0 },
      {
        id: recordId, eventId, code: "2330", side: "dividend", status: "receivable",
        date: todayCompact, exDate: todayCompact, price: 3, shares: 1000, fee: 0, tax: 0,
        entitledShares: 1000, source: "official-event",
      },
    ],
  });

  assert.equal(json(`!!el.holdingsPanel.querySelector('[data-dividend-receive-form]')`), true, "待入帳紀錄必須先顯示確認入帳表單");
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-dividend-receive-form]');
      form.elements.receivedDate.value = ${JSON.stringify(todayIso)};
      form.elements.receivedAmount.value = "2985.5";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(3);

  assert.equal(putBodies.length, 1);
  assert.equal(putBodies[0].records.length, 2, "確認入帳不可新增第二筆股利事件");
  const updated = putBodies[0].records.find((record) => record.id === recordId);
  assert.ok(updated);
  assert.equal(updated.id, recordId);
  assert.equal(updated.eventId, eventId);
  assert.equal(updated.status, "received");
  assert.equal(updated.receivedDate.replaceAll("-", ""), todayCompact);
  assert.equal(updated.receivedAmount, 2985.5);
  assert.equal(json(`tradesState.records.find((record) => record.id === ${JSON.stringify(recordId)}).status`), "received");
  const receivedStatus = app.evalIn(`el.holdingsPanel.querySelector('[data-dividend-status="received"]')`);
  assert.match(receivedStatus?.textContent.trim() || "", /已入帳/);
  const receivedText = receivedStatus?.closest(".trade-row")?.textContent.replace(/\s+/g, " ").trim() || "";
  assert.match(receivedText, new RegExp(`入帳日?\\s*${todayIso.slice(5).replace("-", "/")}`), "已入帳列要顯示實際入帳日，不可只顯示認列日");
  assert.match(receivedText, /實收(?:金額|淨額)\s*\+?2,985\.50/, "已入帳列要明示實收金額，並保留後端接受的兩位小數");
});

test("已入帳紀錄提供修正動作，重送時保持同一筆 id/eventId", async () => {
  putBodies.length = 0;
  const receivedDate = compactToday(-1);
  const receivedIso = `${receivedDate.slice(0, 4)}-${receivedDate.slice(4, 6)}-${receivedDate.slice(6, 8)}`;
  seed({
    records: [{
      id: recordId, eventId, code: "2330", side: "dividend", status: "received",
      date: compactToday(-2), exDate: compactToday(-2), price: 3, shares: 1000, fee: null, tax: 0,
      receivedDate, receivedAmount: 2985.5, entitledShares: 1000, source: "official-event",
    }],
  });

  const editButton = app.evalIn(`el.holdingsPanel.querySelector('.dividend-correction > summary')`);
  assert.ok(editButton, "已入帳紀錄要有可辨識的修正入帳動作");
  assert.match(`${editButton.textContent} ${editButton.getAttribute("aria-label") || ""}`, /修正.*入帳|入帳.*修正/);
  editButton.click();

  const current = json(`(() => {
    const form = el.holdingsPanel.querySelector('[data-dividend-receive-form]');
    return {
      exists: Boolean(form),
      date: form?.elements.receivedDate?.value,
      amount: form?.elements.receivedAmount?.value,
    };
  })()`);
  assert.equal(current.exists, true);
  assert.equal(current.date, receivedIso, "修正表單要帶入原入帳日");
  assert.equal(current.amount, "2985.5", "修正表單要帶入原實收金額");

  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-dividend-receive-form]');
      form.elements.receivedDate.value = ${JSON.stringify(todayIso)};
      form.elements.receivedAmount.value = "2975.25";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(3);

  assert.equal(putBodies.length, 1);
  assert.equal(putBodies[0].records.length, 1, "修正不可新增第二筆股利事件");
  const updated = putBodies[0].records[0];
  assert.equal(updated.id, recordId);
  assert.equal(updated.eventId, eventId);
  assert.equal(updated.status, "received");
  assert.equal(updated.receivedDate.replaceAll("-", ""), todayCompact);
  assert.equal(updated.receivedAmount, 2975.25);
});

test("股利摘要分開顯示已認列毛額、待入帳與已入帳淨額", () => {
  seed({
    records: [
      { id: "d1", code: "2330", side: "dividend", status: "receivable", date: todayCompact, price: 3, shares: 1000, fee: 0, tax: 0 },
      { id: "d2", code: "2330", side: "dividend", status: "received", date: compactToday(-10), price: 5.5, shares: 1000, fee: 0, tax: 0, receivedDate: compactToday(-1), receivedAmount: 5475 },
    ],
    totals: {
      cost: 0,
      realizedPnl: 0,
      dividendRecognizedGross: 8500,
      dividendReceivableGross: 3000,
      dividendReceivedNet: 5475,
    },
  });

  const summary = json(`Object.fromEntries([...el.holdingsPanel.querySelectorAll('[data-dividend-summary]')].map((node) => [node.dataset.dividendSummary, node.textContent.replace(/\\s+/g, " ").trim()]))`);
  assert.deepEqual(Object.keys(summary).sort(), ["receivable", "received", "recognized"], "三種股利金額要有各自可辨識的摘要節點");
  assert.match(summary.recognized, /已認列毛額/);
  assert.match(summary.recognized, /8,500/);
  assert.match(summary.receivable, /待入帳/);
  assert.match(summary.receivable, /3,000/);
  assert.match(summary.received, /已入帳淨額/);
  assert.match(summary.received, /5,475/);
});

test("手動新增的股利選項明示為已入帳，避免與官方應收混淆", () => {
  seed();
  const option = app.evalIn(`el.holdingsPanel.querySelector('[name="side"] option[value="dividend"]').textContent`).replace(/\s+/g, " ").trim();
  assert.equal(option, "股利（已入帳）");
});

test("手動股利切換後要求實收總額，PUT 不可再用固定匯費猜淨額", async () => {
  putBodies.length = 0;
  seed();
  app.evalIn(`
    (() => {
      const form = el.holdingsPanel.querySelector('[data-trade-form]');
      form.elements.side.value = "dividend";
      form.elements.side.dispatchEvent(new Event("change", { bubbles: true }));
      form.elements.code.value = "2330";
      form.elements.price.value = "3.123456";
      form.elements.shares.value = "1000";
      form.elements.receivedAmount.value = "3108.75";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })();
  `);
  await app.settle(3);

  assert.equal(putBodies.length, 1);
  const dividend = putBodies[0].records.find((record) => record.side === "dividend");
  assert.equal(dividend.status, "received");
  assert.equal(dividend.receivedAmount, 3108.75);
  assert.equal(dividend.receivedDate.replaceAll("-", ""), todayCompact);
  assert.equal(dividend.fee, null, "有實收總額時不應再虛構固定匯費");
});

test("確認入帳遇 409 後原紀錄已被其他分頁刪除：不可再送 no-op PUT，也不可回報成功", async (t) => {
  let putCalls = 0;
  const retryBodies = [];
  const deletedRoute = (_raw, init) => {
    const method = init?.method || "GET";
    if (method === "PUT") {
      putCalls += 1;
      retryBodies.push(JSON.parse(init.body));
      if (putCalls === 1) return { ok: false, error: "交易紀錄已在其他分頁更新", __status: 409 };
      return {
        ok: true,
        rev: 3,
        settings: { feeDiscount: 0.6, minFee: 20 },
        records: [],
        portfolio: { ok: true, holdings: [], realized: [], totals: dividendTotals([]) },
      };
    }
    return {
      ok: true,
      rev: 2,
      settings: { feeDiscount: 0.6, minFee: 20 },
      records: [],
      portfolio: { ok: true, holdings: [], realized: [], totals: dividendTotals([]) },
    };
  };
  const raced = await createAppWindow({ fetchRoutes: { "/api/trades": deletedRoute } });
  t.after(() => raced.cleanup());
  raced.evalIn(`
    tradesState.settings = { feeDiscount: 0.6, minFee: 20 };
    tradesState.records = [{
      id: ${JSON.stringify(recordId)}, eventId: ${JSON.stringify(eventId)}, code: "2330",
      side: "dividend", status: "receivable", date: ${JSON.stringify(compactToday(-2))},
      exDate: ${JSON.stringify(compactToday(-2))}, price: 3, shares: 1000, fee: null, tax: 0,
      source: "official-event"
    }];
    tradesState.portfolio = { ok: true, holdings: [], realized: [], totals: {} };
    tradesState.loaded = true;
    tradesState.rev = 1;
  `);

  const result = await raced.evalIn(`updateTradeRecord(${JSON.stringify(recordId)}, {
    status: "received", receivedDate: ${JSON.stringify(todayIso)}, receivedAmount: 2985.5
  })`);

  assert.equal(result, false, "最新帳本已無原紀錄時，確認入帳必須明確失敗");
  assert.equal(putCalls, 1, "取得最新帳本發現紀錄已刪除後，不可再送第二個 no-op PUT");
  assert.equal(retryBodies[0].records.length, 1, "第一個衝突請求仍應是原本要更新的帳本");
  assert.equal(JSON.parse(raced.evalIn(`JSON.stringify(tradesState.records.length)`)), 0, "前端要保留其他分頁的最新刪除結果");
  const toast = raced.evalIn(`document.querySelector('#toastStack .toast:last-child')?.textContent || ""`);
  assert.doesNotMatch(toast, /股利已確認入帳/, "不可向使用者誤報成功");
});
