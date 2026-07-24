// 台股時鐘與交易時段判斷（控制 10 秒自動刷新的開關）：一律用 UTC 建 Date，
// 測試不依賴主機時區；2026-07-02 是週四、07-04 週六。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const clock = (isoUtc) => JSON.parse(app.evalIn(`JSON.stringify(getTaiwanClockParts(new Date(${JSON.stringify(isoUtc)})))`));
const stockOpen = (isoUtc) => app.evalIn(`isTaiwanMarketSession(new Date(${JSON.stringify(isoUtc)}))`);
const nightOpen = (isoUtc) => app.evalIn(`isTaiwanFuturesNightSession(new Date(${JSON.stringify(isoUtc)}))`);

test("getTaiwanClockParts：UTC 換算台北時區（+8）、跨日與週界正確", () => {
  assert.deepEqual(clock("2026-07-02T01:00:00Z"), { isoDate: "2026-07-02", weekday: 4, minutes: 9 * 60 });
  // UTC 週三 20:00 = 台北週四 04:00（跨日也要跨週界）
  assert.deepEqual(clock("2026-07-01T20:00:00Z"), { isoDate: "2026-07-02", weekday: 4, minutes: 4 * 60 });
});

test("getTaiwanIsoDate：台北午夜邊界不受瀏覽器所在時區影響", () => {
  assert.equal(app.evalIn('getTaiwanIsoDate(new Date("2026-07-12T15:59:59Z"))'), "2026-07-12");
  assert.equal(app.evalIn('getTaiwanIsoDate(new Date("2026-07-12T16:00:00Z"))'), "2026-07-13");
});

test("isTaiwanMarketSession：09:00–13:35 含邊界；開盤前/收盤後/週末 false", () => {
  assert.equal(stockOpen("2026-07-02T00:59:00Z"), false, "08:59 未開盤");
  assert.equal(stockOpen("2026-07-02T01:00:00Z"), true, "09:00 開盤");
  assert.equal(stockOpen("2026-07-02T05:35:00Z"), true, "13:35 仍在收盤緩衝內");
  assert.equal(stockOpen("2026-07-02T05:36:00Z"), false, "13:36 收攤");
  assert.equal(stockOpen("2026-07-04T02:00:00Z"), false, "週六不開盤");
});

test("isTaiwanMarketSession：平日官方休市 false，特殊週末補交易可由日曆覆寫", () => {
  assert.equal(app.evalIn(`(() => {
    marketSessionState.stock = { date: "2026-07-02", tradingDay: false, holidayName: "測試休市" };
    const result = isTaiwanMarketSession(new Date("2026-07-02T02:00:00Z"));
    marketSessionState.stock = null;
    return result;
  })()`), false, "週四 10:00 但官方休市");
  assert.equal(app.evalIn(`(() => {
    marketSessionState.stock = { date: "2026-07-04", tradingDay: true };
    const result = isTaiwanMarketSession(new Date("2026-07-04T02:00:00Z"));
    marketSessionState.stock = null;
    return result;
  })()`), true, "特殊週六補交易可覆寫週末 fallback");
  assert.equal(app.evalIn(`(() => {
    marketSessionState.stock = { date: "2026-07-02", tradingDay: false };
    const result = isTaiwanFuturesNightSession(new Date("2026-07-02T07:30:00Z"));
    marketSessionState.stock = null;
    return result;
  })()`), true, "現貨休市 metadata 不得直接關掉獨立的期貨夜盤候選時段");
});

test("策略頁與技術價標籤共用 13:35 邊界，不會在 13:31 提早顯示收盤", () => {
  for (const helper of ["isTaiwanMarketOpenNow", "isTaiwanRegularSession"]) {
    assert.equal(app.evalIn(`${helper}(new Date("2026-07-02T05:34:00Z"))`), true, `${helper} 13:34`);
    assert.equal(app.evalIn(`${helper}(new Date("2026-07-02T05:36:00Z"))`), false, `${helper} 13:36`);
  }
});

test("isTaiwanFuturesNightSession：15:00 起算、凌晨 05:00 收；凌晨時段屬前一交易日夜盤", () => {
  assert.equal(nightOpen("2026-07-02T07:00:00Z"), true, "台北週四 15:00 夜盤開始");
  assert.equal(nightOpen("2026-07-02T06:59:00Z"), false, "14:59 還沒到");
  assert.equal(nightOpen("2026-07-06T20:00:00Z"), true, "台北週二凌晨 04:00＝週一夜盤的尾巴");
  assert.equal(nightOpen("2026-07-05T20:00:00Z"), false, "台北週一凌晨 04:00 沒有夜盤（週日晚上不開）");
  assert.equal(nightOpen("2026-07-02T21:30:00Z"), false, "台北週五 05:30 已收夜盤");
});

test("getOvernightDateLabels：只採同訊號日的後端實際下一交易日，不用今天亂猜", () => {
  const pending = JSON.parse(app.evalIn(`(() => {
    overnightState.asOf = "2026-07-10"; // 週五
    verifyState.data = null;             // 週末開啟，尚未拿到交易日證據
    return JSON.stringify(getOvernightDateLabels());
  })()`));
  assert.equal(pending.observationDate, "");
  assert.equal(pending.observationLabel, "下一交易日（待官方確認）");

  const exact = JSON.parse(app.evalIn(`(() => {
    overnightState.asOf = "2026-07-10";
    verifyState.data = { signalDate: "2026-07-10", observationDate: "2026-07-13" };
    return JSON.stringify(getOvernightDateLabels());
  })()`));
  assert.equal(exact.observationDate, "2026-07-13");
  assert.ok(exact.observationLabel.includes("07/13"));

  const staleVerify = JSON.parse(app.evalIn(`(() => {
    overnightState.asOf = "2026-07-14";
    verifyState.data = { signalDate: "2026-07-10", observationDate: "2026-07-13" };
    return JSON.stringify(getOvernightDateLabels());
  })()`));
  assert.equal(staleVerify.observationDate, "", "舊清單的驗證日期不可洩漏到新訊號日");
});
