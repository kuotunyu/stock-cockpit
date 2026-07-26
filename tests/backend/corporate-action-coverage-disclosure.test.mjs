// 官方除權除息計算結果表（還原權息的第一順位來源）抓不齊時，掃描端必須說出來。
//
// 為什麼特別釘這條：這個失敗模式在開發期間三天內出現三次（證交所限流），
// 而且**畫面上完全沒有跡象**——結果照常產生、標的照常上板，只是均線／布林／MACD
// 建立在沒還原的價格上。我自己就因此誤報過一整份影響評估的數字。
// 刻意不擋掉結果（歸檔公告與跳空估算仍在，抓到的月份也會落盤讓下一輪補齊），
// 但使用者要看得出來這批數字的基礎比平常弱。
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
const failingResultRoute = { match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/, reply: () => { throw new Error("上游 503"); } };
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

test("計算結果表抓不到時：掃描仍出結果，但 scanQuality 與 warnings 都要揭露", async () => {
  ctx = await boot(failingResultRoute);
  const reference = await ctx.mod.getReferenceData();
  const latestDate = ctx.mod.resolveMarketCloseDate(reference);
  const body = await ctx.mod.scanSwingBoard(reference, latestDate, 240);

  assert.equal(body.ok, true, "來源掛掉不得讓整個掃描失敗——它只是讓還原變粗糙");
  assert.equal(
    body.scanQuality.corporateActionResultsComplete, false,
    "scanQuality 必須帶出「這一輪沒抓齊」，否則失敗完全不可觀測",
  );
  const warningText = (body.warnings || []).join(" ");
  assert.match(warningText, /除權除息計算結果表/, `warnings 要點名是哪個來源：${warningText}`);
  assert.match(warningText, /均線|還原/, "要說清楚後果，不能只說「抓不到」");
});
