// /api/market/breadth 的 HTTP 契約（backend SOP：新端點要有 HTTP 測試）：GET-only、形狀、
// 漲跌家數只算普通股、夜盤時段的期指價差要標時段與合約月份、開休市表抓不到要警告且事件標 rolled unknown。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, tpexDailyCloseRow, misQuoteRow, taifexMisRow, compactToday } from "../helpers/fixtures.mjs";

const yd = Number(compactToday().slice(0, 4)) % 10;
let srv;
before(async () => {
  srv = await bootServer({
    routes: [
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: () => [
        stockDayAllRow({ code: "2330", name: "台積電", close: 101 }),
        stockDayAllRow({ code: "0050", name: "元大台灣50", close: 101 }), // ETF 不進漲跌家數
      ] },
      { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: () => [tpexDailyCloseRow({ code: "5347", name: "世界", close: 51 })] },
      { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({
        msgArray: [{ ...misQuoteRow({ code: "t00", name: "發行量加權股價指數", z: "23000", y: "22500" }), n: "發行量加權股價指數" }],
      }) },
      // 日盤（MarketType 0）13:45 收 23000；夜盤（MarketType 1）20:00 在 23120 → 時間戳最新的是夜盤
      { match: /mis\.taifex\.com\.tw\/futures\/api\/getQuoteList/, reply: (url, init) => {
        const night = String(init?.body || "").includes('"MarketType":"1"');
        return { RtData: { QuoteList: [taifexMisRow({ symbolId: `TXFI${yd}-F`, last: night ? 23120 : 23000, ref: 22900, volume: 50000, time: night ? "200000" : "134500" })] } };
      } },
      { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: { __error: "holiday schedule down" } },
    ],
  });
});
after(async () => { await srv.close(); });

test("POST 回 405（GET-only 端點，在任何上游請求前就擋）", async () => {
  const res = await srv.raw("/api/market/breadth", { method: "POST" });
  assert.equal(res.status, 405);
});

test("GET：形狀完整；漲跌家數不含 ETF；夜盤價差標時段與合約月；開休市表抓不到要警告、事件標 rolled unknown", async () => {
  const res = await srv.raw("/api/market/breadth");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  for (const key of ["asOf", "taiex", "breadth", "basis", "events", "warnings"]) assert.ok(key in body, `缺 ${key}`);
  assert.equal(body.breadth.total, 2, "2330＋5347；0050 是 ETF 不算");
  assert.equal(body.breadth.up + body.breadth.down + body.breadth.flat, body.breadth.total);
  assert.equal(body.basis.session, "夜盤");
  assert.equal(body.basis.points, 120, "23120 − 23000");
  assert.match(body.basis.contractMonth, /^\d{4}\/\d{2}$/);
  assert.ok(body.warnings.some((w) => w.includes("開休市表")), body.warnings.join(" | "));
  assert.ok(Array.isArray(body.events));
  assert.ok(body.events.every((e) => e.rolled === "unknown"), JSON.stringify(body.events));
  assert.ok(body.warnings.some((w) => w.includes("加權指數歷史")), "regime 來源沒 mock → 位階未知要講出來");
});
