// 對照組：計算結果表正常時，不得留下假警告（天天亮的警告等於沒有警告）。
//
// 獨立成檔的原因：ESM 模組快取讓同一個測試檔裡的兩次 importServer 拿到同一個實例，
// 失敗月份的負向快取與已成功月份都會殘留，降級／正常兩種情境無法在同檔並存。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday, surveillanceRoutes, stockDayAllRow, tpexDailyCloseRow,
} from "../helpers/fixtures.mjs";

const today = compactToday(0);

// 只有 2330 有逐月歷史，足夠讓掃描跑完並產生 scanQuality。
function stockDayMonthRoute() {
  return {
    match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
    reply: (url) => {
      if (url.searchParams.get("stockNo") !== "2330") return { stat: "OK", data: [] };
      const monthCompact = String(url.searchParams.get("date") || "");
      const year = Number(monthCompact.slice(0, 4));
      const month = Number(monthCompact.slice(4, 6));
      const rows = [];
      let previous = null;
      for (let day = 1; day <= 28; day += 1) {
        const compact = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
        if (compact > today) break;
        const close = 100 + (month % 3) + day * 0.2;
        rows.push([
          `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
          "2,500,000", String(Math.round(close * 2.5e6)),
          (close - 0.5).toFixed(2), (close + 0.8).toFixed(2), (close - 0.9).toFixed(2), close.toFixed(2),
          previous === null ? "0.00" : (close - previous).toFixed(2),
          "1,800",
        ]);
        previous = close;
      }
      return { stat: "OK", data: rows };
    },
  };
}

// TWT49U 全部失敗 → ensureCorporateActionResults 回 degraded: true
const okResultRoute = { match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/, reply: { stat: "OK", data: [] } };

async function boot(resultRoute) {
  return importServer({
    routes: [
      ...surveillanceRoutes({
        reference: [stockDayAllRow({ code: "2330", name: "台積電", close: 120 })],
        tpexReference: [tpexDailyCloseRow({ code: "5347", name: "世界", close: 50 })],
      }),
      stockDayMonthRoute(),
      { match: /www\.tpex\.org\.tw\/www\/zh-tw\/afterTrading\/tradingStock/, reply: { tables: [{ data: [] }] } },
      { match: /query1\.finance\.yahoo\.com/, reply: { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } } },
      resultRoute,
    ],
  });
}

let ctx;
after(async () => {
  if (!ctx) return;
  ctx.mock.restore();
  await rm(ctx.dataDir, { recursive: true, force: true }).catch(() => {});
});

test("計算結果表正常時不得留下假警告", async () => {
  ctx = await boot(okResultRoute);
  const reference = await ctx.mod.getReferenceData();
  const latestDate = ctx.mod.resolveMarketCloseDate(reference);
  const body = await ctx.mod.scanSwingBoard(reference, latestDate, 240);

  assert.equal(body.scanQuality.corporateActionResultsComplete, true);
  assert.doesNotMatch(
    (body.warnings || []).join(" "), /除權除息計算結果表/,
    "正常時就掛警告等於天天亮，使用者會學會忽略它",
  );
});
