// 前向驗證的除權息處理：兩套驗證引擎都不能把「除權息造成的機械性跳空」當成真實漲跌。
// 2026-07-25 實測：波段驗證單在持有期間遇到配息 5 元（參考價 95）、當天相對參考價其實小漲 0.5%，
// 仍會被 low(95) <= stop(95) 記成 loss −5%；隔日沖驗證同理會直接觸發 brokeMinus2。
// 台股殖利率偏高且除權息旺季集中在 7~9 月，這個偏誤是單向的（只會多記 loss、少記 win）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactTradingDay } from "../helpers/fixtures.mjs";

const D0 = compactTradingDay(-1); // 訊號日／上一個檢查日
const D1 = compactTradingDay(0);  // 要推進的觀察日

const dataDir = await mkdtemp(join(tmpdir(), "stock1-verify-actions-"));
// 官方歸檔：2412 在 D1 除息 5 元。隔日沖側必須先由歸檔確認事件，才允許換基準價。
await writeFile(join(dataDir, "fundamentals-cache.json"), JSON.stringify({
  revenue: {}, eps: {}, valuation: {},
  dividends: {
    2412: {
      [D1]: {
        kind: "除息", cashDividend: 5, stockRatio: 0, subscriptionRatio: 0, subscriptionPrice: 0,
        observedAt: "2026-01-01T00:00:00.000Z", revision: 1,
      },
    },
    2882: {
      [D1]: {
        kind: "除息", cashDividend: 5, stockRatio: 0, subscriptionRatio: 0, subscriptionPrice: 0,
        observedAt: "2026-01-01T00:00:00.000Z", revision: 1,
      },
    },
    // 上櫃：歸檔有公告，但上櫃沒有 TWT49U 對應端點 → 必須走逐檔月歷史拿官方參考價。
    5488: {
      [D1]: {
        kind: "除息", cashDividend: 5, stockRatio: 0, subscriptionRatio: 0, subscriptionPrice: 0,
        source: "TPEx", observedAt: "2026-01-01T00:00:00.000Z", revision: 1,
      },
    },
  },
  // 官方除權除息計算結果表：2412 在 D1 前收 100 → 參考價 95（比率 0.95）。
  // 這是上市側唯一可靠的比率來源——整批當日收盤與逐檔月歷史的漲跌欄在事件日都不可用
  // （前者是 "0.0000" 哨兵，後者被遮成 "X0.00"）。
  // 刻意**不**預先寫 corporateActionResultMonths：下面有一條測試要驗「該月結果表沒抓過時，
  // 上市 X 標記不足以停等」（上游打嗝不該讓驗證單全部停擺）。需要月份狀態的測試自己臨時設。
  //
  // 兩個代號刻意分工，否則測試會互相打到：
  //   2412 只有歸檔公告、**沒有**結果表 → 量化失敗，用來測停等／解不出基準。
  //   2882 歸檔＋結果表都有（前收 100 → 參考價 95）→ 量化成功，用來測正確換基準。
  //   6488 只有結果表、**沒有**歸檔公告 → 測「歸檔漏了但交易所有登記」也要偵測得到
  //        （D-43 實測：台積電 06-11、鴻海 07-02、中華電 07-09 都是歸檔完全沒有的真實事件）。
  corporateActionResults: {
    2882: { [D1]: { kind: "除息", preClose: 100, referencePrice: 95 } },
    6488: { [D1]: { kind: "除息", preClose: 100, referencePrice: 95 } },
  },
}), "utf8");

// 上櫃逐檔月歷史：漲跌欄是**相對參考價**算出來的正常數字（2026-07-27 實測 5/5），
// 所以 close − change 就是官方參考價。上櫃沒有 TWT49U 對應端點，這是它唯一的比率來源。
// 對照組：整批當日收盤的漲跌欄在事件日是中文字串 "除息"／"除權"，完全不能用。
const TPEX_HISTORY_ROWS = {
  tables: [{
    data: [
      // [日期, 成交仟股, 成交仟元, 開, 高, 低, 收, 漲跌, 筆數]
      [`${Number(D1.slice(0, 4)) - 1911}/${D1.slice(4, 6)}/${D1.slice(6, 8)}`, "100", "9500", "95", "96", "94.5", "95.5", "0.50", "10"],
    ],
  }],
  name: "測試上櫃",
};
const { mod, mock } = await importServer({
  dataDir,
  routes: [
    { match: /tpex\.org\.tw\/www\/zh-tw\/afterTrading\/tradingStock/, reply: TPEX_HISTORY_ROWS },
  ],
});
const { replaySwingVerificationHistory } = mod;
// replaySwingVerificationHistory 是同步的，公司行動偵測要讀「已載入」的歸檔。
// 生產路徑由 advanceSwingVerification 先 await 這個載入，測試必須照同一個順序，
// 否則偵測器會安靜地讀到空歸檔，讓「沒載入」偽裝成「這天沒有事件」——
// 這正是這批測試在改寫前全部誤過的原因。
await mod.loadFundamentalsHistory();

after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

const calendar = { tradingDays: [D0, D1], holidayRows: [] };
const pendingEntry = (code = "2412") => ({
  code, status: "pending", entry: 100, stop: 95, target: 108,
  lastChecked: D0, daysHeld: 3,
});
// 官方逐檔歷史的列同時帶 previousClose 與 exchangePreviousClose（兩者相等）。
// 驗證路徑只信 exchangePreviousClose——Yahoo 備援與「整批收盤補出來的當日 K」會把
// previousClose 填成前一列的收盤，拿它算比率恆等於 1，會讓「算不出來」偽裝成「沒有事件」。
const officialRow = (over) => ({
  previousClose: over.exchangePreviousClose ?? null,
  exchangeCorporateActionMark: false,
  source: "TWSE STOCK_DAY",
  ...over,
});
// 前一根收 100；除息日交易所昨收（＝官方參考價）95。
const priorDay = officialRow({ rawDate: D0, open: 99, high: 101, low: 98, close: 100, exchangePreviousClose: 99.5 });

test("波段驗證：除息當天相對參考價其實小漲，不得記成停損", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    priorDay,
    officialRow({ rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, exchangePreviousClose: 95 }),
  ], D1, calendar);
  assert.equal(entry.status, "pending", "除息跳空不是真實跌幅，不可結案為停損");
  assert.equal(entry.entry, 95, "計畫價要一起搬到除息後的尺度");
  assert.equal(entry.stop, 90.25);
  assert.equal(entry.target, 102.6);
  assert.deepEqual(entry.corporateActions, [{ date: D1, ratio: 0.95 }], "要留下可稽核的調整紀錄");
  assert.equal(entry.corporateActionPending, undefined, "算得出比率就不該留停等旗標");
});

// 用 2330（歸檔裡沒有任何事件）而不是 2412：2412 在 D1 有除息公告，拿它測「沒有公司行動」
// 等於讓 fixture 自相矛盾——偵測器一旦生效就會停等，測不到它想測的東西。
test("波段驗證：沒有公司行動時真的跌破停損，仍必須記 loss（防線不可過度收緊）", () => {
  const entry = pendingEntry("2330");
  replaySwingVerificationHistory(entry, [
    officialRow({ ...priorDay, rawDate: D0 }),
    officialRow({ rawDate: D1, open: 99, high: 99.5, low: 94, close: 94.2, exchangePreviousClose: 100 }),
  ], D1, calendar);
  assert.equal(entry.status, "loss");
  assert.equal(entry.resultPct, -5);
  assert.equal(entry.entry, 100, "沒有事件就不能動計畫價");
  assert.equal(entry.corporateActions, undefined);
  assert.equal(entry.corporateActionPending, undefined);
});

test("波段驗證：除息後真的續跌，以調整後的停損價結案", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    priorDay,
    officialRow({ rawDate: D1, open: 95, high: 95.2, low: 89, close: 89.5, exchangePreviousClose: 95 }),
  ], D1, calendar);
  assert.equal(entry.status, "loss");
  assert.equal(entry.entry, 95);
  assert.equal(entry.stop, 90.25);
  assert.equal(entry.resultPct, -5, "含息總報酬：相對調整後 entry 仍是 −5%");
});

// D-01 子項 1：舊行為是「交易所昨收缺值 → 偵測不到事件 → 照原始價判定」，並被當成已知限制
// 釘進測試。那條限制其實會把除息跳空記成假停損（偏誤單向：只多記 loss、不會多記 win），
// 所以改成停等——算不出比率時拒絕判定，而不是拿事件前的計畫價去比事件後的價格。
test("D-01：官方公告有事件但兩層來源都算不出比率 → 停等，不得記成假停損", () => {
  const entry = pendingEntry();
  const before = { entry: entry.entry, stop: entry.stop, target: entry.target, daysHeld: entry.daysHeld };
  replaySwingVerificationHistory(entry, [
    officialRow({ ...priorDay, exchangePreviousClose: null }),
    officialRow({ rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, exchangePreviousClose: null }),
  ], D1, calendar);
  assert.equal(entry.status, "pending", "算不出比率時不可結案");
  assert.equal(entry.corporateActionPending?.from, D1);
  assert.equal(entry.corporateActionPending?.reason, "官方公告");
  assert.equal(entry.corporateActions, undefined, "沒有比率就不該留下調整紀錄");
  assert.equal(entry.entry, before.entry, "停等期間計畫價不動");
  assert.equal(entry.stop, before.stop);
  assert.equal(entry.target, before.target);
  assert.equal(entry.daysHeld, before.daysHeld, "停等不吃觀察天數，否則會被 15 天超時規則吞掉");
  assert.equal(entry.dataGap, undefined, "停等的語意不是「缺 K」，不可共用 dataGap 欄位");
});

test("D-01：比率補齊後停等自動解開，接著照調整後尺度判定", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    officialRow({ ...priorDay, exchangePreviousClose: null }),
    officialRow({ rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, exchangePreviousClose: null }),
  ], D1, calendar);
  assert.equal(entry.corporateActionPending?.from, D1, "先進入停等");
  // 隔天官方逐檔歷史補上了交易所昨收 → 同一個 expected 重跑，這次量得出來。
  replaySwingVerificationHistory(entry, [
    priorDay,
    officialRow({ rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, exchangePreviousClose: 95 }),
  ], D1, calendar);
  assert.equal(entry.corporateActionPending, undefined, "解開後必須清掉旗標");
  assert.equal(entry.entry, 95);
  assert.deepEqual(entry.corporateActions, [{ date: D1, ratio: 0.95 }], "只能調整一次");
  assert.equal(entry.status, "pending");
});

// Yahoo 備援列的 previousClose 是 normalizeYahooHistoryRows 自己用前一列收盤補的，
// 而且它的 OHLC 已把配股當分割還原過。若誤信它，比率恆等於 1 → 靜默照原始價判定。
test("D-01：Yahoo 備援列不得用來推官方比率，有事件時一律停等", () => {
  const entry = pendingEntry();
  const yahooRow = (over) => ({
    exchangePreviousClose: null, exchangeCorporateActionMark: false,
    source: "Yahoo Finance chart fallback", ...over,
  });
  replaySwingVerificationHistory(entry, [
    yahooRow({ rawDate: D0, open: 99, high: 101, low: 98, close: 100, previousClose: 99.5 }),
    // Yahoo 自己補的 previousClose＝前一列收盤 100，比率算出來剛好是 1（看起來「沒有事件」）。
    yahooRow({ rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, previousClose: 100 }),
  ], D1, calendar);
  assert.equal(entry.status, "pending", "不可拿 Yahoo 座標系的列判定官方計畫價");
  assert.equal(entry.corporateActionPending?.from, D1);
});

// 上面那條靠「Yahoo 列的 exchangePreviousClose 是 null」就擋住了，所以擋不住的是另一種退化：
// 有人日後讓 Yahoo 正規化器順手填了這個欄位。座標系不同這件事與欄位有沒有值無關
// （Yahoo 的 OHLC 已把配股當分割還原過），所以 fromYahoo 這道判斷必須自己站得住。
test("D-01：即使 Yahoo 列帶了看起來像交易所昨收的值，仍不可用來推官方比率", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    { rawDate: D0, open: 99, high: 101, low: 98, close: 100, exchangePreviousClose: 99.5, source: "Yahoo Finance chart fallback" },
    { rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, exchangePreviousClose: 95, source: "Yahoo Finance chart fallback" },
  ], D1, calendar);
  assert.equal(entry.status, "pending");
  assert.equal(entry.corporateActionPending?.from, D1);
  assert.equal(entry.corporateActions, undefined, "Yahoo 座標系的比率不可套到官方尺度的計畫價上");
});

// 這是**每天都會走到**的那條路：訊號日之後的第一個交易日，rows 只有 reference.byCode 的
// 整批收盤報價（advanceSwingVerification 的 directRows），逐檔月歷史還沒抓。
// 那份報價帶 previousClose 但沒有 exchangePreviousClose——而上市 STOCK_DAY_ALL 在除權息日
// 的 Change 是 "0.0000" 哨兵（D-43 實測），於是 previousClose 會等於當天收盤。
// 誤信它算出來的比率是「當天真實漲跌」，不是公司行動比率：
//   收 95.5、哨兵 previousClose 95.5、前一根收 100 → 比率 0.955，而正確答案是 0.95。
// 那不只是沒調整，是**用錯的比率調整**，還會落盤成不可回溯的稽核紀錄。
test("D-01：整批收盤補出來的當日 K 沒有交易所昨收，不可拿 previousClose 頂替", () => {
  const entry = pendingEntry();
  replaySwingVerificationHistory(entry, [
    priorDay,
    {
      rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5,
      // STOCK_DAY_ALL 的 Change "0.0000" 哨兵 → previousClose 被算成等於收盤價。
      previousClose: 95.5,
      exchangePreviousClose: null,
      exchangeCorporateActionMark: false,
      source: "STOCK_DAY_ALL official close (appended)",
    },
  ], D1, calendar);
  assert.equal(entry.status, "pending", "不可用哨兵推出來的比率判定");
  assert.equal(entry.corporateActionPending?.from, D1);
  assert.equal(entry.corporateActions, undefined, "0.955 是當天漲跌不是公司行動比率，不可落盤");
  assert.equal(entry.entry, 100, "停等期間計畫價不動");
});

// 上市在除權息日把漲跌價差欄整欄遮成 "X0.00"，這是交易所自己的事件標記，涵蓋全部歷史，
// 比只從部署後累積的本機歸檔可靠——歸檔沒有那一筆時它是唯一的偵測來源。
test("D-01：歸檔沒有但上市 X 標記有 → 仍要停等（該月結果表已抓成功時）", () => {
  const entry = pendingEntry("2330"); // 2330 不在歸檔裡
  replaySwingVerificationHistory(entry, [
    officialRow({ ...priorDay, exchangePreviousClose: null }),
    officialRow({
      rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5,
      exchangePreviousClose: null, exchangeCorporateActionMark: true,
    }),
  ], D1, calendar);
  // 這個 dataDir 的計算結果表一個月份都沒抓過 → markerActionable 為 false，不得停等。
  // 這是刻意的：上游打嗝不該讓所有驗證單停擺（見 corporateActionResultMonthCovered）。
  assert.equal(entry.status, "loss", "該月結果表沒抓過時，X 標記不足以停等");
  assert.equal(entry.corporateActionPending, undefined);
});

test("D-01：該月結果表已封月時，上市 X 標記就足以停等", async () => {
  // 手動把 D1 那個月標成已封月的成功抓取（sealed＝該月結束後才抓，永遠不會再變）。
  const history = await mod.loadFundamentalsHistory();
  history.corporateActionResultMonths ||= {};
  history.corporateActionResultMonths[D1.slice(0, 6)] = {
    status: "ok", rows: 120, codes: 120, observedAt: "2026-01-01T00:00:00.000Z", sealed: true,
  };
  try {
    const entry = pendingEntry("2330");
    replaySwingVerificationHistory(entry, [
      officialRow({ ...priorDay, exchangePreviousClose: null }),
      officialRow({
        rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5,
        exchangePreviousClose: null, exchangeCorporateActionMark: true,
      }),
    ], D1, calendar);
    assert.equal(entry.status, "pending", "交易所自己標了除權息，就不可拿原始價判定");
    assert.equal(entry.corporateActionPending?.reason, "上市除權息標記");
  } finally {
    delete history.corporateActionResultMonths[D1.slice(0, 6)];
  }
});

// 停等會讓同一個 expected 日被重跑，所以「已調整過的事件日不可再乘一次」必須成立。
// 觸發條件：比率算得出來，但那一根的高低價缺值 → advanceSwingVerificationEntry 回 false
// → 停在同一天並記 dataGap；下一輪補到完整的 K 時若不擋，計畫價會被同一筆事件乘兩次。
test("D-01：比率已套用但推進失敗，重跑不可把同一筆事件乘第二次", () => {
  const entry = pendingEntry();
  // 第一輪：有交易所昨收（量得出 0.95），但高低價缺值 → 調整完成、推進失敗。
  replaySwingVerificationHistory(entry, [
    priorDay,
    officialRow({ rawDate: D1, open: 95, high: null, low: null, close: 95.5, exchangePreviousClose: 95 }),
  ], D1, calendar);
  assert.equal(entry.entry, 95, "第一輪已把計畫價搬到除息後尺度");
  assert.equal(entry.lastChecked, D0, "推進失敗，日期沒有前進");
  assert.ok(entry.dataGap, "缺高低價要記成資料缺口");
  // 第二輪：同一個 expected 日，這次 K 是完整的。
  replaySwingVerificationHistory(entry, [
    priorDay,
    officialRow({ rawDate: D1, open: 95, high: 96, low: 94.5, close: 95.5, exchangePreviousClose: 95 }),
  ], D1, calendar);
  assert.equal(entry.entry, 95, "不可乘成 90.25");
  assert.equal(entry.stop, 90.25, "不可乘成 85.7375");
  assert.deepEqual(entry.corporateActions, [{ date: D1, ratio: 0.95 }], "稽核紀錄只能有一筆");
  assert.equal(entry.lastChecked, D1);
});

// 2026-07-27 實測 20260724 的 18 筆真實事件後改寫：基準價**不可**取自 bar.previousClose。
//   整批當日／上市：Change 是 "0.0000" 哨兵（12/12）→ previousClose ＝ 當日收盤
//     → 基準價變成觀察日自己的收盤，currentReturn 恆為 0。
//   整批當日／上櫃：Change 是中文字串 "除息"／"除權"（6/6）→ null → 退回訊號日收盤 → 假大跌。
//   逐檔月歷史／上市：漲跌欄被遮成 "X0.00" → 同樣是 null → 假大跌。
// 現在改由計算結果表的比率（上市）或逐檔月歷史的官方參考價（上櫃）解基準。
// 觀察日那一列刻意帶 previousClose: 95.5（＝當日收盤），複製上市整批端點的 "0.0000" 哨兵行為。
// 舊寫法會拿它當基準 → currentReturn 恆為 0；正確答案要來自計算結果表的比率 0.95。
const observeWithMonthSealed = async (picks, byCode) => {
  const history = await mod.loadFundamentalsHistory();
  history.corporateActionResultMonths ||= {};
  history.corporateActionResultMonths[D1.slice(0, 6)] = {
    status: "ok", rows: 1, codes: 1, observedAt: "2026-01-01T00:00:00.000Z", sealed: true,
  };
  try {
    return await mod.observeSignalSnapshot({
      asOf: `${D0.slice(0, 4)}-${D0.slice(4, 6)}-${D0.slice(6, 8)}`,
      picks,
    }, {
      reference: { byCode: new Map(byCode), warnings: [] },
      calendar: { tradingDays: [D0, D1], holidayRows: [], warnings: [] },
    });
  } finally {
    delete history.corporateActionResultMonths[D1.slice(0, 6)];
  }
};

test("隔日沖驗證：觀察日是除權息日時，用官方計算結果表的比率換基準價", async () => {
  // 訊號日收 100；觀察日除息 5 元（結果表：前收 100 → 參考價 95），當天開 95 高 96 低 94.5 收 95.5。
  // 未修正前 lowReturn = (94.5−100)/100 = −5.5% → brokeMinus2；正確應以 95 為基準。
  const withEvent = await observeWithMonthSealed(
    [{ code: "2882", name: "國泰金", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
    [["2882", {
      code: "2882", name: "國泰金", exchange: "TWSE", rawDate: D1,
      // 哨兵：上市整批端點在事件日的 Change 是 "0.0000"，於是 previousClose 等於當日收盤。
      open: 95, high: 96, low: 94.5, price: 95.5, previousClose: 95.5,
    }]],
  );
  const row = withEvent.rows?.[0];
  assert.ok(row, JSON.stringify(withEvent).slice(0, 300));
  assert.equal(row.verified, true);
  assert.equal(row.corporateActionAdjusted, true, "偵測到事件 → 換基準");
  assert.equal(row.adjustedBase, 95, "基準＝訊號日收盤 × 0.95，不是哨兵給的 95.5");
  assert.equal(row.brokeMinus2, false, "以參考價為基準只跌 0.53%，不該記破線");
  assert.ok(Math.abs(row.currentReturn - 0.53) < 0.02, `currentReturn=${row.currentReturn}`);
  // 舊行為的特徵：基準取哨兵 95.5 時 currentReturn 會剛好是 0。
  assert.notEqual(row.currentReturn, 0, "基準若誤取觀察日收盤，報酬會恆為 0");
});

// 上櫃沒有 TWT49U 對應端點（1065 個收錄代號裡只有 1 檔上櫃），唯一的比率來源是逐檔月歷史。
// **不可**改用整批當日收盤：它的漲跌欄在事件日是中文字串 "除息"／"除權"（實測 6/6）。
test("隔日沖驗證：上櫃走官方逐檔月歷史的參考價換基準價", async () => {
  const result = await observeWithMonthSealed(
    [{ code: "5488", name: "松普", exchange: "TPEx", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
    [["5488", {
      code: "5488", name: "松普", exchange: "TPEx", rawDate: D1,
      // 整批端點的哨兵：漲跌欄是中文字串 → parseNumber 回 null → previousClose 也是 null。
      open: 95, high: 96, low: 94.5, price: 95.5, previousClose: null,
    }]],
  );
  const row = result.rows?.[0];
  assert.ok(row, JSON.stringify(result).slice(0, 300));
  assert.equal(row.verified, true);
  assert.equal(row.corporateActionAdjusted, true);
  assert.equal(row.adjustedBase, 95, "逐檔月歷史的 close − change＝95．5 − 0.5＝95＝官方參考價");
  assert.equal(row.brokeMinus2, false, "以參考價為基準只跌 0.53%，不該記破線");
});

// 本機歸檔只從部署後累積，交易所的計算結果表涵蓋全部歷史。D-43 實測：歸檔漏掉台積電（06-11）、
// 鴻海（07-02）、中華電（07-09）等真實事件，跳空 −0.22%~−4.30% 全在 10.5% heuristic 門檻之下。
// 所以偵測不能只問歸檔——結果表有這一筆就是交易所自己說「這天有事件」。
test("隔日沖驗證：歸檔漏了但計算結果表有登記，仍要換基準價", async () => {
  const result = await observeWithMonthSealed(
    [{ code: "6488", name: "環球晶", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
    [["6488", {
      code: "6488", name: "環球晶", exchange: "TWSE", rawDate: D1,
      open: 95, high: 96, low: 94.5, price: 95.5, previousClose: 95.5,
    }]],
  );
  const row = result.rows?.[0];
  assert.ok(row, JSON.stringify(result).slice(0, 300));
  assert.equal(row.verified, true);
  assert.equal(row.corporateActionAdjusted, true, "歸檔沒有這筆，但交易所結果表有 → 仍要換基準");
  assert.equal(row.adjustedBase, 95);
  assert.equal(row.brokeMinus2, false);
});

// 2412 有歸檔公告但沒有結果表，且逐檔月歷史被 fetch mock 擋住（＝抓不到）→ 解不出基準。
// 舊行為會用哨兵 previousClose 或退回訊號日收盤，兩種都會產出一個看起來正常的錯數字。
test("隔日沖驗證：偵測到除權息卻解不出官方比率時，不給結論而非給錯的", async () => {
  const result = await observeWithMonthSealed(
    [{ code: "2412", name: "中華電", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
    [["2412", {
      code: "2412", name: "中華電", exchange: "TWSE", rawDate: D1,
      open: 95, high: 96, low: 94.5, price: 95.5, previousClose: 95.5,
    }]],
  );
  const row = result.rows?.[0];
  assert.ok(row, JSON.stringify(result).slice(0, 300));
  assert.equal(row.verified, false, "解不出基準就不可宣稱驗證完成");
  assert.equal(row.pendingReason, "corporate-action-unresolved");
  assert.equal(row.brokeMinus2, undefined, "不可留下用原始價算出來的假破線");
  assert.equal(result.complete, false, "整份快照因此不算完整，不會污染長期分母");
});

test("隔日沖驗證：歸檔沒有事件時，價差再大也不可自作主張換基準價", async () => {
  // 這是實作過程中差點放行的回歸：bar.previousClose 與快照 price 來自不同來源／時點，
  // 單純比大小就換基準會靜靜改掉所有報酬數字。9999 在歸檔裡沒有任何事件。
  const noEvent = await mod.observeSignalSnapshot({
    asOf: `${D0.slice(0, 4)}-${D0.slice(4, 6)}-${D0.slice(6, 8)}`,
    picks: [{ code: "9999", name: "測試股", exchange: "TWSE", group: "strongContinuation", groupName: "強勢續攻", price: 100 }],
  }, {
    reference: {
      byCode: new Map([["9999", {
        code: "9999", name: "測試股", exchange: "TWSE", rawDate: D1,
        open: 103, high: 104, low: 97, price: 102, previousClose: 101,
      }]]),
      warnings: [],
    },
    calendar: { tradingDays: [D0, D1], holidayRows: [], warnings: [] },
  });
  const row = noEvent.rows?.[0];
  assert.ok(row, JSON.stringify(noEvent).slice(0, 300));
  assert.equal(row.verified, true);
  assert.equal(row.corporateActionAdjusted, undefined, "沒有官方事件就不得調整");
  assert.equal(row.openReturn, 3, "基準必須維持訊號日收盤 100");
  assert.equal(row.lowReturn, -3);
});
