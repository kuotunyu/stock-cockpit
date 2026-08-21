// D-41：`StockDividendRatio` / `SubscriptionRatio` 的單位。
//
// 欄位名叫 Ratio，但同一份報表的網頁版是以「每仟股無償配股（股）」呈現，兩者差 100 倍。
// 若上游哪天改成每仟股股數，referencePrice 的除數會從 1.1 變成 101 —— 整段 K 線塌陷，
// 而且 formulaComplete 仍是 true、source 仍蓋著 official 章，**不會有任何告警**。
//
// 2026-07-27 用真實 payload 實測（TWSE TWT48U_ALL 125 筆＋TPEx tpex_exright_prepost 138 筆）：
//   單位是比率：29 筆真實配股全部落在 (0, 1)，最大 0.5（5386）。沒有一筆接近 100。
//   用官方計算結果表反推驗證 7 個案例，比率單位算出的參考價與交易所公布值誤差 ≤ 0.01：
//     7740 熙特爾 配股 0.12781954／息 2.05：(157−2.05)/1.12782 = 137.39，官方 137.38
//     4764 現增 0.07014093 @ 230：(309.5+230×0.07014)/1.07014 = 304.29，官方 304.28
//   **兩個市場表達「沒有這件事」的方式不同**：上市留空字串、上櫃填 "0.00000000"。
//     TWSE 125 筆裡 107 筆是空字串、0 筆是 "0"；TPEx 138 筆全部非空。
//     這個不對稱如果被「兩邊都當 0」抹平，就分不出「沒有現增」與「現增比率是 0」。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer();
const { normalizeDividendMarketRows, DIVIDEND_RATIO_MAX_PLAUSIBLE } = mod;

const TODAY = "20260727";

// 直接照抄實機 payload 的形狀（值取自 2026-07-27 的真實回傳）。
const twseRows = [
  // 純除息：所有比率欄都是空字串——官方對「沒有這件事」的表達方式。
  { Date: "1150805", Code: "2412", Name: "中華電", Exdividend: "息", StockDividendRatio: "", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "4.5" },
  // 除權息＋配股：比率是 0.09999999 這種浮點尾數（上游把「每仟股 100 股」除過來的結果）。
  { Date: "1150730", Code: "1231", Name: "聯華食", Exdividend: "權息", StockDividendRatio: "0.09999999", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "1.5" },
  // 純除權（現增）：配股留空、現增有值、認購價 230。
  { Date: "1150724", Code: "4764", Name: "雷科", Exdividend: "權", StockDividendRatio: "", SubscriptionRatio: "0.07014093", SubscriptionPricePerShare: "230", CashDividend: "0" },
  // 已除權息、且官方計算結果表已公布的對照組（下面用它做反推驗證）。
  { Date: "1150724", Code: "7740", Name: "熙特爾-創", Exdividend: "權息", StockDividendRatio: "0.12781954", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "2.05" },
];

const tpexRows = [
  // 上櫃用 "0.00000000" 表達「沒有這件事」，不是空字串。
  { ExRrightsExDividendDate: "1150720", SecuritiesCompanyCode: "2640", CompanyName: "大車隊", ExRrightsExDividend: "除息", StockDividendRatio: "0.00000000", SubscriptionRatioToNewSharesIssued: "0.00000000", SubscriptionPricePerShare: "0.00", CashDividend: "8.00000000" },
  // 上櫃實測到的最大配股：0.5（＝配股 50%）。
  { ExRrightsExDividendDate: "1150730", SecuritiesCompanyCode: "5386", CompanyName: "青雲", ExRrightsExDividend: "除權息", StockDividendRatio: "0.50000001", SubscriptionRatioToNewSharesIssued: "0.00000000", SubscriptionPricePerShare: "0.00", CashDividend: "1.50000000" },
];

test("單位是比率不是每仟股股數：真實 payload 的值全部落在 (0, 1)", () => {
  const twse = normalizeDividendMarketRows("TWSE", twseRows, TODAY);
  const tpex = normalizeDividendMarketRows("TPEx", tpexRows, TODAY);
  const all = [...twse.archiveMap.values(), ...tpex.archiveMap.values()].flat();
  const ratios = all.flatMap((item) => [item.stockRatio, item.subscriptionRatio])
    .filter((value) => Number.isFinite(value) && value > 0);
  assert.ok(ratios.length >= 3, `至少要有幾筆非零比率可驗：${JSON.stringify(ratios)}`);
  for (const ratio of ratios) {
    assert.ok(ratio > 0 && ratio < 1, `比率 ${ratio} 不在 (0,1)——上游可能改成每仟股股數了`);
  }
});

test("用官方參考價反推：比率單位算得出交易所公布的數字，每仟股股數算不出來", () => {
  const { archiveMap } = normalizeDividendMarketRows("TWSE", twseRows, TODAY);
  const ref = (item, preClose) => (
    (preClose - (item.cashDividend || 0) + (item.subscriptionPrice || 0) * (item.subscriptionRatio || 0))
    / (1 + (item.stockRatio || 0) + (item.subscriptionRatio || 0))
  );
  // 這兩筆的除權息日都是 20260724（已過），官方計算結果表已公布，下面的前收／參考價
  // 是 2026-07-27 從本機歸檔的 corporateActionResults 讀出來的實際值，不是推算的。
  //（1231 的除權息日是 20260730，屬未來，TWT49U 還沒有那一筆，不能拿來當對照。）
  const hiter = archiveMap.get("7740")[0];   // 配股型：前收 157 → 參考價 137.38
  const leiko = archiveMap.get("4764")[0];   // 現增型：前收 309.5 → 參考價 304.28
  assert.ok(Math.abs(ref(hiter, 157) - 137.38) < 0.02, `配股 ${hiter.stockRatio} 算出 ${ref(hiter, 157)}，官方 137.38`);
  assert.ok(Math.abs(ref(leiko, 309.5) - 304.28) < 0.02, `現增 ${leiko.subscriptionRatio} 算出 ${ref(leiko, 309.5)}，官方 304.28`);

  // 若把同一個值當成「每仟股股數」（除數變 1+100r），算出來的參考價會荒謬到不可能是股價。
  const asShares = (309.5 + 230 * 7.014093) / (1 + 701.4093);
  assert.ok(asShares < 10, `每仟股股數的解讀會算出 ${asShares}，與官方 304.28 差兩個數量級`);
});

test("兩個市場表達「沒有這件事」的方式不同，不可被抹平成同一個 0", () => {
  const { archiveMap: twse } = normalizeDividendMarketRows("TWSE", twseRows, TODAY);
  const { archiveMap: tpex } = normalizeDividendMarketRows("TPEx", tpexRows, TODAY);
  // 上市：空字串 → null（「沒有這件事」）。
  assert.equal(twse.get("2412")[0].stockRatio, null, "上市用空字串表達沒有配股 → 必須是 null");
  assert.equal(twse.get("1231")[0].subscriptionRatio, null, "配股但沒有現增時，現增欄是空字串");
  // 上櫃：字串 "0.00000000" → 0（有這個欄位，值是零）。
  assert.equal(tpex.get("2640")[0].stockRatio, 0, "上櫃用 0 表達沒有配股 → 必須是 0 不是 null");
  // 這個差異是 officialCorporateActionRatio 那條「除權至少要有一個明確比率欄」的前提，
  // 抹平了就會把過半的上市配股公司誤判成「公式不齊」。
  assert.notEqual(twse.get("2412")[0].stockRatio, tpex.get("2640")[0].stockRatio);
});

test("單筆超過 1000% 要記 warning（真實市場幾乎不可能）", () => {
  const warnings = [];
  const rows = [
    // 上游若改成「每仟股 100 股」，這個欄位會回 100 而不是 0.1。
    { Date: "1150730", Code: "1231", Name: "聯華食", Exdividend: "權息", StockDividendRatio: "100", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "1.5" },
  ];
  const { archiveMap } = normalizeDividendMarketRows("TWSE", rows, TODAY, warnings);
  assert.equal(warnings.length, 1, "必須要有告警");
  assert.match(warnings[0], /1231/, "要指名是哪一檔");
  assert.match(warnings[0], /每仟股/, "要講出最可能的原因，否則使用者不知道該查什麼");
  // 刻意**不** throw：真的出現合法的大額配股時，把整個市場的資料丟掉比算錯更糟。
  assert.equal(archiveMap.get("1231")[0].stockRatio, 100, "值照樣留著，由下游判成未定案");
});

// ===== 2026-08-21 重新校準（D-53）=====
// 門檻 1 是 2026-07-27 那次量測的**樣本上限**（29 筆最大 0.5）被當成了領域性質。
// 真實市場會出現超過 100% 的無償配股，2026-08-21 由 `npm run test:live` 抓到三筆，
// 並用官方參考價反推驗證過其中一筆（TPEx 5314 世紀*，除權日 2026-08-14 已過）：
//   前收 61.30 ÷ (1 + 3.15702936) = 14.746，官方參考價 14.75（8/14 收 16.20 − 漲跌 1.45）。
// 誤差 0.004 → 比率確實是比率，公式在 >1 完全成立，1 這個位置沒有任何不連續。
test("真實的大額配股（實測 3.157）不得被判成不可信", () => {
  const warnings = [];
  const rows = [
    // 值與代號取自 TPEx tpex_exright_prepost 的 2026-08-21 實際回傳。
    { ExRrightsExDividendDate: "1150814", SecuritiesCompanyCode: "5314", CompanyName: "世紀*", ExRrightsExDividend: "除權", StockDividendRatio: "3.15702936", SubscriptionRatioToNewSharesIssued: "0.00000000", SubscriptionPricePerShare: "0.00", CashDividend: "0.00000000" },
  ];
  const { archiveMap } = normalizeDividendMarketRows("TPEx", rows, TODAY, warnings);
  assert.deepEqual(warnings, [], "已用官方參考價驗證過的真實事件不可觸發告警");
  const event = { ...archiveMap.get("5314")[0], formulaComplete: true };

  // 股數倍數：1 + 3.157 = 4.157。這是舊門檻真正擋掉的東西（成交量還原與 Yahoo 座標換算）。
  assert.ok(Math.abs(mod.plausibleShareFactor(event) - 4.15702936) < 1e-6, "股數倍數要算得出來");

  // 價格因子：拿官方數字反推。前收 61.30、官方參考價 14.75 → 因子 14.75/61.30。
  const ratio = mod.officialCorporateActionRatio(event, 61.30);
  assert.ok(ratio !== null, "公式要算得出比率");
  assert.ok(
    Math.abs(61.30 * ratio - 14.75) < 0.01,
    `套公式算出的參考價 ${(61.30 * ratio).toFixed(3)} 必須對得上官方公布的 14.75`,
  );
});

test("合理範圍內不得誤報（含 2026-08 實測的 3.157，門檻 10）", () => {
  const warnings = [];
  normalizeDividendMarketRows("TPEx", tpexRows, TODAY, warnings);
  assert.deepEqual(warnings, [], "0.5 是常見量級，不可誤報");
  assert.equal(DIVIDEND_RATIO_MAX_PLAUSIBLE, 10);
});

// 單筆超標＝罕見但合法；整份分佈一起位移＝上游換單位。這是兩件事，需要兩個偵測器。
// 舊設計用同一個閾值兼差，於是把 315% 的真實配股誤報成單位改版。
test("分佈整體位移才是單位改版：中位數 ≥ 1 要喊出來", () => {
  const warnings = [];
  // 模擬上游把比率換成每仟股股數：每個值都乘 1000。
  const shifted = Array.from({ length: 10 }, (_, index) => ({
    Date: "1150730",
    Code: String(1200 + index),
    Name: `測試${index}`,
    Exdividend: "權",
    StockDividendRatio: String((0.01 + index * 0.05) * 1000),
    SubscriptionRatio: "",
    SubscriptionPricePerShare: "",
    CashDividend: "0",
  }));
  normalizeDividendMarketRows("TWSE", shifted, TODAY, warnings);
  assert.ok(warnings.some((w) => /整份分佈/.test(w)), `分佈位移必須有專屬告警：${JSON.stringify(warnings)}`);
  assert.ok(warnings.some((w) => /每仟股/.test(w)), "要指向單位這個原因");
});

test("一筆離群值不算單位改版：主體仍是比率量級就不得誤報分佈告警", () => {
  const warnings = [];
  // 照 2026-08-21 TWSE 的真實形狀：25 筆小值 ＋ 1 筆 1.98。
  const realistic = Array.from({ length: 9 }, (_, index) => ({
    Date: "1150730",
    Code: String(1300 + index),
    Name: `測試${index}`,
    Exdividend: "權",
    StockDividendRatio: String(0.01 + index * 0.05),
    SubscriptionRatio: "",
    SubscriptionPricePerShare: "",
    CashDividend: "0",
  }));
  realistic.push({
    Date: "1150902", Code: "6669", Name: "緯穎", Exdividend: "權",
    StockDividendRatio: "1.98279460", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "0",
  });
  normalizeDividendMarketRows("TWSE", realistic, TODAY, warnings);
  assert.deepEqual(warnings, [], `一筆離群值不是單位改版：${JSON.stringify(warnings)}`);
});

// ---- D-44 第二點：同一代號同一除權息日多列 ----
//
// appendDividendHistoryNow 寫的是 slot[exDate]，**後者覆蓋前者**。若上游把除權息拆成
// 「除權一列＋除息一列」，參考價就會只用半個事件算出來，而且蓋著 formulaComplete=true
// 與 official 章，沒有任何告警。
// 2026-07-27 實測：TWSE 125 列＋TPEx 138 列，(代號, 除權息日) 全部唯一、0 組重複。
// 所以這是防禦性偵測不是已觀察到的錯誤——但失效時是無聲的錯答案，值得擋。

test("同一代號同一天多列 → 記 warning 並全部標成 duplicateRows", () => {
  const warnings = [];
  const split = [
    // 假想的拆列：同一天、同一代號，一列只有配股、一列只有現金。
    { Date: "1150730", Code: "1231", Name: "聯華食", Exdividend: "權", StockDividendRatio: "0.09999999", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "" },
    { Date: "1150730", Code: "1231", Name: "聯華食", Exdividend: "息", StockDividendRatio: "", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "1.5" },
  ];
  const { archiveMap } = normalizeDividendMarketRows("TWSE", split, TODAY, warnings);
  assert.equal(warnings.length, 1, "多列必須喊出來——覆蓋是靜默的");
  assert.match(warnings[0], /1231/, "要指名是哪一檔哪一天");
  assert.match(warnings[0], /2 列/);
  const list = archiveMap.get("1231");
  assert.equal(list.length, 2, "兩列都要留著，不可自己挑一列");
  assert.ok(list.every((item) => item.duplicateRows === true), "兩列都要標記，否則覆蓋後的那筆看起來是乾淨的");
});

test("同一代號不同天的多筆事件是正常的，不得誤報", () => {
  const warnings = [];
  const twoDates = [
    { Date: "1150730", Code: "1231", Name: "聯華食", Exdividend: "權息", StockDividendRatio: "0.09999999", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "1.5" },
    { Date: "1150820", Code: "1231", Name: "聯華食", Exdividend: "息", StockDividendRatio: "", SubscriptionRatio: "", SubscriptionPricePerShare: "", CashDividend: "0.8" },
  ];
  const { archiveMap } = normalizeDividendMarketRows("TWSE", twoDates, TODAY, warnings);
  assert.deepEqual(warnings, [], "一家公司一年配息兩次是常態，不是異常");
  assert.ok(archiveMap.get("1231").every((item) => !item.duplicateRows));
});

test("實機資料不得觸發：263 列真實 payload 的 (代號, 除權息日) 全部唯一", () => {
  const warnings = [];
  normalizeDividendMarketRows("TWSE", twseRows, TODAY, warnings);
  normalizeDividendMarketRows("TPEx", tpexRows, TODAY, warnings);
  assert.deepEqual(warnings, [], "照抄自實機的 fixture 不該觸發任何告警");
});

// 這條才是真正載重的：標記要一路傳到歸檔，讓還原引擎當成算不出來。
// 光是記 warning 沒有用——slot[exDate] 的覆蓋還是會留下一個看起來乾淨的半個事件。
test("多列標記要傳到歸檔：該事件必須是 formulaComplete=false", async () => {
  const split = new Map([["1231", [
    { exDate: "20260730", kind: "除權", cashDividend: null, stockRatio: 0.1, subscriptionRatio: null, subscriptionPrice: null, source: "TWSE", duplicateRows: true },
    { exDate: "20260730", kind: "除息", cashDividend: 1.5, stockRatio: null, subscriptionRatio: null, subscriptionPrice: null, source: "TWSE", duplicateRows: true },
  ]]]);
  await mod.appendDividendHistory(split, { successfulSources: ["TWSE"] });
  const [event] = mod.corporateActionHistoryForCode("1231", "20260730", "20260730");
  assert.ok(event, "事件要有被寫進歸檔");
  assert.equal(event.formulaComplete, false, "多列時不可宣稱公式齊全——後者覆蓋前者已丟掉一半");
  // officialCorporateActionRatio 對 formulaComplete=false 一律回 null，
  // 所以還原端會走 unresolved 而不是拿半個事件算出參考價。
  assert.equal(mod.officialCorporateActionRatio(event, 31.35), null, "算不出比率才是正確結果");
});

test("單列（正常）時 formulaComplete 照常為 true，防線不可過度收緊", async () => {
  const single = new Map([["1232", [
    { exDate: "20260730", kind: "除權息", cashDividend: 1.5, stockRatio: 0.1, subscriptionRatio: null, subscriptionPrice: null, source: "TWSE" },
  ]]]);
  await mod.appendDividendHistory(single, { successfulSources: ["TWSE"] });
  const [event] = mod.corporateActionHistoryForCode("1232", "20260730", "20260730");
  assert.equal(event.formulaComplete, true);
  assert.ok(Number.isFinite(mod.officialCorporateActionRatio(event, 31.35)), "正常事件仍要算得出比率");
});
