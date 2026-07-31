// 應收股利的權利股數必須把配股／現增取得的股數算進去，而且由**伺服器**覆算。
//
// 現場：前端的 dividendEntitlementShares 只重放 buy/sell，沒有 corporateAction 分支；
// 後端明明有正確的 sharesHeldBeforeExDate，收到股利紀錄時卻是
// `normalizedRecord.entitledShares = shares` 照單全收。兩份實作走岔，
// 而錯的那份正好是寫進帳本的那份。
//
// 量級：買 10,000 股、之後連兩年各配股 10% → 正確 12,100 股，漏算停在 10,000，少 17.4%。
// 除息日那顆快速鈕**只有當天出現**，按下去就把少掉的金額永久寫進帳本。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

// 日期一律用**固定的過去日期**：成交日在未來會被隔離（"成交日位於未來"），
// 而 compactToday(-N) 那種相對位移在這支檔案沒有必要（帳本不要求交易日，只要求不是未來），
// 用固定值反而不會隨執行日漂移。
const EX = "20250801";
const BUY_DAY = "20230715";
const BONUS_1 = "20230801";
const BONUS_2 = "20240801";
const AFTER_EX = "20251001";
const buy = (shares, date) => ({
  id: `buy-${date}`, code: "2881", side: "buy", instrumentType: "stock",
  price: 100, shares, date, tradeDate: date,
});
const bonus = (date, stockRatio, subscriptionRatio = 0) => ({
  id: `ca-${date}`, code: "2881", side: "corporateAction", instrumentType: "stock",
  price: 0, shares: 0, date, tradeDate: date,
  stockRatio, subscriptionRatio, subscriptionPrice: subscriptionRatio ? 50 : 0,
});
const dividendEvent = (shares) => ({
  id: "div-1", code: "2881", side: "dividend", instrumentType: "stock",
  price: 3.5, shares, date: EX, tradeDate: EX,
  exDate: EX, eventId: `cash-dividend:TWSE:2881:${EX}`, source: "official-event",
});

const entitlementOf = (records) => {
  const out = mod.normalizeTradesPayload({ schemaVersion: 2, records });
  const div = out.records.find((r) => r.side === "dividend");
  return { shares: div?.shares, entitledShares: div?.entitledShares, quarantined: out.quarantinedRecords.length };
};

test("配股取得的股數也有領息權利：連兩年各配 10% → 12,100 股而不是 10,000", () => {
  const got = entitlementOf([
    buy(10000, BUY_DAY),
    bonus(BONUS_1, 0.1),
    bonus(BONUS_2, 0.1),
    dividendEvent(10000), // 前端送來的（漏算版）
  ]);
  assert.equal(got.shares, 12100, "10000 → 11000 → 12100");
  assert.equal(got.entitledShares, 12100, "兩個欄位要一起更新（shares 同時是金額基準）");
  assert.equal(got.quarantined, 0);
});

test("現增取得的股數同樣算進權利", () => {
  const got = entitlementOf([buy(10000, BUY_DAY), bonus(BONUS_2, 0, 0.05), dividendEvent(10000)]);
  assert.equal(got.shares, 10500);
});

test("配股與現增同一天：兩者各自 floor，不是先加總再取整", () => {
  // 判準必須與後端 sharesHeldBeforeExDate 逐字一致——包含「兩者各自 floor」而不是先加總再取整。
  // 比率要挑會讓兩種寫法分岔的：999 股、配股 10% ＋ 現增 15%
  //   各自 floor：floor(99.9)=99、floor(149.85)=149 → +248 → 1247   ← 正確
  //   先加總　　：floor(999×0.25)=floor(249.75)=249 → +249 → 1248
  // （零股不足一股是分別捨去的，這不是四捨五入的細節問題。）
  const got = entitlementOf([buy(999, BUY_DAY), bonus(BONUS_2, 0.1, 0.15), dividendEvent(999)]);
  assert.equal(got.shares, 1247, "99 + 149 = 248（各自 floor），不是 249（先加總）");
});

test("除息日之後才發生的公司行動不算進權利", () => {
  const got = entitlementOf([buy(10000, BUY_DAY), bonus(AFTER_EX, 0.2), dividendEvent(10000)]);
  assert.equal(got.shares, 10000, "除息日之後配的股，這次除息領不到");
});

test("除息日當天買進沒有權利、當天賣出仍有權利（既有規則不可被新分支破壞）", () => {
  const sameDayBuy = entitlementOf([buy(10000, BUY_DAY), buy(5000, EX), dividendEvent(10000)]);
  assert.equal(sameDayBuy.shares, 10000, "除息日當天買進不得計入");

  const sameDaySell = entitlementOf([
    buy(10000, BUY_DAY),
    { id: "sell-1", code: "2881", side: "sell", instrumentType: "stock", price: 120, shares: 4000, date: EX, tradeDate: EX },
    dividendEvent(10000),
  ]);
  assert.equal(sameDaySell.shares, 10000, "除息日當天賣出仍有權利");
});

test("賣掉一部分之後配股：基準是當時剩下的股數", () => {
  const got = entitlementOf([
    buy(10000, BUY_DAY),
    { id: "sell-1", code: "2881", side: "sell", instrumentType: "stock", price: 120, shares: 6000, date: "20230720", tradeDate: "20230720" },
    bonus(BONUS_2, 0.1),
    dividendEvent(4000),
  ]);
  assert.equal(got.shares, 4400, "4000 的 10% 是 400");
});

test("帳本裡沒有依據時保留客戶端的值，不得覆寫成 0", () => {
  // 只記股利不記買進、或匯入了不完整的歷史。正確答案是「算不出來」而不是「0」。
  // 覆寫成 0 會摧毀一筆真實的應收，而且下一關的 validateTradesMutationInput 會以
  // 「股數必須是大於 0 的整數」擋下**整包** PUT——使用者連別的紀錄都存不進去。
  const got = entitlementOf([dividendEvent(1000)]);
  assert.equal(got.shares, 1000);
  assert.equal(got.entitledShares, 1000);
});

test("已入帳（received）的股利不覆算：實收金額以券商對帳單為準", () => {
  const out = mod.normalizeTradesPayload({
    schemaVersion: 2,
    records: [
      buy(10000, BUY_DAY),
      bonus(BONUS_2, 0.1),
      { ...dividendEvent(10000), status: "received", receivedDate: "20250815", receivedAmount: 34990 },
    ],
  });
  const div = out.records.find((r) => r.side === "dividend");
  assert.equal(div.status, "received");
  assert.equal(div.shares, 10000, "已入帳的數字不可回頭改");
});

test("手動新增的股利（沒有 eventId）不覆算：使用者填的就是他要的", () => {
  const out = mod.normalizeTradesPayload({
    schemaVersion: 2,
    records: [
      buy(10000, BUY_DAY),
      bonus(BONUS_2, 0.1),
      { id: "manual-div", code: "2881", side: "dividend", instrumentType: "stock",
        price: 3.5, shares: 8000, date: EX, tradeDate: EX, status: "received",
        receivedDate: EX, receivedAmount: 28000 },
    ],
  });
  const div = out.records.find((r) => r.side === "dividend");
  assert.equal(div.shares, 8000, "手動紀錄不受伺服器覆算影響");
});

test("手動股利即使是「待入帳」也不覆算：沒有官方事件就沒有權威的重算依據", () => {
  // 這一條是突變抽查逼出來的：原本只測了 status="received" 的手動股利，
  // 而那被 `status !== "receivable"` 先擋掉了，`!eventId` 那半形同虛設。
  // effectiveDividendStatus（server.mjs:829）在客戶端明確送 status 時照收、不看 eventId，
  // 所以「手動 ＋ 待入帳」是真的到得了的狀態。使用者自己填的股數不可被伺服器改掉。
  const out = mod.normalizeTradesPayload({
    schemaVersion: 2,
    records: [
      buy(10000, BUY_DAY),
      bonus(BONUS_2, 0.1),
      { id: "manual-receivable", code: "2881", side: "dividend", instrumentType: "stock",
        price: 3.5, shares: 7000, date: EX, tradeDate: EX, status: "receivable" },
    ],
  });
  const div = out.records.find((r) => r.side === "dividend");
  assert.equal(div.status, "receivable", "前提：這筆真的是待入帳");
  assert.equal(div.shares, 7000, "沒有 eventId 就不是官方事件，使用者填的數字不可被覆寫");
  assert.equal(div.entitledShares, 7000);
});

test("覆算會反映在投組的應收總額上（金額基準是 price × shares）", () => {
  const payload = mod.normalizeTradesPayload({
    schemaVersion: 2,
    records: [buy(10000, BUY_DAY), bonus(BONUS_1, 0.1), bonus(BONUS_2, 0.1), dividendEvent(10000)],
  });
  const portfolio = mod.buildPortfolio(payload);
  // 12,100 股 × 3.5 元 = 42,350；漏算版是 10,000 × 3.5 = 35,000。
  assert.equal(portfolio.totals.dividendReceivableGross, 42350);
  assert.equal(portfolio.totals.dividendReceivedNet, 0, "尚未入帳不得灌進已入帳損益");
});

test("不同代號互不干擾", () => {
  const out = mod.normalizeTradesPayload({
    schemaVersion: 2,
    records: [
      buy(10000, BUY_DAY),
      bonus(BONUS_2, 0.1),
      { id: "buy-other", code: "2330", side: "buy", instrumentType: "stock", price: 900, shares: 2000, date: BUY_DAY, tradeDate: BUY_DAY },
      dividendEvent(10000),
      { id: "div-2330", code: "2330", side: "dividend", instrumentType: "stock", price: 4, shares: 2000,
        date: EX, tradeDate: EX, exDate: EX, eventId: `cash-dividend:TWSE:2330:${EX}`, source: "official-event" },
    ],
  });
  assert.equal(out.records.find((r) => r.code === "2881" && r.side === "dividend").shares, 11000);
  assert.equal(out.records.find((r) => r.code === "2330" && r.side === "dividend").shares, 2000, "2330 沒有配股");
});
