// D-21 的接線驗證：/api/technical-analysis 真的跑在還原後的價格上，而且官方欄位不齊時
// 不會把「沒評估」畫成「沒滿足條件」。純函式那層在 technical-back-adjust.test.mjs。
// 這裡刻意走 buildTechnicalAnalysis 本體（含 getReferenceData／getStockHistory／archive 讀取），
// 因為 D-21 的真正風險是「函式寫好了但沒接上去」。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, surveillanceRoutes, stockDayAllRow } from "../helpers/fixtures.mjs";

const today = compactToday(0);
// 除息日固定在「上個月 10 號」：一定落在 180 根日 K 的可見區間內，也一定已經過去了。
const previousMonth = (() => {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(4, 6));
  return month === 1 ? `${year - 1}12` : `${year}${String(month - 1).padStart(2, "0")}`;
})();
const EX_DATE = `${previousMonth}10`;

// 完整除息（可還原）與缺欄位的除權息（unresolved）各給一檔，共用同一份 archive——
// loadFundamentalsHistory 每個行程只讀一次，不能靠改檔案切換情境。
const ARCHIVE = {
  revenue: {},
  eps: {},
  valuation: {},
  dividends: {
    2330: {
      [EX_DATE]: {
        kind: "息",
        cashDividend: 8,
        stockRatio: 0,
        subscriptionRatio: 0,
        subscriptionPrice: null,
        source: "test",
        schemaVersion: 2,
        formulaComplete: true,
        status: "active",
      },
    },
    2999: {
      [EX_DATE]: {
        kind: "息",
        cashDividend: 8,
        stockRatio: 0,
        subscriptionRatio: null,
        subscriptionPrice: null,
        source: "test",
        schemaVersion: 2,
        formulaComplete: true,
        status: "active",
      },
    },
    2998: {
      [EX_DATE]: {
        kind: "權息",
        cashDividend: 2,
        stockRatio: 0.1,
        subscriptionRatio: 0,
        subscriptionPrice: 0,
        source: "test",
        schemaVersion: 2,
        formulaComplete: true,
        status: "active",
      },
    },
    2454: {
      [EX_DATE]: {
        // 除權必須 stockRatio 與 subscriptionRatio 都是明確數值才算公式齊備。
        kind: "權息",
        cashDividend: 2,
        stockRatio: null,
        subscriptionRatio: null,
        subscriptionPrice: null,
        source: "test",
        schemaVersion: 2,
        formulaComplete: true,
        status: "active",
      },
    },
  },
};

// 2330／2454：除息前一律 100、除息日起一律 92（-8%，進不了 10.5% 的跳空門檻 → 只能靠官方公告還原）。
// 1234／00631L：同一天 -15% 跳空但完全沒有官方公告 → 只有跳空估算還原救得了，用來分辨普通股與 ETF。
const GAP_CODES = new Set(["1234", "00631L"]);
function stockDayMonthRoute() {
  return {
    match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
    reply: (url) => {
      const stockNo = url.searchParams.get("stockNo");
      if (!["2330", "2454", ...GAP_CODES].includes(stockNo)) return { stat: "OK", data: [] };
      const monthCompact = String(url.searchParams.get("date") || "");
      const year = Number(monthCompact.slice(0, 4));
      const month = Number(monthCompact.slice(4, 6));
      const rows = [];
      let previousClose = null;
      for (let day = 1; day <= 28; day += 1) {
        const compact = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
        if (compact >= today) break;
        const postPrice = GAP_CODES.has(stockNo) ? 85 : 92;
        const close = compact >= EX_DATE ? postPrice : 100;
        // 漲跌價差欄要照真實 TWSE 語意產生，否則測試會建立現實中不可能出現的形狀：
        //   有官方事件的除權息日 → "X0.00"（不計算漲跌，close-change 推不出昨收）
        //   其他每一天         → close 減前一交易日收盤的實際差額
        // GAP_CODES 刻意沒有官方事件（測跳空估算還原），所以它的跳空日照樣給正常數字。
        const isOfficialExDay = compact === EX_DATE && !GAP_CODES.has(stockNo);
        const change = isOfficialExDay
          ? "X0.00"
          : previousClose === null ? "0.00" : (close - previousClose).toFixed(2);
        rows.push([
          `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
          "2,500,000",
          String(Math.round(close * 2.5e6)),
          close.toFixed(2),
          close.toFixed(2),
          close.toFixed(2),
          close.toFixed(2),
          change,
          "1,800",
        ]);
        previousClose = close;
      }
      return { stat: "OK", data: rows };
    },
  };
}

// 只有 2999 有 Yahoo 資料（官方逐月歷史回空 → 走備援），用來驗「備援序列也會被還原、
// 而且必須揭露 Yahoo 原始價的還原語意尚未實測」。其他代號一律回空。
function yahooHistoryRoute() {
  return {
    match: /query1\.finance\.yahoo\.com/,
    reply: (url) => {
      const path = String(url.pathname);
      // 2999：純現金除息 8 元（Yahoo 不做任何分割調整，事件前後都是原始價）。
      // 2998：配股 10%＋現金 2 元。Yahoo 事件前的收盤已經自己除過配股（100 / 1.1 = 90.9091），
      //       事件當天起是原始價（官方參考價 (100-2)/1.1 = 89.0909）。
      const isCash = path.includes("2999");
      const isStock = path.includes("2998");
      if (!isCash && !isStock) {
        return { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } };
      }
      const timestamp = [];
      const open = []; const high = []; const low = []; const close = []; const volume = [];
      const start = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 120);
      for (let i = 0; i < 120; i += 1) {
        const day = new Date(start);
        day.setUTCDate(day.getUTCDate() + i);
        const compact = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
        if (compact >= today) break;
        const beforeEx = isCash ? 100 : 100 / 1.1;
        const afterEx = isCash ? 92 : (100 - 2) / 1.1;
        const price = compact >= EX_DATE ? afterEx : beforeEx;
        timestamp.push(Math.floor(day.getTime() / 1000));
        open.push(price); high.push(price); low.push(price); close.push(price); volume.push(2500000);
      }
      return { chart: { result: [{ timestamp, indicators: { quote: [{ open, high, low, close, volume }] } }] } };
    },
  };
}

let mod;
let mock;
let dataDir;
before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "stock1-d21-"));
  await writeFile(join(dataDir, "fundamentals-cache.json"), JSON.stringify(ARCHIVE), "utf8");
  ({ mod, mock } = await importServer({
    dataDir,
    routes: [
      ...surveillanceRoutes({
        reference: [
          stockDayAllRow({ code: "2330", name: "台積電", close: 92, open: 92, high: 92, low: 92 }),
          stockDayAllRow({ code: "2454", name: "聯發科", close: 92, open: 92, high: 92, low: 92 }),
          stockDayAllRow({ code: "1234", name: "黑松", close: 85, open: 85, high: 85, low: 85 }),
          stockDayAllRow({ code: "00631L", name: "元大台灣50正2", close: 85, open: 85, high: 85, low: 85 }),
          stockDayAllRow({ code: "2999", name: "備援純現金", close: 92, open: 92, high: 92, low: 92 }),
          stockDayAllRow({ code: "2998", name: "備援配股", close: 89.09, open: 89.09, high: 89.09, low: 89.09 }),
        ],
      }),
      stockDayMonthRoute(),
      // 官方除權除息計算結果表回空：這幾條測的是「歸檔公告＋跳空估算」那兩層，
      // 計算結果表本身由 corporate-action-results.test.mjs 負責。
      { match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/, reply: { stat: "OK", data: [] } },
      { match: /www\.tpex\.org\.tw\/www\/zh-tw\/afterTrading\/tradingStock/, reply: { tables: [{ data: [] }] } },
      yahooHistoryRoute(),
    ],
  }));
});
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test("D-21：技術分析頁的日 K 已依官方除息公告還原，兩頁不再對同一檔給相反結論", async () => {
  const body = await mod.buildTechnicalAnalysis({ code: "2330", period: "day" });
  assert.equal(body.ok, true, `error=${body.error}`);

  const compact = (date) => String(date).replace(/\D/g, "");
  const before = body.candles.filter((candle) => compact(candle.date) < EX_DATE);
  const onOrAfter = body.candles.filter((candle) => compact(candle.date) >= EX_DATE);
  assert.ok(before.length > 0 && onOrAfter.length > 0, "測試資料要同時涵蓋除息前後");

  for (const candle of before) {
    assert.ok(
      Math.abs(candle.close - 92) < 1e-6,
      `${candle.date} 除息前的收盤要還原成 92（未還原時是 100），實際 ${candle.close}`,
    );
  }
  assert.equal(onOrAfter.at(-1).close, 92, "最新一根維持實際成交價");

  // 未還原時，MA5 會在除息日之後被 100 拖高 → 看起來「跌破 5 日線 6.5%」。還原後貼合。
  const last = body.candles.at(-1);
  assert.ok(Math.abs(last.maShort - 92) < 1e-6, `MA5 應貼合 92，實際 ${last.maShort}`);
  assert.ok(Math.abs(last.maMid - 92) < 1e-6, `MA20 應貼合 92，實際 ${last.maMid}`);

  assert.equal(body.corporateActions.source, "official");
  assert.deepEqual(body.corporateActions.events.map((event) => event.date), [EX_DATE]);
  assert.equal(body.corporateActions.adjusted, true);
  assert.ok(!body.signals.suppressed, "欄位齊備就照常給型態結論");
});

test("D-21：官方欄位不齊 → 圖照畫，但型態結論整組停掉並標 suppressed", async () => {
  const body = await mod.buildTechnicalAnalysis({ code: "2454", period: "day" });
  assert.equal(body.ok, true, "圖形仍可呈現，不像波段健檢那樣整頁擋掉");
  assert.ok(body.candles.length >= 30, "K 線照給");
  assert.deepEqual(body.corporateActions.unresolvedDates, [EX_DATE]);
  assert.equal(body.signals.suppressed, "corporate-action-unresolved");
  assert.equal(body.signals.breakout, false);
  assert.equal(body.signals.breakdown, false);
  assert.equal(body.signals.longWatch, false);
  assert.deepEqual(body.signals.signals, [], "不能給「尚未出現明確突破訊號」這種已評估過的說法");
  assert.deepEqual(body.signals.risks, []);
  assert.equal(body.fibonacci.active, false, "費波回撤建立在突破結論上，一起停掉");
  assert.match(body.corporateActions.notes.join(" "), /暫不提供型態結論/);
});

// 這條釘的是「呼叫端有沒有真的把 isOrdinaryStock 接上去」——把參數寫死成 true 的話，
// 純函式測試全過但 ETF 會被跳空估算還原毀掉，所以一定要從 buildTechnicalAnalysis 本體驗。
test("D-21：跳空估算還原的開關綁在 isOrdinaryStock 上，ETF 代號不得沿用普通股規則", async () => {
  const ordinary = await mod.buildTechnicalAnalysis({ code: "1234", period: "day" });
  assert.equal(ordinary.ok, true, `error=${ordinary.error}`);
  assert.equal(ordinary.corporateActions.heuristicAllowed, true, "四碼普通股可以估算還原");
  assert.equal(ordinary.corporateActions.source, "heuristic");
  const ordinaryBefore = ordinary.candles.filter((candle) => String(candle.date).replace(/\D/g, "") < EX_DATE);
  assert.ok(
    ordinaryBefore.every((candle) => Math.abs(candle.close - 85) < 1e-6),
    "普通股：-15% 跳空前的歷史被估算還原到 85",
  );

  const leveraged = await mod.buildTechnicalAnalysis({ code: "00631L", period: "day" });
  assert.equal(leveraged.ok, true, `error=${leveraged.error}`);
  assert.equal(leveraged.corporateActions.heuristicAllowed, false, "槓反 ETF 沒有 ±10% 漲跌幅前提");
  assert.equal(leveraged.corporateActions.adjusted, false);
  const leveragedBefore = leveraged.candles.filter((candle) => String(candle.date).replace(/\D/g, "") < EX_DATE);
  assert.ok(
    leveragedBefore.every((candle) => candle.close === 100),
    "ETF：一天真的可以跌 15%，不能追認成公司行動把歷史全乘上假比率",
  );
});

// 技術頁在官方逐月歷史不足時會退到 Yahoo。2026-07-26 用真實 API 實測 4 檔配股個股：
// Yahoo 的 indicators.quote 已經把台股配股當成分割自行還原（30% 配股回報 1300:1000 的 split），
// 但現金股利沒有還原（純現金的對照組 2002 中鋼與官方收盤完全相等）。
// 所以 Yahoo 的價格座標系跟官方逐檔歷史差一個配股倍數，官方來源算出來的因子必須換算過才能用。
test("D-21：Yahoo 備援序列的純現金除息照常還原，並揭露來源差異", async () => {
  const body = await mod.buildTechnicalAnalysis({ code: "2999", period: "day" });
  assert.equal(body.ok, true, `error=${body.error}`);
  assert.match(body.source, /^Yahoo/, "這條測的就是備援路徑");
  assert.equal(body.corporateActions.adjusted, true, "備援序列不能因為來源不同就跳過還原");

  // 純現金除息沒有配股，Yahoo 不會做任何分割調整 → 倍數 1，官方因子直接可用。
  const before = body.candles.filter((candle) => String(candle.date).replace(/\D/g, "") < EX_DATE);
  assert.ok(before.length > 0 && before.every((candle) => Math.abs(candle.close - 92) < 1e-6));

  assert.match(body.corporateActions.notes.join(" "), /Yahoo 備援序列/);
  assert.equal(body.corporateActions.alert, true, "來源語意不同就該升級成醒目提示");
});

// 這條是雙重還原的守門測試。配股 10%＋現金 2 元、原始前收 100：
//   官方參考價 = (100 − 2) / 1.1 = 89.0909，原始座標系因子 = 0.890909
//   Yahoo 事件前的收盤已經是 100 / 1.1 = 90.9091（它自己除過配股了）
//   正確的 Yahoo 座標系因子 = (100 − 2) / 100 = 0.98 → 90.9091 × 0.98 = 89.0909 ✓
// 若直接把 0.890909 套到 90.9091 會得到 80.99，配股被還原兩次、事件前整段被壓低 9%。
test("D-21：Yahoo 序列的配股事件不得雙重還原", async () => {
  const body = await mod.buildTechnicalAnalysis({ code: "2998", period: "day" });
  assert.equal(body.ok, true, `error=${body.error}`);
  assert.match(body.source, /^Yahoo/);

  const before = body.candles.filter((candle) => String(candle.date).replace(/\D/g, "") < EX_DATE);
  assert.ok(before.length > 0, "測試資料要涵蓋事件前");
  const adjusted = before.at(-1).close;
  assert.ok(
    Math.abs(adjusted - 89.0909) < 0.01,
    `事件前的 Yahoo 收盤應還原到官方參考價 89.09，實際 ${adjusted}（80.99 代表配股被還原了兩次）`,
  );
  assert.ok(Math.abs(adjusted - 80.99) > 1, "明確排除雙重還原的結果");
});
