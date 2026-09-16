// 2026-09-16 使用者問「為什麼注意？要注意什麼？」：注意股標籤以前只有代號，交易所公布的「注意交易資訊」原文
// （例：最近六個營業日累積漲幅達 27.11%…(第三款)）雖然抓了卻沒帶到每檔的 surveillance。這裡鎖住：
// 風險名單條目 `code|累計次數|公布日|理由`、舊的純代號條目相容、getRiskSets 帶理由、看板單檔查詢帶理由與連續天數。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { surveillanceRoutes, stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

const TWSE_ROW = {
  Number: "1", Code: "2330", Name: "台積電", NumberOfAnnouncement: "2",
  TradingInfoForAttention: "當日週轉率達 10.03%(第六款)", Date: "1150724", ClosingPrice: "1180.00", PE: "31.20",
};
const TPEX_ROW = {
  Date: "1150916", SecuritiesCompanyCode: "6148", CompanyName: "驊宏資",
  TradingInformation: "最近六個營業日(含當日)累積之最後成交價漲幅達27.11%，當日之成交量較最近六十個營業日日平均成交量放大27.02倍(第三款)當日週轉率達46%(第四款)",
  ClosePrice: "36.65", PriceEarningRatio: "33.94",
};

const { mod, mock, dataDir } = await importServer({
  routes: [
    ...surveillanceRoutes({
      reference: [stockDayAllRow({ code: "2330", name: "台積電", close: 1180 })],
      tpexReference: [tpexDailyCloseRow({ code: "6148", name: "驊宏資", close: 36.65 })],
      twseNotice: [TWSE_ROW],
      tpexWarning: [TPEX_ROW],
    }),
  ],
});
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test("attentionEntry／attentionInfoFromEntry：理由放最後一段，裡面有 | 也不會切壞；舊純代號條目理由留空、次數 1", () => {
  const entry = mod.attentionEntry("6148", "3", "1150916", "  甲|乙  丙 ");
  assert.equal(entry, "6148|3|20260916|甲|乙 丙");
  const base = { kind: "attention", label: "注意", note: "" };
  assert.deepEqual(mod.attentionInfoFromEntry(base, entry.split("|")), { kind: "attention", label: "注意", note: "", count: 3, noticeDate: "20260916", reason: "甲|乙 丙" });
  assert.deepEqual(mod.attentionInfoFromEntry(base, ["6148"]), { kind: "attention", label: "注意", note: "", count: 1, noticeDate: "", reason: "" }, "舊 risk-cache 的純代號");
  assert.equal(mod.attentionEntry("ABC", 1, "", "x"), null, "非四碼代號丟掉");
  assert.equal(mod.attentionEntry("2330", "0", "junk", ""), "2330|1||", "次數至少 1、日期解析不出來留空");
});

test("getRiskSets：上市／上櫃注意股都帶官方理由、累計次數與公布日；riskSets.surveillance 直接可給每檔用", async () => {
  const risk = await mod.getRiskSets();
  const twse = risk.surveillance.get("2330");
  assert.equal(twse.kind, "attention");
  assert.equal(twse.count, 2);
  assert.equal(twse.reason, "當日週轉率達 10.03%(第六款)");
  assert.equal(twse.noticeDate, "20260724");
  const tpex = risk.surveillance.get("6148");
  assert.equal(tpex.kind, "attention");
  assert.equal(tpex.count, 1);
  assert.match(tpex.reason, /累積之最後成交價漲幅達27\.11%/);
  assert.match(tpex.reason, /第四款/);
  assert.equal(tpex.noticeDate, "20260916");
});

test("lookupStockSurveillance：看板單檔查詢帶理由、累計次數與連續天數", () => {
  const board = { aboutToDispose: [], inDisposition: [], aboutToRelease: [], changedTrading: [],
    attention: [{ code: "6148", count: 1, reason: TPEX_ROW.TradingInformation, noticeDate: "20260916", daysOnList: 2 }] };
  const info = mod.lookupStockSurveillance("6148", board);
  assert.equal(info.kind, "attention");
  assert.equal(info.reason, TPEX_ROW.TradingInformation);
  assert.equal(info.daysOnList, 2);
  assert.equal(info.noticeDate, "20260916");
  assert.equal(mod.lookupStockSurveillance("2330", board), null);
});
