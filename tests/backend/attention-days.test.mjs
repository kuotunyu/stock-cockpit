// 2026-09-16：注意股「連 N 天」以前只有處置看板算（從技術分析頁進明細才看得到）；現在風險名單那條路也算，
// 清單頁／自選股點進明細都有。算法共用 consecutiveListDays：只沿相鄰排定交易日的歷史快照往回數，漏一天就斷。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { surveillanceRoutes, stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

const TWSE_ROW = { Number: "1", Code: "2330", Name: "台積電", NumberOfAnnouncement: "2", TradingInfoForAttention: "當日週轉率達 10.03%(第六款)", Date: "1150916", ClosingPrice: "1180.00", PE: "31.20" };
const TPEX_ROW = { Date: "1150916", SecuritiesCompanyCode: "6148", CompanyName: "驊宏資", TradingInformation: "當日週轉率達46%(第四款)", ClosePrice: "36.65", PriceEarningRatio: "33.94" };

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
// 2026-09-16 是週三：往回的排定交易日是 09-15（二）、09-14（一）、09-11（五，跨週末）、09-10（四）
await writeFile(join(dataDir, "surveillance-history.json"), JSON.stringify({
  "20260915": { attention: { "6148": 1, "2330": 1 }, disposition: [], changed: [], block: [], partial: [] },
  "20260914": { attention: { "6148": 1 }, disposition: [], changed: [], block: [], partial: [] },
  "20260911": { attention: { "6148": 1 }, disposition: [], changed: [], block: [], partial: [] },
  "20260909": { attention: { "6148": 1 }, disposition: [], changed: [], block: [], partial: [] }, // 09-10 缺快照 → 連續在這裡斷
}));
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test("consecutiveListDays：跨週末照數、缺一天快照就斷、今天本身算 1", () => {
  const history = {
    "20260915": { attention: { A: 1 } }, "20260914": { attention: { A: 1 } }, "20260911": { attention: { A: 1 } }, "20260909": { attention: { A: 1 } },
    "20260910": { disposition: ["B"] },
  };
  assert.equal(mod.consecutiveListDays(history, "20260916", [], "A", "attention"), 4, "09-16 本身 + 15、14、11（跨週末）；09-10 沒有 A → 斷");
  assert.equal(mod.consecutiveListDays(history, "20260916", [], "Z", "attention"), 1, "歷史沒出現過 → 只有今天");
  assert.equal(mod.consecutiveListDays({}, "20260916", [], "A", "attention"), 1, "沒有歷史快照 → 1");
  assert.equal(mod.consecutiveListDays(history, "20260911", [], "B", "disposition"), 2, "處置類看陣列；09-11 本身 + 09-10");
});

test("getRiskSets：清單頁用的 surveillance 也帶 daysOnList（與看板同算法）", async () => {
  const risk = await mod.getRiskSets("20260916");
  const tpex = risk.surveillance.get("6148");
  assert.equal(tpex.kind, "attention");
  assert.equal(tpex.daysOnList, 4, "09-16 + 15、14、11（跨週末）；09-10 缺快照斷在那裡（09-09 不算）");
  assert.equal(tpex.reason, "當日週轉率達46%(第四款)");
  const twse = risk.surveillance.get("2330");
  assert.equal(twse.daysOnList, 2, "09-16 + 09-15；09-14 沒有 2330");
});
