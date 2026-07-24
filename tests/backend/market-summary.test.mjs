// 市場摘要（頂欄加權/台指 pill 的資料源）：台指期近月挑選（量最大）、價差單過濾、
// MIS 失敗退期交所日報表（帶 staleReason）、台指期資料日落後加權 → stale 警示。
// 注意：getMarketSummary 有 15 秒模組級快取 → 只呼叫一次（放最後）；fetchTxQuote 無快取可多次。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { misQuoteRow, taifexMisRow, taifexDailyRow, compactToday } from "../helpers/fixtures.mjs";

const nowYear = Number(compactToday().slice(0, 4));
const yd = nowYear % 10; // 今年年碼

let mod;
let mock;
before(async () => {
  ({ mod, mock } = await importServer({
    routes: [
      // 加權指數（TWSE MIS，資料日＝今天）
      { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: () => ({
        msgArray: [{ ...misQuoteRow({ code: "t00", name: "發行量加權股價指數", z: "23000", y: "22500" }), n: "發行量加權股價指數" }],
      }) },
      // 台指期 MIS（日夜盤同端點；資料日＝昨天 → 給最後的 stale 交叉檢查用）
      { match: /mis\.taifex\.com\.tw\/futures\/api\/getQuoteList/, reply: () => ({
        RtData: { QuoteList: [
          taifexMisRow({ symbolId: `TXFG${yd}-F`, last: 23000, ref: 22900, diff: 100, volume: 50000, dateOff: -1 }),
          taifexMisRow({ symbolId: `TXFH${yd}-F`, last: 23100, ref: 23000, diff: 100, volume: 900, dateOff: -1 }),
          taifexMisRow({ symbolId: `TXFG${yd}/H${yd}`, last: 100, ref: 90, diff: 10, volume: 99999, dateOff: -1 }), // 價差單要被濾掉
        ] },
      }) },
      // 期交所日報表（MIS 失敗時的備援）
      { match: /openapi\.taifex\.com\.tw\/v1\/DailyMarketReportFut/, reply: () => [
        taifexDailyRow({ last: 22800, change: -50, pct: "-0.22%", dateOff: -1, session: "一般" }),
      ] },
      { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: () => [{ Date: `${nowYear - 1911}/${compactToday().slice(4, 6)}/${compactToday().slice(6, 8)}` }] },
      { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: () => [{ Name: "元旦", Date: `${nowYear - 1911}0101`, Description: "依規定放假" }] },
    ],
  }));
});

test("fetchTxQuote：近月契約用成交量挑（不是價差單的 99999）、帶時段標籤", async () => {
  const tx = await mod.fetchTxQuote();
  assert.equal(tx.realtime, true);
  assert.equal(tx.price, 23000, "量 50000 的 TXFG 才是近月，價差單量再大也不能選");
  assert.equal(tx.contractMonth, `${nowYear}/07`);
  assert.equal(tx.change, 100);
  assert.ok(["日盤", "夜盤"].includes(tx.session));
});

test("fetchTxQuote：MIS 掛掉 → 退期交所日報表＋staleReason 說明", async () => {
  const remove = mock.override({ match: /mis\.taifex\.com\.tw/, reply: { __error: "taifex MIS down" } });
  try {
    const tx = await mod.fetchTxQuote();
    assert.equal(tx.realtime, false);
    assert.equal(tx.price, 22800);
    assert.ok(tx.staleReason.includes("改用期交所日報表"), tx.staleReason);
  } finally {
    remove();
  }
});

// 放最後：getMarketSummary 有 15 秒快取，本行程只能算一次。
test("getMarketSummary：台指期資料日落後加權 → 標 stale＋警告（不能當即時價看）", async () => {
  const body = await mod.getMarketSummary();
  assert.equal(body.ok, true);
  assert.equal(body.markets.taiex.price, 23000);
  assert.equal(body.markets.taiex.change, 500);
  assert.equal(body.markets.tx.stale, true, "台指期是昨天的資料日");
  assert.ok(body.markets.tx.staleReason.includes("早於加權指數"), body.markets.tx.staleReason);
  assert.ok(body.warnings.some((w) => w.includes("早於加權指數")));
});
