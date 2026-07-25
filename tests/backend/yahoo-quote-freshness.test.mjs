// Yahoo 即時備援必須攜帶自己的交易日；舊日價格不得冒充今日即時，也不得混用昨日官方 OHLC。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, stockDayAllRow, twseCompanyProfileRow } from "../helpers/fixtures.mjs";

const iso = (compact) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
const today = compactToday();
const yesterdayDate = new Date(`${iso(today)}T00:00:00+08:00`);
yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
const yesterday = `${yesterdayDate.getUTCFullYear()}${String(yesterdayDate.getUTCMonth() + 1).padStart(2, "0")}${String(yesterdayDate.getUTCDate()).padStart(2, "0")}`;
const epochSeconds = (compact, time = "13:30:00") => Math.floor(Date.parse(`${iso(compact)}T${time}+08:00`) / 1000);

const { mod, mock, dataDir } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: [
      stockDayAllRow({ code: "2330", name: "台積電", close: 100, dateOff: 0 }),
      stockDayAllRow({ code: "2317", name: "鴻海", close: 200, dateOff: 0 }),
      // 官方整批列的 Change 可能是 "--"（當日無漲跌可算）→ 正規化後 previousClose 是 null。
      { ...stockDayAllRow({ code: "2454", name: "聯發科", close: 300, dateOff: 0 }), Change: "--" },
    ] },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: [] },
    { match: /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/, reply: { msgArray: [] } },
    { match: (url) => url.hostname === "query1.finance.yahoo.com" && url.pathname.includes("2330.TW"), reply: {
      chart: { result: [{ meta: {
        regularMarketPrice: 150, regularMarketTime: epochSeconds(yesterday), chartPreviousClose: 98,
        regularMarketOpen: 145, regularMarketDayHigh: 151, regularMarketDayLow: 144,
      } }] },
    } },
    { match: (url) => url.hostname === "query1.finance.yahoo.com" && url.pathname.includes("2317.TW"), reply: {
      chart: { result: [{ meta: {
        regularMarketPrice: 222, regularMarketTime: epochSeconds(today), chartPreviousClose: 210,
        regularMarketOpen: 215, regularMarketDayHigh: 225, regularMarketDayLow: 214,
      } }] },
    } },
    { match: (url) => url.hostname === "query1.finance.yahoo.com" && url.pathname.includes("2454.TW"), reply: {
      chart: { result: [{ meta: {
        regularMarketPrice: 310, regularMarketTime: epochSeconds(today), chartPreviousClose: 305,
        regularMarketOpen: 306, regularMarketDayHigh: 312, regularMarketDayLow: 304,
      } }] },
    } },
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: [
      twseCompanyProfileRow({ code: "2330", name: "台積電" }),
      twseCompanyProfileRow({ code: "2317", name: "鴻海" }),
      twseCompanyProfileRow({ code: "2454", name: "聯發科" }),
    ] },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: [] },
  ],
});

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("Yahoo 舊交易日不得覆蓋官方今日基準或升格 realtime", async () => {
  const body = await mod.getQuotes(["2330"]);
  const quote = body.quotes[0];
  assert.equal(quote.price, 100);
  assert.equal(quote.sourceKind, "daily-close");
  assert.notEqual(quote.source, "Yahoo Finance 即時");
});

test("Yahoo 今日價格帶自己的日期與 OHLC，才可升格 realtime", async () => {
  const body = await mod.getQuotes(["2317"]);
  const quote = body.quotes[0];
  assert.equal(quote.price, 222);
  assert.equal(quote.sourceKind, "realtime");
  assert.equal(quote.priceStale, false);
  assert.equal(quote.rawDate, today);
  assert.ok(quote.asOf.startsWith(`${iso(today).replaceAll("-", "/")} `), quote.asOf);
  assert.deepEqual([quote.open, quote.high, quote.low], [215, 225, 214], "不得混入官方 fallback 的另一日 OHLC");
});

// 舊寫法用 Number.isFinite(Number(base.previousClose))：Number(null)===0 是有限值，
// 於是 previousClose 變 0、change 變成「整個股價」（310 元的漲跌），changePct 又因 0 falsy 靜靜變 null。
test("官方昨收缺值（Change 為 --）時，Yahoo 升格不得把 previousClose 捏造成 0", async () => {
  const body = await mod.getQuotes(["2454"]);
  const quote = body.quotes[0];
  assert.equal(quote.price, 310);
  assert.equal(quote.sourceKind, "realtime");
  assert.equal(quote.previousClose, 305, "應退回 Yahoo 自己的昨收，而不是 0");
  assert.equal(quote.change, 5, "漲跌必須是 310−305，不能是整個股價");
  assert.ok(quote.changePct !== null && Math.abs(quote.changePct - 1.64) < 0.02, `changePct=${quote.changePct}`);
});
