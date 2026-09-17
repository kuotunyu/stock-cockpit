// 2026-09-17：使用者的底線是「不要被證交所 Ban 或限流」。以前 /api/quotes 依代號清單各自快取、沒有全站上限，
// 多人共用（Zeabur）時對 MIS 的請求量會乘上人數。這裡釘住三件事：token bucket 的數學、不同清單重疊的代號只抓一次、
// 預算用完時不打上游也不轉嫁 Yahoo，改沿用稍早的即時列或收盤備援並在 warnings 明講。
// 測試環境預設「不限、不重用」（舊行為）；每個案例用 configureMisBudgetForTest 明確開啟要測的設定。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { stockDayAllRow, twseCompanyProfileRow, misQuoteRow } from "../helpers/fixtures.mjs";

const MIS = /mis\.twse\.com\.tw\/stock\/api\/getStockInfo/;
const YAHOO = /query1\.finance\.yahoo\.com/;
const prices = { 2330: 2420, 2317: 210, 2454: 1500, 1101: 40 };
const codes = Object.keys(prices);

const { mod, mock, dataDir } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/STOCK_DAY_ALL/, reply: codes.map((code) => stockDayAllRow({ code, name: `測${code}`, close: 100 })) },
    { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_daily_close_quotes/, reply: [] },
    // 只回被問到的代號：測試才能從 URL 看出「這次到底問了哪些」
    { match: MIS, reply: (url) => ({
      msgArray: String(url.searchParams.get("ex_ch") || "").split("|")
        .map((channel) => /^tse_(\w+)\.tw$/.exec(channel)?.[1])
        .filter((code) => code && prices[code])
        .map((code) => misQuoteRow({ code, z: prices[code], y: 100 })),
    }) },
    { match: YAHOO, reply: { chart: { result: [{ meta: {} }] } } },
    { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: codes.map((code) => twseCompanyProfileRow({ code, name: `測${code}` })) },
    { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: [] },
  ],
});
after(async () => {
  mod.configureMisBudgetForTest();
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});
const misUrls = () => mock.callsFor(MIS).map((call) => decodeURIComponent(call.url));
const quoteOf = (body, code) => body.quotes.find((quote) => quote.code === code);

test("takeMisToken：最多連發 capacity 個，之後每 refillMs 補一個，久沒用也只補到上限", () => {
  const budget = { capacity: 3, refillMs: 2500, tokens: 3, updatedAt: 0 };
  const t0 = 1_000_000;
  assert.deepEqual([t0, t0, t0 + 10, t0 + 100].map((now) => mod.takeMisToken(now, budget)), [true, true, true, false]);
  assert.equal(mod.takeMisToken(t0 + 2499, budget), false, "還沒到補充時間");
  assert.equal(mod.takeMisToken(t0 + 2500, budget), true);
  assert.equal(mod.takeMisToken(t0 + 2600, budget), false);
  const later = t0 + 10 * 60 * 1000;
  assert.deepEqual([1, 2, 3, 4].map(() => mod.takeMisToken(later, budget)), [true, true, true, false], "閒置十分鐘也只補滿 3 個");
  assert.equal(mod.takeMisToken(t0, { capacity: Infinity, refillMs: 2500, tokens: 0, updatedAt: 0 }), true, "測試預設（不限）永遠放行");
});

test("測試預設維持舊行為：同一檔出現在不同清單，兩次都會問 MIS", async () => {
  mod.configureMisBudgetForTest();
  const before = misUrls().length;
  await mod.getQuotes(["2330", "2317"]);
  await mod.getQuotes(["2317", "2454"]);
  const urls = misUrls().slice(before);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes("tse_2317.tw") && urls[1].includes("tse_2454.tw"), urls[1]);
});

test("逐檔快取：不同清單重疊的代號在 ttl 內只抓一次，回應照樣有它的即時價", async () => {
  mod.configureMisBudgetForTest({ capacity: 10, refillMs: 2500, ttlMs: 10_000, staleMaxMs: 300_000 });
  const before = misUrls().length;
  const first = await mod.getQuotes(["2330", "2317", "1101"]);
  const second = await mod.getQuotes(["2317", "2454"]);
  const urls = misUrls().slice(before);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes("tse_2454.tw"), urls[1]);
  assert.ok(!urls[1].includes("tse_2317.tw"), "2317 剛抓過，不再問一次");
  assert.equal(quoteOf(first, "2317").price, 210);
  assert.equal(quoteOf(second, "2317").price, 210);
  assert.equal(quoteOf(second, "2317").sourceKind, "realtime");
  assert.equal(second.dataQuality.throttled, false);
  assert.ok(!second.warnings.some((warning) => /限速/.test(warning)));
  // 全部都在快取裡：完全不打上游
  const third = await mod.getQuotes(["2454", "2330"]);
  assert.equal(misUrls().length, before + 2);
  assert.equal(quoteOf(third, "2330").price, 2420);
});

test("預算用完：不打 MIS、不轉嫁 Yahoo；有舊列沿用舊列、沒有就退回收盤備援，warnings 明講", async () => {
  mod.configureMisBudgetForTest({ capacity: 1, refillMs: 60_000, ttlMs: 40, staleMaxMs: 300_000 });
  const misBefore = misUrls().length;
  const first = await mod.getQuotes(["2330"]);
  assert.equal(misUrls().length, misBefore + 1);
  assert.equal(quoteOf(first, "2330").price, 2420);
  assert.equal(first.dataQuality.throttled, false);

  const yahooBefore = mock.callsFor(YAHOO).length;
  const second = await mod.getQuotes(["2317"]);
  assert.equal(misUrls().length, misBefore + 1, "token 用完，這一輪不打 MIS");
  assert.equal(mock.callsFor(YAHOO).length, yahooBefore, "被限速的代號不轉嫁給 Yahoo");
  assert.equal(second.dataQuality.throttled, true);
  assert.ok(second.warnings.some((warning) => /限速保護/.test(warning)), JSON.stringify(second.warnings));
  assert.notEqual(quoteOf(second, "2317").sourceKind, "realtime", "沒有舊列 → 收盤備援");
  assert.equal(quoteOf(second, "2317").price, 100);
  assert.equal(second.ok, true, "限速不是失敗");

  await new Promise((resolve) => setTimeout(resolve, 60)); // 2330 的列過了 ttl（40ms）
  const third = await mod.getQuotes(["2330", "1101"]);
  assert.equal(misUrls().length, misBefore + 1, "仍然沒有 token");
  assert.equal(quoteOf(third, "2330").price, 2420, "沿用稍早的即時列，而不是掉回收盤價");
  assert.equal(quoteOf(third, "2330").sourceKind, "realtime");
  assert.equal(quoteOf(third, "1101").price, 100);
  assert.match(third.warnings.find((warning) => /限速保護/.test(warning)), /2 檔沒有向證交所重新查詢（1 檔沿用稍早的即時價/);
});

test("同時進來的兩個請求排隊：後者看得到前者剛抓的列，不會各抓一份", async () => {
  mod.configureMisBudgetForTest({ capacity: 10, refillMs: 2500, ttlMs: 10_000, staleMaxMs: 300_000 });
  const before = misUrls().length;
  const [a, b] = await Promise.all([mod.getQuotes(["2330", "2454"]), mod.getQuotes(["2454", "2330", "2317"])]);
  const urls = misUrls().slice(before);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes("tse_2317.tw") && !urls[1].includes("tse_2330.tw") && !urls[1].includes("tse_2454.tw"), urls[1]);
  assert.equal(quoteOf(a, "2454").price, 1500);
  assert.equal(quoteOf(b, "2330").price, 2420);
});
