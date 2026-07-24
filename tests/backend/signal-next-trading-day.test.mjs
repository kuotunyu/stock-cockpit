// 隔日驗證必須使用唯一下一交易日，App 跳過數日也不能拿重新開啟當天；缺精確日K就 pending。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, rocCompact, stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

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
const rocSlash = (day) => {
  const roc = rocCompact(day);
  return `${roc.slice(0, 3)}/${roc.slice(3, 5)}/${roc.slice(5, 7)}`;
};
const historyRow = (day, open, high, low, close) => [
  rocSlash(day), "5,000,000", String(close * 5_000_000), String(open), String(high), String(low), String(close), "1", "3,000",
];

const TODAY = compactToday(0);
const D1 = previousWeekday(TODAY);
const D0 = previousWeekday(D1);
const { mod, mock, dataDir } = await importServer({
  routes: [
    {
      match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/,
      reply: [
        stockDayAllRow({ code: "2330", name: "台積電", close: 120 }),
        stockDayAllRow({ code: "1101", name: "台泥", close: 50 }),
      ],
    },
    {
      match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/,
      reply: [tpexDailyCloseRow({ code: "5347", name: "世界", close: 80 })],
    },
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: [{ Date: rocCompact(D1) }, { Date: rocCompact(TODAY) }] },
    { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: [{ Name: "元旦", Date: `${TODAY.slice(0, 4) - 1911}0101`, Description: "依規定放假" }] },
    {
      match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
      reply: (url) => {
        const code = url.searchParams.get("stockNo");
        if (code === "2330") return { stat: "OK", data: [historyRow(D1, 103, 104, 97, 102), historyRow(TODAY, 119, 122, 118, 120)] };
        if (code === "1101") return { stat: "OK", data: [historyRow(TODAY, 49, 51, 48, 50)] };
        return { stat: "OK", data: [] };
      },
    },
  ],
});

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const pick = (code, name, price) => ({
  code, name, exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", score: 80, price, changePct: 3,
});

async function setSnapshot(picks) {
  const db = await mod.loadDb();
  db.signalSnapshots = [{ asOf: toIso(D0), savedAt: "", coverage: { complete: true }, picks }];
  await mod.saveDb(db);
}

test("跳過數日才開 App，仍使用 D1 而不是今天", async () => {
  await setSnapshot([pick("2330", "台積電", 100)]);
  const body = await mod.buildSignalVerification();
  assert.equal(body.available, true);
  assert.equal(body.status, "final");
  assert.equal(body.observationDate, toIso(D1));
  assert.equal(body.rows[0].currentPrice, 102, "必須用 D1 收盤，不可用今天 reference 的 120");
  assert.equal(body.rows[0].highReturn, 4);
  assert.equal(body.rows[0].lowReturn, -3);
});

test("canonical=D1，但個股只有今天的棒 → pending，不可滾到較晚日期", async () => {
  await setSnapshot([pick("1101", "台泥", 40)]);
  const body = await mod.buildSignalVerification();
  assert.equal(body.available, false);
  assert.equal(body.status, "pending");
  assert.equal(body.observationDate, toIso(D1));
  assert.equal(body.verifiedSignals, 0);
  assert.equal(body.pendingSignals, 1);
});

