// 盤中隔日驗證只接受 observationDate 當日 MIS 原始 O/H/L；昨收 fallback 不可冒充觀察日行情。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, rocCompact, stockDayAllRow, tpexDailyCloseRow, misQuoteRow } from "../helpers/fixtures.mjs";

const toIso = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
const previousWeekday = (before) => {
  const date = new Date(Number(before.slice(0, 4)), Number(before.slice(4, 6)) - 1, Number(before.slice(6, 8)));
  for (;;) {
    date.setDate(date.getDate() - 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    }
  }
};
const TODAY = compactToday(0);
const SIGNAL = previousWeekday(TODAY);
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

test("盤中精確日 MIS 可 provisional 驗證，缺原始 O/H/L 的檔位維持 pending", async () => {
  const db = await mod.loadDb();
  db.signalSnapshots = [{
    asOf: toIso(SIGNAL), savedAt: "", coverage: { complete: true },
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

