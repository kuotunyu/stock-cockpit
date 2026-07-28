// 盤中隔日驗證只接受 observationDate 當日 MIS 原始 O/H/L；昨收 fallback 不可冒充觀察日行情。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, compactTradingDay, rocCompact, stockDayAllRow, tpexDailyCloseRow, misQuoteRow } from "../helpers/fixtures.mjs";

const toIso = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
// 觀察日必須是「真實今天」——盤中 provisional 的前提就是今天還在交易。
// 訊號日是今天的前一個交易日（原本這裡自備了一份 previousWeekday，已收斂到 fixtures）。
const TODAY = compactToday(0);
const SIGNAL = compactTradingDay(-1);
// 週末／非交易日沒有「盤中」可言：引擎會正確地把前一個交易日判成 final，
// 這個情境本身不成立。與其偽造前提讓測試假通過，不如明確跳過並說明原因。
//
// 但「今天是交易日」只是前提的一半——**現在必須真的在盤中**。
// 舊守衛只檢查日期，於是這條測試在每個交易日的 00:00~09:00 與 13:35~24:00 都會失敗，
// 也就是交易日約 85% 的時間（2026-07-27 00:01 實際踩到：週一凌晨，日期已翻但離開盤還有 9 小時）。
// 它之所以長期沒被發現，是因為多數改動都在週末驗收，那時整條被 NON_TRADING_TODAY 跳過。
const taipeiHm = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit",
}).format(new Date());
const [taipeiHour, taipeiMinute] = taipeiHm.split(":").map(Number);
const taipeiMinutes = taipeiHour * 60 + taipeiMinute;
// 與 isTaiwanMarketSession 同一個區間：09:00–13:35（含收盤後最後一次撮合回報）。
const IN_SESSION = taipeiMinutes >= 9 * 60 && taipeiMinutes <= 13 * 60 + 35;
const NON_TRADING_TODAY = compactTradingDay(0) !== TODAY;
const SKIP_REASON = NON_TRADING_TODAY
  ? "今天不是交易日，沒有盤中觀察情境可測"
  : IN_SESSION ? false : `現在是台北 ${taipeiHm}，不在 09:00–13:35 盤中時段，這個情境本身不成立`;
const referenceTwse = [
  { ...stockDayAllRow({ code: "2330", name: "台積電", close: 100 }), Date: rocCompact(SIGNAL) },
  { ...stockDayAllRow({ code: "1101", name: "台泥", close: 40 }), Date: rocCompact(SIGNAL) },
];
const referenceTpex = [{ ...tpexDailyCloseRow({ code: "5347", name: "世界", close: 80 }), Date: rocCompact(SIGNAL) }];

const { mod, mock, dataDir } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: referenceTwse },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: referenceTpex },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: [{ Date: rocCompact(SIGNAL) }] },
    { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: [{ Name: "元旦", Date: `${TODAY.slice(0, 4) - 1911}0101`, Description: "依規定放假" }] },
    {
      match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/,
      reply: {
        msgArray: [
          misQuoteRow({ code: "2330", z: 103, y: 100, o: 101, h: 104, l: 99, dateOff: 0 }),
          misQuoteRow({ code: "1101", z: 41, y: 40, o: "-", h: "-", l: "-", dateOff: 0 }),
        ],
      },
    },
    { match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: { stat: "OK", data: [] } },
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: [] },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: [] },
  ],
});

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("盤中精確日 MIS 可 provisional 驗證，缺原始 O/H/L 的檔位維持 pending", {
  skip: SKIP_REASON,
}, async () => {
  const db = await mod.loadDb();
  db.signalSnapshots = [{
    asOf: toIso(SIGNAL), savedAt: "", coverage: { complete: true },
    // buildSignalVerification 第一步就過濾 overnightSnapshotFormulaVersion === 現行版本，
    // 而缺這個欄位時會退回 LEGACY_OVERNIGHT_FORMULA_VERSION（v1）→ 快照被整批濾掉
    // → available:false → 連 observationDate 都沒有。
    // 2026-07-26 把 OVERNIGHT_FORMULA_VERSION 從 v1 升到 v2 再升到 v3 時漏了這個 fixture。
    // 直接讀 mod 的常數，下次再升版就不會又踩一次。
    formulaVersion: mod.OVERNIGHT_FORMULA_VERSION,
    picks: [
      { code: "2330", name: "台積電", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 },
      { code: "1101", name: "台泥", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 40 },
    ],
  }];
  await mod.saveDb(db);
  const body = await mod.buildSignalVerification();
  assert.equal(body.observationDate, toIso(TODAY));
  assert.equal(body.observationPhase, "intraday");
  assert.equal(body.status, "partial");
  assert.equal(body.verifiedSignals, 1);
  assert.equal(body.pendingSignals, 1);
  assert.equal(body.complete, false, "盤中結果永遠不是正式完成");
  assert.equal(body.rows[0].code, "2330");
  assert.equal(body.rows[0].currentReturn, 3);
  assert.deepEqual(body.unverified.map((row) => row.code), ["1101"]);
});

