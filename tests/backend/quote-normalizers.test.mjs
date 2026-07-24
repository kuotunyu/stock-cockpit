// 行情正規化層：MIS 即時（priceStale 語意）、TWSE/TPEx 整批收盤、台指期/加權、
// 週轉率與普通股母體判斷。全是純函式，零網路（importServer 預設 tripwire）。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { misQuoteRow, taifexMisRow, taifexDailyRow, stockDayAllRow, tpexDailyCloseRow, compactToday } from "../helpers/fixtures.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer());
});

// 收盤備援（normalizeDailyTwse 的輸出形狀，欄位手填避免耦合）
const fallback = {
  code: "2330", name: "台積電", exchange: "TWSE", price: 99, previousClose: 98,
  open: 98.5, high: 99.5, low: 97.5, change: 1, changePct: (1 / 98) * 100,
  volumeLots: 500, transactions: 100, rawDate: "1150702",
};

test("normalizeMisQuote：有即時成交價 z → 現價、priceStale=false、漲跌自算", () => {
  const q = mod.normalizeMisQuote(misQuoteRow({ code: "2330", z: "123.5", y: "120", s: "35", v: "8000" }), fallback);
  assert.equal(q.price, 123.5);
  assert.equal(q.priceStale, false);
  assert.equal(q.previousClose, 120);
  assert.equal(q.change, 3.5);
  assert.equal(q.changePct, (3.5 / 120) * 100);
  assert.equal(q.unitLots, 35);
  assert.equal(q.volumeLots, 8000);
  assert.equal(q.sourceKind, "realtime");
  assert.ok(q.asOf.includes("13:30:00"), `asOf 要帶時間：${q.asOf}`);
});

test("normalizeMisQuote：z='-' 依序退 pz → oz（試撮/參考價仍算即時，不標 stale）", () => {
  const viaPz = mod.normalizeMisQuote(misQuoteRow({ code: "2330", z: "-", pz: "100.5", y: "100" }), fallback);
  assert.equal(viaPz.price, 100.5);
  assert.equal(viaPz.priceStale, false);
  const viaOz = mod.normalizeMisQuote(misQuoteRow({ code: "2330", z: "-", pz: "-", oz: "101", y: "100" }), fallback);
  assert.equal(viaOz.price, 101);
  assert.equal(viaOz.priceStale, false);
});

test("normalizeMisQuote：完全無即時價 → 退 fallback 收盤價＋priceStale=true（防假 0% 平盤）", () => {
  const q = mod.normalizeMisQuote(misQuoteRow({ code: "2330" }), fallback); // z/pz/oz 全 "-"
  assert.equal(q.price, 99, "顯示值退回官方收盤");
  assert.equal(q.priceStale, true, "必須標 stale，前端才不會畫出假漲跌");
  assert.equal(q.previousClose, 98, "昨收也退 fallback");
  assert.equal(q.change, 1);
  // 沒有 fallback 時：price null 且「不是」stale（沒有可誤導的顯示值）
  const bare = mod.normalizeMisQuote(misQuoteRow({ code: "9999" }), undefined);
  assert.equal(bare.price, null);
  assert.equal(bare.priceStale, false);
});

test("normalizeMisQuote：MIS 的 0 元 sentinel 不得變成成交價或 -100%（7782 實際形狀）", () => {
  const rocketClose = {
    ...fallback,
    code: "7782", name: "光速火箭", exchange: "TPEx",
    price: 27.35, previousClose: 26.2, open: 26.25, high: 27.35, low: 26,
    change: 1.15, changePct: (1.15 / 26.2) * 100, volumeLots: 20,
  };
  const q = mod.normalizeMisQuote(misQuoteRow({
    code: "7782", name: "光速火箭", ex: "otc",
    z: "-", pz: "-", oz: "0.0000", y: "26.2000",
    o: "26.2500", h: "27.3500", l: "26.0000", s: "-", v: "20",
  }), rocketClose);
  assert.equal(q.price, 27.35, "oz=0 是無參考價，必須退官方最近收盤");
  assert.equal(q.priceStale, true);
  assert.ok(Math.abs(q.change - 1.15) < 1e-9);
  assert.ok(Math.abs(q.changePct - (1.15 / 26.2) * 100) < 1e-9);
  assert.deepEqual([q.open, q.high, q.low, q.volumeLots], [26.25, 27.35, 26, 20]);
});

test("normalizeMisQuote：ex=otc → TPEx；預設 → TWSE", () => {
  assert.equal(mod.normalizeMisQuote(misQuoteRow({ code: "5347", ex: "otc" }), null).exchange, "TPEx");
  assert.equal(mod.normalizeMisQuote(misQuoteRow({ code: "2330" }), null).exchange, "TWSE");
});

test("normalizeDailyTwse：欄位映射、股→張換算、previousClose=收盤−漲跌", () => {
  const q = mod.normalizeDailyTwse({
    Code: "2330", Name: "台積電", Date: "1150702",
    ClosingPrice: "1,000", Change: "10", OpeningPrice: "995",
    HighestPrice: "1,005", LowestPrice: "990", TradeVolume: "12,345,678", Transaction: "9,876",
  });
  assert.equal(q.code, "2330");
  assert.equal(q.price, 1000);
  assert.equal(q.previousClose, 990);
  assert.equal(q.changePct, (10 / 990) * 100);
  assert.equal(q.volumeLots, 12346, "TWSE 給股數 → 除以 1000 四捨五入成張");
  assert.equal(q.transactions, 9876);
  assert.equal(q.exchange, "TWSE");
  assert.equal(q.asOf, "2026/07/02", "民國 7 碼要轉西元斜線");
  // Change 缺值 → previousClose/changePct 都是 null（不是 0）
  const noChange = mod.normalizeDailyTwse({ Code: "1101", ClosingPrice: "40", Change: "--" });
  assert.equal(noChange.previousClose, null);
  assert.equal(noChange.changePct, null);
});

test("normalizeDailyTpex：TradingShares 也是股數 → 除以 1000 成張", () => {
  const q = mod.normalizeDailyTpex({
    SecuritiesCompanyCode: "5347", CompanyName: "世界", Date: "1150702",
    Close: "80.6", Change: "7.3", Open: "73.3", High: "80.6", Low: "72.1",
    TradingShares: "10,200,000", TransactionNumber: "986",
  });
  assert.equal(q.code, "5347");
  assert.equal(q.exchange, "TPEx");
  assert.equal(q.price, 80.6);
  assert.equal(q.previousClose, 80.6 - 7.3);
  assert.equal(q.volumeLots, 10200);
});

test("normalizeFubonQuote：tradeVolume 官方單位固定為張，不依數值大小猜測", () => {
  const base = { symbol: "2330", name: "台積電", lastPrice: "1000", change: "10", changePercent: "1.01", date: "20260702" };
  assert.equal(mod.normalizeFubonQuote({ ...base, tradeVolume: 5000000 }, null).volumeLots, 5000000);
  assert.equal(mod.normalizeFubonQuote({ ...base, tradeVolume: 800 }, null).volumeLots, 800);
  assert.equal(mod.normalizeFubonQuote({ ...base, tradeVolume: 100000 }, null).volumeLots, 100000);
  assert.equal(mod.normalizeFubonQuote({ ...base, tradeVolume: 100001 }, null).volumeLots, 100001, "不得在 10 萬門檻出現 ÷1000 斷崖");
  const q = mod.normalizeFubonQuote({ ...base, tradeVolume: 800 }, null);
  assert.equal(q.previousClose, 990, "昨收＝現價−漲跌");
  assert.equal(q.changePct, 1.01, "官方給的漲跌幅優先");
});

test("normalizeFubonQuote：缺券商價時保留備援語意，不得冒充 broker realtime", () => {
  const q = mod.normalizeFubonQuote({ symbol: "2330", date: compactToday() }, fallback);
  assert.equal(q.price, fallback.price);
  assert.equal(q.priceStale, true);
  assert.equal(q.sourceKind, fallback.sourceKind || "daily-close");
  assert.equal(q.asOf, fallback.asOf || "2026/07/02");
  const empty = mod.normalizeFubonQuote({ symbol: "9999" }, null);
  assert.equal(empty.price, null);
  assert.equal(empty.sourceKind, "daily-close");
});

test("normalizeFubonQuote：epoch 微秒轉台北時間，previousClose 官方欄位優先", () => {
  const epochMicros = Date.parse("2023-05-29T13:30:00+08:00") * 1000;
  const q = mod.normalizeFubonQuote({
    symbol: "2330", lastPrice: 1000, change: 20, previousClose: 990,
    date: "20230529", lastUpdated: epochMicros,
  }, null);
  assert.ok(q.asOf.endsWith("13:30:00"), q.asOf);
  assert.equal(q.previousClose, 990, "不得用 price-change=980 蓋掉券商 previousClose=990");
  assert.equal(q.priceStale, false);
  assert.equal(q.sourceKind, "broker-realtime");
});

test("normalizeTaiexIndex／normalizeTxFuture：加權與台指期日報表欄位", () => {
  const idx = mod.normalizeTaiexIndex({ z: "23000", y: "22500", d: compactToday(0), t: "13:30:00", n: "發行量加權股價指數" });
  assert.equal(idx.key, "taiex");
  assert.equal(idx.change, 500);
  assert.equal(idx.changePct, (500 / 22500) * 100);
  const fut = mod.normalizeTxFuture(taifexDailyRow({ last: 22800, change: -50, pct: "-0.22%" }));
  assert.equal(fut.key, "tx");
  assert.equal(fut.price, 22800);
  assert.equal(fut.previousClose, 22850);
  assert.equal(fut.changePct, -0.22, "%欄位去掉百分號");
  assert.equal(fut.realtime, false, "日報表不是即時行情");
});

test("taifexContractMonthLabel：月碼字母→月份、年碼依當前年就近解讀（過舊進位下一個十年）", () => {
  const nowYear = Number(compactToday().slice(0, 4));
  assert.equal(mod.taifexContractMonthLabel(`TXFA${nowYear % 10}`), `${nowYear}/01`);
  assert.equal(mod.taifexContractMonthLabel(`TXFL${nowYear % 10}`), `${nowYear}/12`);
  // 年碼往回超過 5 年 → 視為下一個十年（近月契約不可能是 6 年前）
  assert.equal(mod.taifexContractMonthLabel(`TXFA${(nowYear + 4) % 10}`), `${nowYear + 4}/01`);
  assert.equal(mod.taifexContractMonthLabel("MXFG6"), "", "非 TXF 開頭 → 空字串");
});

test("normalizeTaifexMisTx：MIS 即時列＋時段標籤", () => {
  const nowYear = Number(compactToday().slice(0, 4));
  const q = mod.normalizeTaifexMisTx(taifexMisRow({ symbolId: `TXFG${nowYear % 10}-F`, last: 23000, ref: 22900, diff: 100, diffRate: 0.44, time: "134500" }), "日盤");
  assert.equal(q.price, 23000);
  assert.equal(q.previousClose, 22900);
  assert.equal(q.change, 100);
  assert.equal(q.changePct, 0.44);
  assert.equal(q.realtime, true);
  assert.equal(q.session, "日盤");
  assert.ok(q.name.includes(`${nowYear}/07`), `契約月要進名稱：${q.name}`);
  assert.ok(q.asOf.endsWith("13:45:00"), `CTime 6 碼要格式化：${q.asOf}`);
});

test("computeTurnoverPct：張×1000÷發行股數×100；缺值/零分母 → null", () => {
  assert.equal(mod.computeTurnoverPct(1500, 30_000_000), 5);
  assert.equal(mod.computeTurnoverPct(null, 30_000_000), null);
  assert.equal(mod.computeTurnoverPct(1500, 0), null);
  assert.equal(mod.computeTurnoverPct(1500, null), null);
});

test("isOrdinaryStock：普通股母體判斷（00 開頭 ETF、DR/權證/債排除；「特力」不誤殺）", () => {
  assert.equal(mod.isOrdinaryStock({ code: "2330", name: "台積電" }), true);
  assert.equal(mod.isOrdinaryStock({ code: "0050", name: "元大台灣50" }), false, "00 開頭是 ETF");
  assert.equal(mod.isOrdinaryStock({ code: "9105", name: "泰金寶-DR" }), false, "DR 排除");
  assert.equal(mod.isOrdinaryStock({ code: "2882", name: "國泰金甲特" }), true, "特別股靠代號字母排除，不靠「特」字（特力、邦特是正常公司）");
  assert.equal(mod.isOrdinaryStock({ code: "2908", name: "特力" }), true);
  assert.equal(mod.isOrdinaryStock({ code: "03047P", name: "某權證" }), false, "六碼過不了四碼檢查");
  assert.equal(mod.isOrdinaryStock(null), false);
});

test("resolveIndustryName：兩碼直查、一碼補零、未知回原值", () => {
  assert.equal(mod.resolveIndustryName("24"), "半導體業");
  assert.equal(mod.resolveIndustryName("1"), "水泥工業");
  assert.equal(mod.resolveIndustryName("99"), "99");
  assert.equal(mod.resolveIndustryName(""), "");
  assert.equal(mod.resolveIndustryName(null), "");
});

test("normalizeWatchListsPayload：只留 1/2/3 清單並去重清洗，不可在正規化階段靜默截斷", () => {
  const lists = mod.normalizeWatchListsPayload({
    1: ["2330", " 0050 ", "2330", "00725b", "bad code!"],
    2: "not-an-array",
    9: ["1101"],
  });
  assert.deepEqual(lists["1"], ["2330", "0050", "00725B"], "清洗、去重並保留合法英數 ETF；超過六碼的殘餘代號要排除");
  assert.deepEqual(lists["2"], []);
  assert.equal(lists["9"], undefined, "不認識的清單鍵不保留");
  const many = mod.normalizeWatchListsPayload({ 1: Array.from({ length: 150 }, (_, i) => String(1000 + i)) });
  assert.equal(many["1"].length, 150, "容量由 PUT validator 明確 422，helper 不得把第 101 檔無聲丟掉");
});

test("整批收盤 fixtures 與正規化端對端一致（stockDayAllRow / tpexDailyCloseRow）", () => {
  const t = mod.normalizeDailyTwse(stockDayAllRow({ code: "2330", close: 1000, volume: 25_000_000 }));
  assert.equal(t.price, 1000);
  assert.equal(t.volumeLots, 25000);
  const p = mod.normalizeDailyTpex(tpexDailyCloseRow({ code: "5347", close: 80.6, volume: 10_200_000 }));
  assert.equal(p.price, 80.6);
  assert.equal(p.volumeLots, 10200);
});
