// D-40：零股不適用現股當沖，所以不足一個交易單位（1,000 股）的配對股數不得享 1.5‰ 減半。
//
// 法源（2026-07-26 查證官方原文）：
//   《證券交易稅條例》§2-2：「自中華民國一百零六年四月二十八日起至一百十六年十二月三十一日止
//     同一證券商受託買賣…按每次交易成交價格依千分之一點五稅率課徵…適用前項規定稅率之股票交易，
//     應依金融主管機關、證券交易所、證券櫃檯買賣中心訂定之**有價證券當日沖銷交易作業相關規定**
//     辦理。」→ 作業辦法被稅法引用，違反它就不適用減半。
//   《有價證券當日沖銷交易作業辦法》§1 第 4 項：「**零股**、鉅額買賣、依證券交易所營業細則
//     第七十四條之交易…**不適用本辦法**。」TWSE「當日沖銷交易專區」同文。
//
// ⚠ 「必須是 1,000 的整數倍」是從上面兩條推出來的（法規沒有直接這樣寫）：普通交易與盤後定價
//   的買賣單位都是 1,000 股，而零股的定義就是不足一個交易單位。所以這裡刻意**只做保守估稅
//   ＋標記待覆核，不硬擋輸入**——券商實際稅額永遠優先，擋掉合法輸入的代價比高估稅額大。
//
// 順帶釘住兩件查證結果，避免後人「修」錯：
//   • 盤後定價交易**可以**當沖（作業辦法 §1 第 3 項明文允許與普通交易反向沖銷），不該被擋。
//   • 優惠期間到民國 116 年（西元 2027）12 月 31 日。網路上仍有「到 2026 年底」的說法，
//     那是舊版修法，已再次延長。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

const rule = (over = {}) => mod.computeTradeTaxRule({
  side: "sell", price: 100, shares: 1000, date: "20260710", instrumentType: "stock", ...over,
});

test("零股股數不得享當沖減半：500 股全額按 3‰", () => {
  const r = rule({ shares: 500, dayTrade: { status: "brokerConfirmed", matchedShares: 500 } });
  assert.equal(r.dayTradeShares, 0, "不足一個交易單位 → 沒有任何股數合格");
  assert.equal(r.amount, 150, "500 股 × 100 元 × 3‰ = 150（舊行為會算成 75）");
  assert.equal(r.rate, 0.003);
  assert.equal(r.ruleId, "tw-stock-general-0.003", "沒有合格股數就不該蓋當沖 rule id");
  assert.match(r.warnings.join(" "), /零股不適用現股當沖/, "要說明為什麼沒給減半");
});

test("整股部分給減半、零股部分不給：2,500 股拆成 2,000 ＋ 500", () => {
  const r = rule({ shares: 2500, dayTrade: { status: "brokerConfirmed", matchedShares: 2500 } });
  assert.equal(r.dayTradeShares, 2000, "向下取到整數個交易單位");
  // 2,000 × 100 × 1.5‰ = 300；500 × 100 × 3‰ = 150
  assert.equal(r.amount, 450);
  assert.equal(r.rate, null, "混合稅率不可偽裝成單一 rate");
  assert.match(r.warnings.join(" "), /500 股按一般稅率/, "要講清楚有幾股沒享到");
});

test("剛好整數倍時完全不受影響，也不得產生假警告", () => {
  for (const shares of [1000, 2000, 10000]) {
    const r = rule({ shares, dayTrade: { status: "brokerConfirmed", matchedShares: shares } });
    assert.equal(r.dayTradeShares, shares, `${shares} 股要全額享減半`);
    assert.equal(r.rate, 0.0015);
    assert.equal(r.ruleId, "tw-stock-daytrade-20170428-20271231");
    assert.ok(
      !r.warnings.some((w) => /零股|整數倍/.test(w)),
      `整股交易不該亮零股警告（實際 ${JSON.stringify(r.warnings)}）`,
    );
  }
});

test("非零股原因造成的不合格不受這條影響（期間外仍是期間外）", () => {
  const r = rule({ date: "20160101", dayTrade: { status: "brokerConfirmed", matchedShares: 1000 } });
  assert.equal(r.dayTradeShares, 0);
  assert.match(r.warnings.join(" "), /不在現股當沖減半課稅期間/);
  assert.ok(!r.warnings.some((w) => /零股/.test(w)), "1,000 股是整股，不該同時亮零股警告");
});

test("未確認當沖時本來就沒有減半，不該多亮零股警告", () => {
  for (const status of ["none", "legacyDeclared"]) {
    const r = rule({ dayTrade: { status, matchedShares: 0 } });
    assert.equal(r.dayTradeShares, 0);
    assert.ok(!r.warnings.some((w) => /零股/.test(w)), `${status} 不該亮零股警告`);
  }
});

test("零股警告會變成待覆核理由，讓使用者拿對帳單核對", () => {
  const input = {
    schemaVersion: 2,
    settings: { feeDiscount: 0.6, minFee: 20 },
    records: [{
      id: "t1", code: "2330", market: "TWSE", instrumentType: "stock", instrumentSource: "user",
      side: "sell", date: "20260710", tradeDate: "20260710", session: "regular",
      brokerAccountId: "default", currency: "TWD", price: 100, shares: 500,
      dayTrade: { status: "brokerConfirmed", matchedShares: 500, pairId: "" },
    }],
  };
  const record = mod.normalizeTradesPayload(input, { todayCompact: "20260713" }).records[0];
  assert.equal(record.tax, 150, "估稅要按 3‰，不可靜默給 75");
  assert.equal(record.reviewStatus, "needsReview", "要請使用者覆核，而不是當成已確認");
  assert.match(record.reviewReasons.join(" "), /零股不適用現股當沖/);
});

test("盤後定價交易可以當沖——不得順手把它擋掉", () => {
  // 作業辦法 §1 第 3 項：「以普通交易收盤前之買賣間**及普通交易收盤前之買賣與盤後定價交易間**
  // 之反向沖銷者為限」。所以賣出腿是盤後定價是合法的當沖態樣。
  const ok = mod.validateTradesMutationInput({
    schemaVersion: 2,
    settings: { feeDiscount: 0.6, minFee: 20 },
    records: [{
      id: "t1", code: "2330", market: "TWSE", instrumentType: "stock", instrumentSource: "user",
      side: "sell", date: "20260710", tradeDate: "20260710", session: "afterHoursFixed",
      brokerAccountId: "default", currency: "TWD", price: 100, shares: 1000,
      dayTrade: { status: "brokerConfirmed", matchedShares: 1000, pairId: "" },
    }],
  }, "20260713");
  assert.equal(ok.ok, true, `盤後定價不該被擋：${JSON.stringify(ok.errors)}`);

  // 對照組：零股與鉅額是作業辦法明文排除的，維持硬擋
  for (const session of ["oddLot", "block"]) {
    const bad = mod.validateTradesMutationInput({
      schemaVersion: 2,
      settings: { feeDiscount: 0.6, minFee: 20 },
      records: [{
        id: "t1", code: "2330", market: "TWSE", instrumentType: "stock", instrumentSource: "user",
        side: "sell", date: "20260710", tradeDate: "20260710", session,
        brokerAccountId: "default", currency: "TWD", price: 100, shares: 1000,
        dayTrade: { status: "brokerConfirmed", matchedShares: 1000, pairId: "" },
      }],
    }, "20260713");
    assert.equal(bad.ok, false, `${session} 應該被擋`);
  }
});

test("優惠期間的邊界是民國 116 年 12 月 31 日（＝2027-12-31）", () => {
  const dt = { status: "brokerConfirmed", matchedShares: 1000 };
  assert.equal(rule({ date: "20271231", dayTrade: dt }).dayTradeShares, 1000, "最後一天含在內");
  assert.equal(rule({ date: "20280101", dayTrade: dt }).dayTradeShares, 0, "隔天起不適用");
  assert.equal(rule({ date: "20170428", dayTrade: dt }).dayTradeShares, 1000, "起日含在內");
  assert.equal(rule({ date: "20170427", dayTrade: dt }).dayTradeShares, 0, "起日前一天不適用");
});
