// D-22：交易帳本的公司行動（除權無償配股／現增）。
// 帳本原本只認 buy/sell/dividend，而 dividend 只有「每股現金 × 股數」一種語意、不動持股與成本。
// 於是配股之後帳本的股數永遠停在配股前，造成兩個問題：
//   (a) 顯示面——1000 股均價 100 配股 10% 後，實際是 1100 股均價約 90.91、未實現 0，
//       帳本卻仍是 1000 股配上除權後的現價 → 顯示 −9.1% 的假虧損；
//   (b) 功能面（更嚴重，已實測）——想賣掉含配股的 1100 股會被賣超檢查擋下，
//       錯誤訊息還叫使用者「檢查買賣紀錄」，但紀錄是對的。
// 會計上很單純：無償配股＝以 0 元取得股票，現增＝以認購價取得股票，都是「加股數、加成本」。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const SETTINGS = { feeDiscount: 0.6, minFee: 20 };
const buy = (over = {}) => ({
  id: "b1", code: "2330", side: "buy", instrumentType: "stock",
  tradeDate: "20260601", price: 100, shares: 1000, dayTrade: { status: "none" }, ...over,
});
const action = (over = {}) => ({
  id: "c1", code: "2330", side: "corporateAction", tradeDate: "20260701", stockRatio: 0.1, ...over,
});
const build = (records) => mod.buildPortfolio(mod.normalizeTradesPayload({ schemaVersion: 2, settings: SETTINGS, records }));
const validate = (records) => mod.validateTradesMutationInput({ schemaVersion: 2, settings: SETTINGS, records });

test("配股後可以賣出「含配股」的全部股數，不再被誤判賣超", () => {
  const withoutAction = build([buy(), { ...buy({ id: "s1", side: "sell", tradeDate: "20260720", price: 95, shares: 1100 }) }]);
  assert.equal(withoutAction.ok, false, "沒有公司行動紀錄時本來就該擋（帳面只有 1000 股）");

  const withAction = build([
    buy(),
    action(),
    buy({ id: "s1", side: "sell", tradeDate: "20260720", price: 95, shares: 1100 }),
  ]);
  assert.equal(withAction.ok, true, withAction.error);
  assert.equal(withAction.realized.length, 1);
  assert.equal(withAction.holdings.length, 0, "1100 股全部賣出後應該清倉");
});

test("無償配股：股數增加、總成本不變、均價自動稀釋", () => {
  const pf = build([buy(), action()]);
  const holding = pf.holdings[0];
  assert.equal(holding.shares, 1100, "1000 × (1 + 0.1)");
  // 買進成本含手續費：100 × 1000 × 0.1425% × 0.6 = 85.5 → 86
  assert.equal(holding.cost, 100086, "無償配股不繳款，總成本不得增加");
  assert.equal(holding.avgCost, 90.99, "100086 ÷ 1100");
});

test("現增：股數與成本都增加，成本增幅＝認購股數 × 認購價", () => {
  const pf = build([buy(), action({ stockRatio: 0, subscriptionRatio: 0.05, subscriptionPrice: 50 })]);
  const holding = pf.holdings[0];
  assert.equal(holding.shares, 1050, "1000 × 5% = 50 股");
  assert.equal(holding.cost, 100086 + 50 * 50, "認購 50 股 × 50 元");
});

test("不足一股無條件捨去（台股零股折現金發放，帳本只追蹤股數）", () => {
  // 1000 × 0.1234 = 123.4 → 123 股
  const pf = build([buy(), action({ stockRatio: 0.1234 })]);
  assert.equal(pf.holdings[0].shares, 1123);
});

test("基準日之前已賣光就沒有配股，不得無中生有", () => {
  const pf = build([
    buy(),
    buy({ id: "s1", side: "sell", tradeDate: "20260620", price: 110, shares: 1000 }),
    action(),
  ]);
  assert.equal(pf.holdings.length, 0);
  assert.equal(pf.ok, true);
});

test("驗證規則：至少一個比率 > 0、現增要有認購價、比率不得誤填成每仟股", () => {
  assert.equal(validate([action()]).ok, true, "正常除權");
  assert.equal(validate([action({ stockRatio: 0, subscriptionRatio: 0.05, subscriptionPrice: 50 })]).ok, true);

  const noRatio = validate([action({ stockRatio: 0 })]);
  assert.equal(noRatio.ok, false);
  assert.match(noRatio.errors.map((e) => e.message).join(""), /至少要有/);

  const noPrice = validate([action({ stockRatio: 0, subscriptionRatio: 0.05 })]);
  assert.equal(noPrice.ok, false);
  assert.match(noPrice.errors.map((e) => e.message).join(""), /認購價/);

  // 官方報表在網頁版是「每仟股配股數」，填成 100 而不是 0.1 會讓整段 K 線塌掉。
  const perThousand = validate([action({ stockRatio: 100 })]);
  assert.equal(perThousand.ok, false);
  assert.match(perThousand.errors.map((e) => e.message).join(""), /每仟股/);

  const future = validate([action({ tradeDate: "20991231" })]);
  assert.equal(future.ok, false);
  assert.match(future.errors.map((e) => e.message).join(""), /未來/);
});

test("公司行動不得放寬買賣紀錄的既有防線", () => {
  const badBuy = validate([buy({ price: 0 })]);
  assert.equal(badBuy.ok, false, "價格 0 的買進仍必須被擋下");
  const badShares = validate([buy({ shares: 0 })]);
  assert.equal(badShares.ok, false, "股數 0 的買進仍必須被擋下");
});

test("正規化後的公司行動紀錄不帶假的 price/shares，避免下游誤當成交", () => {
  const payload = mod.normalizeTradesPayload({ schemaVersion: 2, settings: SETTINGS, records: [buy(), action()] });
  const record = payload.records.find((item) => item.side === "corporateAction");
  assert.ok(record, "公司行動紀錄要被保留");
  assert.equal(record.price, undefined);
  assert.equal(record.shares, undefined);
  assert.equal(record.stockRatio, 0.1);
  assert.equal(record.tradeDate, "20260701");
});
