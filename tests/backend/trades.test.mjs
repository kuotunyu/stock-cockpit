// 持股損益引擎（Phase B）：手續費/證交稅、紀錄清洗排序、加權平均成本、已實現損益、賣超防護。
// 全部手算對數字（fee=round(價金×0.1425%×折數) 最低 20；稅=floor(價金×0.3%)）。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer({ routes: [] })); // 純函式，不打網路
});

const SETTINGS = { feeDiscount: 0.6, minFee: 20 };

function validTrade(overrides = {}) {
  return {
    id: "trade-1",
    code: "2330",
    side: "buy",
    kind: "stock",
    date: compactToday(-1),
    price: 100,
    shares: 1000,
    ...overrides,
  };
}

function assertValidationError(payload, expectedPattern, today = compactToday()) {
  const result = mod.validateTradesMutationInput(payload, today);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, "失敗時應回 errors 陣列");
  assert.match(JSON.stringify(result.errors), expectedPattern);
  return result;
}

test("computeTradeFee / computeTradeTax：折數、最低手續費、無條件捨去的稅", () => {
  // 100 萬價金 × 0.001425 × 0.6 = 855
  assert.equal(mod.computeTradeFee(1000, 1000, SETTINGS), 855);
  // 小單：算出來 8.55 → 最低 20
  assert.equal(mod.computeTradeFee(10, 1000, SETTINGS), 20);
  // 稅：55,000 × 0.003 = 165（floor）
  assert.equal(mod.computeTradeTax(110, 500), 165);
  assert.equal(mod.computeTradeTax(33.33, 100), Math.floor(33.33 * 100 * 0.003));
});

test("computeTradeTax：交易類型費率——ETF 0.1%、現股當沖 0.15%、未知類型退回 0.3%", () => {
  // 55,000 價金：一般 165、ETF 55、當沖 82（floor(82.5)）
  assert.equal(mod.computeTradeTax(110, 500, "stock"), 165);
  assert.equal(mod.computeTradeTax(110, 500, "etf"), 55);
  assert.equal(mod.computeTradeTax(110, 500, "dayTrade"), 82);
  assert.equal(mod.computeTradeTax(110, 500, "whatever"), 165);
});

test("normalizeTradesPayload：合法 kind 保留、賣出稅依 kind 自動計算，未知 kind 跳過", () => {
  const { records } = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "k1", code: "0050", side: "buy", kind: "etf", date: "2026-06-10", price: 100, shares: 1000 },
      { id: "k2", code: "0050", side: "sell", kind: "etf", date: "2026-06-20", price: 110, shares: 1000 },
      { id: "k3", code: "2330", side: "sell", kind: "bogus", date: "2026-06-21", price: 110, shares: 500 },
    ],
  });
  assert.equal(records.find((r) => r.id === "k1").kind, "etf");
  assert.equal(records.find((r) => r.id === "k2").tax, Math.floor(110 * 1000 * 0.001), "ETF 賣出稅 0.1%");
  assert.equal(records.find((r) => r.id === "k3"), undefined, "舊資料的未知類型不得偽裝成一般股票");
});

test("normalizeTradesPayload：舊資料遇未知 side/kind、無效或未來日期、非整數股數皆跳過", () => {
  const invalidCalendarDate = `${compactToday().slice(0, 4)}0231`;
  const { records } = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      validTrade({ id: "valid" }),
      validTrade({ id: "bad-side", side: "BUY" }),
      validTrade({ id: "bad-kind", kind: "warrant" }),
      validTrade({ id: "bad-calendar", date: invalidCalendarDate }),
      validTrade({ id: "future", date: compactToday(1) }),
      validTrade({ id: "fractional", shares: 1.5 }),
    ],
  });
  assert.deepEqual(records.map((record) => record.id), ["valid"]);
});

test("isValidCompactCalendarDate：只接受真實 YYYYMMDD 日期", () => {
  const year = compactToday().slice(0, 4);
  assert.equal(mod.isValidCompactCalendarDate(compactToday()), true);
  assert.equal(mod.isValidCompactCalendarDate(`${year}0231`), false);
  assert.equal(mod.isValidCompactCalendarDate(`${year}0001`), false);
  assert.equal(mod.isValidCompactCalendarDate(`${year}010`), false);
  assert.equal(mod.isValidCompactCalendarDate("not-a-date"), false);
});

test("validateTradesMutationInput：records 必須是陣列，且超過上限要整包拒絕", () => {
  assert.equal(mod.MAX_TRADE_RECORDS, 500);
  assertValidationError({ settings: SETTINGS }, /records|陣列/i);
  assertValidationError({ settings: SETTINGS, records: {} }, /records|陣列/i);

  const records = Array.from({ length: mod.MAX_TRADE_RECORDS + 1 }, (_, index) => (
    validTrade({ id: `trade-${index}` })
  ));
  assertValidationError({ settings: SETTINGS, records }, /500|上限|筆/);
});

test("validateTradesMutationInput：未知 side/kind、無效日曆與未來日期皆拒絕", () => {
  const today = compactToday();
  const invalidCalendarDate = `${today.slice(0, 4)}0231`;
  const cases = [
    [validTrade({ side: "BUY" }), /side|買賣|類型/i],
    [validTrade({ kind: "warrant" }), /kind|商品|類型/i],
    [validTrade({ date: invalidCalendarDate }), /date|日期/i],
    [validTrade({ date: compactToday(1) }), /未來|future|日期/i],
  ];
  for (const [record, expectedPattern] of cases) {
    assertValidationError({ settings: SETTINGS, records: [record] }, expectedPattern, today);
  }
});

test("validateTradesMutationInput：股數須為正整數，fee/tax 若提供不得為負", () => {
  const cases = [
    [validTrade({ shares: 1.5 }), /shares|股數|整數/i],
    [validTrade({ fee: -1 }), /fee|手續費/i],
    [validTrade({ side: "sell", tax: -1 }), /tax|稅/i],
  ];
  for (const [record, expectedPattern] of cases) {
    assertValidationError({ settings: SETTINGS, records: [record] }, expectedPattern);
  }
});

test("validateTradesMutationInput：相同 id/event 的完全相同重送可冪等，經濟內容衝突則拒絕", () => {
  const trade = validTrade();
  assert.equal(mod.validateTradesMutationInput({ settings: SETTINGS, records: [trade, { ...trade }] }).ok, true);
  assertValidationError(
    { settings: SETTINGS, records: [trade, { ...trade, price: 101 }] },
    /id|重複|衝突/i,
  );

  const dividend = validTrade({
    id: "dividend-1",
    side: "dividend",
    eventId: `cash-dividend:TWSE:2330:${compactToday(-1)}`,
    exDate: compactToday(-1),
    price: 3,
    shares: 1000,
  });
  assert.equal(mod.validateTradesMutationInput({
    settings: SETTINGS,
    records: [dividend, { ...dividend, id: "dividend-retry" }],
  }).ok, true, "同一官方股利事件換本機 id 重送仍應視為冪等");
  assertValidationError({
    settings: SETTINGS,
    records: [dividend, { ...dividend, id: "dividend-conflict", shares: 900 }],
  }, /event|股利|重複|衝突/i);
});

test("normalizeTradesPayload：清洗（壞代號/負數/重複id）、日期排序、自動補費用", () => {
  const { settings, records } = mod.normalizeTradesPayload({
    settings: { feeDiscount: 0.28, minFee: 20 },
    records: [
      { id: "b", code: "2330", side: "sell", date: "2026-06-20", price: 110, shares: 500 },
      { id: "a", code: "2330", side: "buy", date: "2026-06-10", price: 100, shares: 1000 },
      { id: "x1", code: "abc", side: "buy", date: "2026-06-10", price: 100, shares: 100 },  // 壞代號
      { id: "x2", code: "1101", side: "buy", date: "2026-06-10", price: -5, shares: 100 },  // 負價
      { id: "a", code: "2330", side: "buy", date: "2026-06-11", price: 999, shares: 1 },    // 重複 id
    ],
  });
  assert.equal(settings.feeDiscount, 0.28);
  assert.equal(records.length, 2, "壞資料與重複 id 都要清掉");
  assert.deepEqual(records.map((r) => r.id), ["a", "b"], "依日期排序（買在前）");
  // 自動補費用（用 0.28 折）：買 100×1000 → round(100000×0.001425×0.28)=round(39.9)=40
  assert.equal(records[0].fee, 40);
  assert.equal(records[0].tax, 0, "買進沒有證交稅");
  // 賣 110×500 → fee round(55000×0.001425×0.28)=round(21.945)=22；稅 floor(165)=165
  assert.equal(records[1].fee, 22);
  assert.equal(records[1].tax, 165);
});

test("normalizeTradesPayload：官方股利事件冪等、每股金額保留六位小數", () => {
  const exDate = compactToday(-2);
  const event = {
    eventId: `cash-dividend:TWSE:2330:${exDate}`,
    exDate,
    code: "2330",
    side: "dividend",
    date: exDate,
    price: 3.123456,
    shares: 1000,
    source: "official-event",
  };
  const { records } = mod.normalizeTradesPayload({
    records: [
      { ...event, id: "first" },
      { ...event, id: "retry-with-another-id" },
    ],
  });
  assert.equal(records.length, 1, "相同 eventId 重送不得形成兩筆股利");
  assert.equal(records[0].price, 3.123456);
  assert.equal(records[0].eventId, event.eventId);
  assert.equal(records[0].exDate, exDate);
  assert.equal(records[0].entitledShares, 1000);
  assert.equal(records[0].status, "receivable", "官方事件只代表除息日取得權利，尚未等於銀行已入帳");
  assert.equal(records[0].fee, null, "待入帳匯費未知，不可先預扣 10 元");
  assert.equal(records[0].receivedDate, null);
  assert.equal(records[0].receivedAmount, null);
});

test("normalizeTradesPayload：舊手動股利無 status 視為已入帳；明確 null 費用可無損往返", () => {
  const date = compactToday(-3);
  const { records } = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      {
        id: "legacy-manual",
        code: "1101",
        side: "dividend",
        date,
        price: 1.5,
        shares: 1000,
      },
      {
        id: "received-with-actual",
        eventId: `cash-dividend:TWSE:2330:${date}`,
        exDate: date,
        source: "official-event",
        code: "2330",
        side: "dividend",
        status: "received",
        date,
        price: 3,
        shares: 1000,
        fee: null,
        receivedDate: compactToday(-1),
        receivedAmount: 2988,
      },
    ],
  });

  const legacy = records.find((record) => record.id === "legacy-manual");
  assert.equal(legacy.status, "received", "舊版手動股利本來就是現金入帳紀錄，升級後不可倒退成應收");
  assert.equal(legacy.fee, 10, "只有舊手動入帳紀錄維持既有預設匯費相容性");
  assert.equal(legacy.receivedDate, date, "舊版 date 原本就是入帳日，遷移時沿用才不會遺失語意");
  assert.equal(legacy.receivedAmount, 1490, "舊紀錄沒有實收欄位時沿用原本的毛額減匯費算法");

  const received = records.find((record) => record.id === "received-with-actual");
  assert.equal(received.status, "received");
  assert.equal(received.fee, null, "null 代表未知，不能被 Number(null) 偷轉成 0");
  assert.equal(received.receivedDate, compactToday(-1));
  assert.equal(received.receivedAmount, 2988);
});

test("validateTradesMutationInput：股利狀態更新保留同一 event/id，null 費用與合法實收欄位可 PUT", () => {
  const exDate = compactToday(-4);
  const receivablePayload = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [{
      id: "dividend-stable-id",
      eventId: `cash-dividend:TWSE:2330:${exDate}`,
      exDate,
      source: "official-event",
      code: "2330",
      side: "dividend",
      date: exDate,
      price: 3,
      shares: 1000,
    }],
  });
  const receivable = receivablePayload.records[0];
  const receivedDate = compactToday(-1);
  const updated = {
    ...receivable,
    status: "received",
    receivedDate,
    receivedAmount: 2988,
  };

  const validation = mod.validateTradesMutationInput({
    settings: receivablePayload.settings,
    records: [updated],
  });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));

  const roundTripped = mod.normalizeTradesPayload({
    settings: receivablePayload.settings,
    records: [updated],
  }).records[0];
  assert.equal(roundTripped.id, receivable.id, "確認入帳是更新原紀錄，不得另建一筆造成重複股利");
  assert.equal(roundTripped.eventId, receivable.eventId);
  assert.equal(roundTripped.status, "received");
  assert.equal(roundTripped.fee, null);
  assert.equal(roundTripped.receivedDate, receivedDate);
  assert.equal(roundTripped.receivedAmount, 2988);
});

test("validateTradesMutationInput：receivedDate / receivedAmount 與 status 必須嚴格一致", () => {
  const exDate = compactToday(-4);
  const official = {
    id: "strict-dividend",
    eventId: `cash-dividend:TWSE:2330:${exDate}`,
    exDate,
    source: "official-event",
    code: "2330",
    side: "dividend",
    kind: "stock",
    status: "received",
    date: exDate,
    price: 3,
    shares: 1000,
    fee: null,
  };
  const cases = [
    [{ ...official, status: "paid" }, /status|狀態|receivable|received/i],
    [{ ...official, receivedDate: `${compactToday().slice(0, 4)}0231` }, /receivedDate|入帳日|日期/i],
    [{ ...official, receivedDate: compactToday(1) }, /receivedDate|入帳日|未來|日期/i],
    [{ ...official, receivedDate: compactToday(-5) }, /receivedDate|入帳日|除息|認列|之前/i],
    [{ ...official, receivedAmount: -1 }, /receivedAmount|實收|金額/i],
    [{ ...official, receivedAmount: "2988" }, /receivedAmount|實收|數字/i],
    [{ ...official, status: "receivable", receivedDate: compactToday(-1) }, /receivable|待入帳|receivedDate|入帳日/i],
    [{ ...official, status: "receivable", receivedAmount: 2988 }, /receivable|待入帳|receivedAmount|實收/i],
  ];
  for (const [record, pattern] of cases) {
    assertValidationError({ settings: SETTINGS, records: [record] }, pattern);
  }

  const legacyUnknownReceipt = { ...official, status: "received", receivedDate: null, receivedAmount: null };
  const legacyValidation = mod.validateTradesMutationInput({ settings: SETTINGS, records: [legacyUnknownReceipt] });
  assert.equal(legacyValidation.ok, true, JSON.stringify(legacyValidation.errors));
});

test("buildPortfolio：加權平均成本＋部分賣出的已實現損益（手算例）", () => {
  const payload = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "t1", code: "2330", side: "buy", date: "2026-06-10", price: 100, shares: 1000 },
      { id: "t2", code: "2330", side: "sell", date: "2026-06-20", price: 110, shares: 500 },
    ],
  });
  const pf = mod.buildPortfolio(payload);
  assert.equal(pf.ok, true);
  // 買：成本 100×1000＋fee 86（round(85.5)）＝100,086；均價 100.086
  // 賣 500：結轉成本 50,043；收入 55,000−47−165＝54,788；已實現 +4,745
  assert.equal(pf.realized.length, 1);
  assert.equal(pf.realized[0].pnl, 4745);
  assert.equal(pf.realized[0].avgCost, 100.09);
  assert.ok(Math.abs(pf.realized[0].pnlPct - 9.48) < 0.02, `pnlPct=${pf.realized[0].pnlPct}`);
  // 剩餘持股：500 股、成本 50,043、均價 100.09
  assert.equal(pf.holdings.length, 1);
  assert.equal(pf.holdings[0].shares, 500);
  assert.equal(pf.holdings[0].cost, 50043);
  assert.equal(pf.holdings[0].avgCost, 100.09);
  assert.equal(pf.totals.realizedPnl, 4745);
});

test("buildPortfolio：賣超（含刪舊買單情境）→ ok:false 帶白話錯誤", () => {
  const overSell = mod.buildPortfolio(mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "t1", code: "2330", side: "buy", date: "2026-06-10", price: 100, shares: 300 },
      { id: "t2", code: "2330", side: "sell", date: "2026-06-20", price: 110, shares: 500 },
    ],
  }));
  assert.equal(overSell.ok, false);
  assert.ok(overSell.error.includes("賣超") && overSell.error.includes("2330"), overSell.error);
  // 沒買過就賣
  const noHolding = mod.buildPortfolio(mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [{ id: "t1", code: "1101", side: "sell", date: "2026-06-20", price: 40, shares: 1000 }],
  }));
  assert.equal(noHolding.ok, false);
});

test("buildPortfolio：股利入帳——不動持股與成本、預設匯費 10、清倉檔股利仍計入總額", () => {
  const payload = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "d1", code: "2330", side: "buy", date: "2026-06-01", price: 100, shares: 1000, fee: 0 },
      { id: "d2", code: "2330", side: "dividend", date: "2026-07-02", price: 3, shares: 1000 }, // fee 預設 10
      { id: "d3", code: "1101", side: "buy", date: "2026-06-01", price: 40, shares: 1000, fee: 0 },
      { id: "d4", code: "1101", side: "dividend", date: "2026-06-15", price: 1.5, shares: 1000, fee: 0 },
      { id: "d5", code: "1101", side: "sell", date: "2026-06-20", price: 41, shares: 1000 }, // 之後清倉
    ],
  });
  const div2330 = payload.records.find((r) => r.id === "d2");
  assert.equal(div2330.side, "dividend");
  assert.equal(div2330.fee, 10, "股利匯費預設 10 元");
  assert.equal(div2330.tax, 0, "股利沒有證交稅");
  const pf = mod.buildPortfolio(payload);
  assert.equal(pf.ok, true, "股利不影響賣超檢查");
  const h2330 = pf.holdings.find((h) => h.code === "2330");
  assert.equal(h2330.shares, 1000, "股利不動股數");
  assert.equal(h2330.cost, 100000, "股利不動成本（台股慣例：股利另計收入）");
  assert.equal(h2330.dividends, 2990, "3×1000−10 匯費");
  assert.equal(pf.totals.dividendIncome, 2990 + 1500, "已清倉的 1101 股利也要計入總額");
});

test("buildPortfolio：待入帳只算應收毛額，不得先扣未知匯費或混入已入帳收入", () => {
  const buyDate = compactToday(-10);
  const exDate = compactToday(-5);
  const payload = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "pending-buy", code: "2330", side: "buy", date: buyDate, price: 100, shares: 1000, fee: 0 },
      {
        id: "pending-small-dividend",
        eventId: `cash-dividend:TWSE:2330:${exDate}`,
        exDate,
        source: "official-event",
        code: "2330",
        side: "dividend",
        date: exDate,
        price: 0.005,
        shares: 1000,
      },
    ],
  });
  const pf = mod.buildPortfolio(payload);
  assert.equal(pf.ok, true);
  const holding = pf.holdings.find((item) => item.code === "2330");

  assert.equal(holding.dividendsRecognizedGross, 5, "除息日已認列權利的毛額 = 每股 0.005 × 1000 股");
  assert.equal(holding.dividendsReceivableGross, 5, "尚未入帳時完整列為應收毛額，不扣未知匯費");
  assert.equal(holding.dividends, 0, "舊欄名 dividends 只代表已入帳淨額");
  assert.equal(pf.totals.dividendRecognizedGross, 5);
  assert.equal(pf.totals.dividendReceivableGross, 5, "小額應收也不可因預扣 10 元變成負數");
  assert.equal(pf.totals.dividendReceivedNet, 0);
  assert.equal(pf.totals.dividendIncome, 0, "待入帳不得污染既有的已入帳收入欄位");
});

test("buildPortfolio：實收金額優先於公告毛額減匯費，並與應收/認列總額分開", () => {
  const buyDate = compactToday(-20);
  const pendingDate = compactToday(-12);
  const receivedExDate = compactToday(-10);
  const legacyDate = compactToday(-8);
  const payload = mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "mixed-buy", code: "2330", side: "buy", date: buyDate, price: 100, shares: 1000, fee: 0 },
      {
        id: "mixed-pending",
        eventId: `cash-dividend:TWSE:2330:${pendingDate}`,
        exDate: pendingDate,
        source: "official-event",
        code: "2330",
        side: "dividend",
        date: pendingDate,
        price: 0.005,
        shares: 1000,
      },
      {
        id: "mixed-received",
        eventId: `cash-dividend:TWSE:2330:${receivedExDate}`,
        exDate: receivedExDate,
        source: "official-event",
        code: "2330",
        side: "dividend",
        status: "received",
        date: receivedExDate,
        price: 3,
        shares: 1000,
        fee: 10,
        receivedDate: compactToday(-7),
        receivedAmount: 2876,
      },
      {
        id: "mixed-legacy-received",
        code: "2330",
        side: "dividend",
        date: legacyDate,
        price: 1,
        shares: 1000,
        fee: 0,
      },
    ],
  });
  const pf = mod.buildPortfolio(payload);
  assert.equal(pf.ok, true);
  const holding = pf.holdings.find((item) => item.code === "2330");

  assert.equal(holding.dividendsRecognizedGross, 4005, "應收 5 + 官方已實收公告毛額 3000 + 舊手動毛額 1000");
  assert.equal(holding.dividendsReceivableGross, 5);
  assert.equal(holding.dividends, 3876, "官方實收 2876（優先）+ 舊手動淨額 1000");
  assert.equal(pf.totals.dividendRecognizedGross, 4005);
  assert.equal(pf.totals.dividendReceivableGross, 5);
  assert.equal(pf.totals.dividendReceivedNet, 3876, "receivedAmount 必須優先，不能退回 3000−10=2990");
  assert.equal(pf.totals.dividendIncome, 3876, "舊相容欄位等於已入帳淨額");
});

test("buildPortfolio：多檔並存、清倉後浮點歸零、清倉不留 holdings", () => {
  const pf = mod.buildPortfolio(mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "a1", code: "2330", side: "buy", date: "2026-06-01", price: 100, shares: 1000 },
      { id: "a2", code: "1101", side: "buy", date: "2026-06-02", price: 40, shares: 2000 },
      { id: "a3", code: "2330", side: "sell", date: "2026-06-10", price: 105, shares: 1000 }, // 清倉
    ],
  }));
  assert.equal(pf.ok, true);
  assert.equal(pf.holdings.length, 1, "2330 清倉後只剩 1101");
  assert.equal(pf.holdings[0].code, "1101");
  assert.equal(pf.realized.length, 1);
  // 加碼攤平：兩筆買的加權平均
  const pf2 = mod.buildPortfolio(mod.normalizeTradesPayload({
    settings: SETTINGS,
    records: [
      { id: "b1", code: "2330", side: "buy", date: "2026-06-01", price: 100, shares: 1000, fee: 0 },
      { id: "b2", code: "2330", side: "buy", date: "2026-06-05", price: 80, shares: 1000, fee: 0 },
    ],
  }));
  assert.equal(pf2.holdings[0].avgCost, 90, "無手續費時 (100+80)/2 = 90");
  assert.equal(pf2.holdings[0].shares, 2000);
});
