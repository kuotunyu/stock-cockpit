// 成績單 final 觀察結果落盤：快照留 260 份之後，每次重建都重觀察全部日子＝每次重抓全部觀察日行情
//（~5,000 個 code:month 鍵 > historyCache 4,096，冷重建 8～20 分鐘，抓失敗的日子還會從分母消失）。
// final 且 complete 的觀察結果不會再變，寫回快照；之後重建只重觀察 pending／partial 的日子。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, compactToday, compactTradingDay, rocCompact } from "../helpers/fixtures.mjs";

const iso = (compact) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
const DAY_SHIFT = compactTradingDay(0).slice(4) === "0101" ? -1 : 0;
const TODAY = compactTradingDay(DAY_SHIFT);
const D1 = compactTradingDay(DAY_SHIFT - 1); // 觀察日（訊號 D2 的下一個交易日）
const D2 = compactTradingDay(DAY_SHIFT - 2); // 訊號日
const MOCK_HOLIDAY_ROC_YEAR = Number(compactToday(0).slice(0, 4)) - 1911;
const roc = (compact) => `${Number(compact.slice(0, 4)) - 1911}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;

let mod;
let mock;
before(async () => {
  ({ mod, mock } = await importServer({
    routes: [
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: () => [{ ...stockDayAllRow({ code: "2330", name: "台積電", close: 105 }), Date: rocCompact(TODAY) }] },
      { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: () => [] },
      { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({ msgArray: [] }) },
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: () => [{ Date: rocCompact(D2) }, { Date: rocCompact(D1) }, { Date: rocCompact(TODAY) }] },
      { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: () => [{ Name: "中華民國開國紀念日", Date: `${MOCK_HOLIDAY_ROC_YEAR}0101`, Weekday: "四", Description: "依規定放假1日。" }] },
      // 逐檔月歷史：D1 那一根 開 103 高 104 低 97 收 102（對訊號價 100：達標＋破線、收盤 +2%）
      { match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: (url) => {
        if (url.searchParams.get("stockNo") !== "2330") return { stat: "OK", data: [] };
        const month = String(url.searchParams.get("date") || "").slice(0, 6);
        const rows = [];
        if (month === D1.slice(0, 6)) rows.push([roc(D1), "5,000,000", "510,000,000", "103", "104", "97", "102", "2", "3,000"]);
        if (month === TODAY.slice(0, 6)) rows.push([roc(TODAY), "5,000,000", "520,000,000", "104", "106", "103", "105", "3", "3,000"]);
        return { stat: "OK", data: rows };
      } },
      { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: () => [] },
      { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: () => [] },
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/TWT48U_ALL/, reply: () => [] },
      { match: /tpex\.org\.tw\/openapi\/v1\/tpex_exright_prepost/, reply: () => [] },
      { match: /www\.twse\.com\.tw\/exchangeReport\/TWT49U/, reply: () => ({ stat: "OK", data: [] }) },
    ],
  }));
});

const pick = (price) => ({ code: "2330", name: "台積電", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", score: 80, price, changePct: 5 });

test("final 且 complete 的觀察結果寫回快照；重建時不再重觀察它，上游壞掉也不影響已落盤的日子", async () => {
  const db = await mod.loadDb();
  db.signalSnapshots = [
    { asOf: iso(D2), savedAt: "", formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [pick(100)] },
    { asOf: iso(TODAY), savedAt: "", formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, picks: [pick(105)] },
  ];
  await mod.saveDb(db);

  const first = await mod.buildVerificationHistory();
  const done = first.records.find((record) => record.asOf === iso(D2));
  assert.ok(done?.complete, JSON.stringify(first.records));
  assert.equal(done.hitPlus2, 1);
  assert.equal(done.avgCloseReturn, 2);
  assert.equal(first.records.find((record) => record.asOf === iso(TODAY)).pending, true);

  const stored = (await mod.loadDb()).signalSnapshots;
  const memo = stored.find((item) => item.asOf === iso(D2)).observationRevisions[0];
  assert.ok(memo, "complete 的觀察結果要寫回快照");
  assert.equal(memo.kind, "retrospective-observation");
  assert.equal(memo.identity.cohortPolicyVersion, "legacy-unknown");
  assert.equal(memo.identity.evaluationVersion, "overnight-price-observation-v1");
  assert.equal(stored.find((item) => item.asOf === iso(D2)).observed, undefined);
  assert.equal(memo.complete, true);
  assert.equal(memo.status, "final");
  assert.equal(memo.observationDate, iso(D1));
  assert.equal(memo.rows.length, 1);
  assert.equal(memo.rows[0].hitPlus2, true);
  assert.equal(stored.find((item) => item.asOf === iso(TODAY)).observed, undefined, "pending 的不落盤");

  // 上游壞掉＋歷史快取清空：沒有落盤的話這一天會退成 pending／unverified，從分母消失。
  const remove = mock.override({ match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: { __error: "STOCK_DAY down" } });
  mod.resetHistoryCacheForTest();
  mod.invalidateVerifyHistoryCacheForTest();
  const second = await mod.buildVerificationHistory();
  remove();
  const again = second.records.find((record) => record.asOf === iso(D2));
  assert.equal(again.complete, true, "已落盤的日子不受上游影響");
  assert.equal(again.hitPlus2, 1);
  assert.equal(again.avgCloseReturn, 2);
  assert.equal(second.totals.days, 1);
});
