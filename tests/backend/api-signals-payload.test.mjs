// /api/overnight 與 /api/swing 的回應不帶 260 列證據：inputEvidence 與 candidatePool 合計約 220 KB，
// 前端只讀 scanQuality／coverage／publication.captureId 等摘要與 publication.signals（交易計畫來源比對）。
// builder 的 body 本身保留這些欄位（內部與其他測試用），只在 HTTP 邊界剝掉。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, tpexDailyCloseRow, misQuoteRow, compactToday, rocCompact } from "../helpers/fixtures.mjs";

let srv;
before(async () => {
  srv = await bootServer({
    routes: [
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: () => [
        stockDayAllRow({ code: "2330", name: "台積電", close: 101 }),
        stockDayAllRow({ code: "2317", name: "鴻海", close: 99 }),
      ] },
      { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: () => [tpexDailyCloseRow({ code: "5347", name: "世界", close: 51 })] },
      { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({ msgArray: [] }) },
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: () => [{ Date: rocCompact(compactToday()) }] },
      { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: () => [] },
      // 逐檔歷史、除權息、公司主檔一律失敗：body 會是 provisional／degraded，但形狀齊全，足以驗證 HTTP 邊界剝掉了什麼
      { match: /STOCK_DAY\?|tradingStock|TWT48U|TWT49U|exright|t187ap03|finance\/chart/, reply: { __error: "offline fixture" } },
    ],
  });
});
after(async () => { await srv.close(); });

for (const path of ["/api/overnight", "/api/swing"]) {
  test(`${path}：回應沒有 inputEvidence／candidatePool，仍有 scanQuality 與 publication（含 signals）`, async () => {
    const res = await srv.raw(path);
    assert.equal(res.status, 200, path);
    const body = await res.json();
    assert.ok(!("inputEvidence" in body), `${path} 不該送 260 列輸入證據`);
    assert.ok(!("candidatePool" in body), `${path} 不該送候選池`);
    assert.ok("scanQuality" in body || "coverage" in body, "摘要欄位要在");
    assert.ok(body.publication && typeof body.publication === "object", "發布身份要在");
    assert.ok(!("inputEvidence" in body.publication), "發布紀錄也不再內嵌證據");
    assert.ok(Array.isArray(body.publication.signals) || body.publication.kind === "not-persisted", "signals 是前端交易計畫來源比對要用的，保留");
  });
}
