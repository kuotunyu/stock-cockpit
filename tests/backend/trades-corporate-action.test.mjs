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

// ---- 權利股數的基準日：同日交易 ----
//
// 舊寫法用「重放到那一筆時的 pos.shares」算配股，而正確口徑是「除權基準日**之前**的持股」
// （findMissingCorporateActions 的 sharesBefore 一直是對的，兩邊因此會給出不同答案）。
// 這個分岔在同日交易上**必然**發生：compareTradeChronology 缺 executedAt 時退回 createdAt 排序，
// 而補登配股的快速鈕填的是「按下去的當下」，必然排在同日買賣之後。
// 既有的 8 個案例全是「買 0601 / 除權 0701」，同日組合一次都沒有——所以這個缺陷沒被守住。

test("基準日當天再買進：新買的不享有配股權利", () => {
  const portfolio = build([
    buy(),                                                            // 06/01 買 1000
    buy({ id: "b2", tradeDate: "20260701", price: 90, shares: 1000 }), // 07/01（除權日）再買 1000
    action(),                                                         // 07/01 除權 0.1
  ]);
  assert.equal(portfolio.ok, true, portfolio.error);
  const holding = portfolio.holdings.find((item) => item.code === "2330");
  // 只有除權日之前的 1000 股有權利 → +100 股；舊寫法用當下的 2000 股算 → +200。
  assert.equal(holding.shares, 2100, "基準日當天買進的那 1000 股不享有配股");
});

test("基準日當天賣出：賣掉的部分仍然享有配股權利", () => {
  const portfolio = build([
    buy(),                                                                                  // 06/01 買 1000
    buy({ id: "s1", side: "sell", tradeDate: "20260701", price: 90, shares: 600 }),          // 07/01 賣 600
    action(),                                                                               // 07/01 除權 0.1
  ]);
  assert.equal(portfolio.ok, true, portfolio.error);
  const holding = portfolio.holdings.find((item) => item.code === "2330");
  // 除權日之前持有 1000 股 → +100 股；賣掉 600 之後剩 400，加上配股 100 = 500。
  // 舊寫法用當下的 400 股算 → 只加 40 股 → 440。
  assert.equal(holding.shares, 500, "基準日當天賣出仍享有權利（當天的價格已是除權後參考價）");
});

test("基準日當天全部賣光：配股不得整批蒸發", () => {
  const portfolio = build([
    buy({ shares: 2000 }),                                                                   // 06/01 買 2000
    buy({ id: "s1", side: "sell", tradeDate: "20260701", price: 90, shares: 2000 }),          // 07/01 全賣
    action({ stockRatio: 0.5 }),                                                             // 07/01 除權 0.5
  ]);
  assert.equal(portfolio.ok, true, portfolio.error);
  const holding = portfolio.holdings.find((item) => item.code === "2330");
  // 舊寫法的守衛是 `if (pos.shares > 0)`，這時 pos.shares 是 0 → 整個分支被跳過
  // → 1000 股憑空消失，而且之後想賣它會被賣超檢查擋下、錯誤訊息還叫你去檢查紀錄。
  assert.ok(holding, "全部賣光但仍有配股，庫存不該整檔消失");
  assert.equal(holding.shares, 1000, "除權日之前持有 2000 股 → 配股 1000 股必須留下");
});

test("提示的股數與實際加進去的股數必須一致（同一個口徑）", async () => {
  const records = [
    buy(),
    buy({ id: "b2", tradeDate: "20260701", price: 90, shares: 1000 }),
  ];
  // findMissingCorporateActions 用 sharesBefore、buildPortfolio 用同一個函式，兩邊必須相等。
  const before = mod.sharesHeldBeforeExDate(records, "2330", "20260701");
  assert.equal(before, 1000, "基準日之前只有 1000 股");
  const portfolio = build([...records, action()]);
  const holding = portfolio.holdings.find((item) => item.code === "2330");
  assert.equal(holding.shares - 2000, Math.floor(before * 0.1), "實際加的股數＝提示的股數");
});

// 既有的「無條件捨去」案例用的比率讓 floor 與 round 同值，所以擋不住「改成四捨五入」。
// 台股不足一股是折現金發放，不是四捨五入給你一股——小數部分 ≥ 0.5 時兩者才分得出來。
test("不足一股一律捨去，即使小數部分超過一半", () => {
  const portfolio = build([buy({ shares: 1000 }), action({ stockRatio: 0.1799 })]);
  const holding = portfolio.holdings.find((item) => item.code === "2330");
  // 1000 × 0.1799 = 179.9 → 捨去 179（四捨五入會給 180，等於多給你一股）。
  assert.equal(holding.shares, 1179, "179.9 股要捨成 179，不可進位");
});
