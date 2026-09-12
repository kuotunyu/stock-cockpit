// 籌碼標籤：法人買賣超、融資使用率／券資比、當沖比、即將除權息——只標示、不進評分。
// 當沖統計來自 TWSE TWTB4U（實測 2026-09-11：tables[0] 市場合計、tables[1] 逐檔）。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer({ routes: [] });

const TWTB4U = {
  stat: "OK", date: "20260911",
  tables: [
    { title: "115年09月11日 當日沖銷交易統計資訊", fields: ["當日沖銷交易總成交股數", "當日沖銷交易總成交股數占市場比重%"], data: [["2,073,499,000", "20.5"]] },
    { title: "115年09月11日 當日沖銷交易標的及成交量值", fields: ["證券代號", "證券名稱", "暫停現股賣出後現款買進當沖註記", "當日沖銷交易成交股數", "當日沖銷交易買進成交金額", "當日沖銷交易賣出成交金額"],
      data: [["00400A", "主動國泰動能高息", "", "6,293,000", "92,710,150", "92,924,660"], ["2330", "台積電", "Y", "12,000,000", "1,000", "1,000"], ["", "", "", "", "", ""]] },
  ],
};

test("parseDayTradeStatsPayload：認得逐檔表、千分位、暫停註記；stat 非 OK 或缺表回 null", () => {
  const records = mod.parseDayTradeStatsPayload(TWTB4U);
  assert.equal(records["2330"].dayTradeShares, 12000000);
  assert.equal(records["2330"].suspended, true);
  assert.equal(records["00400A"].dayTradeShares, 6293000);
  assert.equal(records["00400A"].suspended, false);
  assert.equal(records["00400A"].buyAmount, 92710150);
  assert.equal(Object.keys(records).length, 2, "空列不進來");
  assert.equal(mod.parseDayTradeStatsPayload({ stat: "很抱歉，沒有符合條件的資料!" }), null);
  assert.equal(mod.parseDayTradeStatsPayload({ stat: "OK", tables: [TWTB4U.tables[0]] }), null, "只有市場合計表不算");
});

test("buildChipTags：門檻、tone、asOf 與名詞連結；來源缺就少那一類；全部沒有就 null", () => {
  const sources = {
    asOf: "20260911",
    institutional: { date: "2026-09-11", records: { "2330": { foreignNet: 1234567, trustNet: -50000 }, "2317": { foreignNet: -300000, trustNet: 120000 } } },
    margin: { date: "2026-09-11", records: { "2330": { marginUsagePct: 65.4, shortMarginRatio: 12 }, "2317": { marginUsagePct: 45, shortMarginRatio: 31 } } },
    dayTrade: { date: "2026-09-11", records: { "2330": { dayTradeShares: 12000000, suspended: true }, "2317": { dayTradeShares: 1000000, suspended: false } } },
  };
  const tsmc = mod.buildChipTags(sources, "2330", 30000);
  const labels = tsmc.items.map((item) => `${item.key}:${item.label}:${item.tone}`);
  assert.deepEqual(labels, [
    "foreignNet:外資買超 1,235 張:up",
    "marginUsage:融資使用率 65%:warn",
    "dayTrade:當沖比 40%:warn",
    "dayTradeSuspended:暫停先賣後買當沖:info",
  ], labels.join(" | "));
  assert.equal(tsmc.items[0].asOf, "2026-09-11");
  assert.equal(tsmc.items[0].term, "三大法人（外資／投信／自營）");
  assert.deepEqual(tsmc.sources, { institutional: "2026-09-11", margin: "2026-09-11", dayTrade: "2026-09-11" });
  const hon = mod.buildChipTags(sources, "2317", 100000);
  assert.deepEqual(hon.items.map((item) => `${item.key}:${item.label}:${item.tone}`), [
    "foreignNet:外資賣超 300 張:down",
    "trustNet:投信買超 120 張:up",
    "marginUsage:融資使用率 45%:info",
    "shortRatio:券資比 31%:warn",
  ]);
  assert.equal(mod.buildChipTags(sources, "2317", 0).items.some((item) => item.key === "dayTrade"), false, "沒有成交張數就不算當沖比");
  assert.equal(mod.buildChipTags({ asOf: "20260911", institutional: null, margin: null, dayTrade: null }, "2330", 30000), null);
  assert.equal(mod.buildChipTags(sources, "9999", 100), null, "沒有任何來源有這檔 → null");
  assert.equal(mod.CHIP_THRESHOLDS.institutionalMinLots, 100);
});

test("dividendAheadFor：未來 10 天內最近的一筆；今天以前或太遠的不算", () => {
  const schedule = new Map([["2330", [
    { exDate: "20260901", kind: "cash-dividend", cashDividend: 4 },
    { exDate: "20260918", kind: "cash-dividend", cashDividend: 5, stockRatio: 0 },
    { exDate: "20261216", kind: "cash-dividend", cashDividend: 5 },
  ]]]);
  const ahead = mod.dividendAheadFor("2330", schedule, "20260912");
  assert.deepEqual(ahead, { exDate: "20260918", daysUntil: 6, kind: "cash-dividend", cashDividend: 5, stockRatio: 0 });
  assert.equal(mod.dividendAheadFor("2330", schedule, "20260930"), null, "10 天內沒有");
  assert.equal(mod.dividendAheadFor("2317", schedule, "20260912"), null);
  assert.equal(mod.dividendAheadFor("2330", null, "20260912"), null);
});

test("loadChipSources：上游全部抓不到（離線 tripwire）時四個來源都是 null，不丟錯", async () => {
  const sources = await mod.loadChipSources("20260911");
  assert.equal(sources.asOf, "20260911");
  assert.equal(sources.dayTrade, null);
  assert.equal(mod.buildChipTags(sources, "2330", 100), null);
});
