// D-02：隔日沖的訊號判定改吃還原權息後的序列。
//
// 沒還原時 computeMetrics 拿「陣列前一根 close」當基準，除權息當天算出來的是一個
// 機械性跌幅（配息 8 元就先扣 8%），不是真實漲跌。同一天同一檔因此有兩個漲跌幅：
// 候選池用交易所口徑的 quote.previousClose（＝除權息參考價）、metrics 用前一根 close，
// 一個決定進不進候選池、另一個決定分數與畫面數字。
//
// 實測 2026-07-24 的 260 檔候選池／過去半年 153 個事件日：14.4% 的事件日分群判定會變，
// 其中 17 次是「真實漲幅其實超過 9.5%（貼近漲停、買不到）卻被除息壓進門檻內」——
// 強勢續攻刻意設的 9.5% 上限被靜默繞過。這裡用一檔配息 8 元的股票把整條路徑釘住。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday, compactTradingDay, surveillanceRoutes, stockDayAllRow } from "../helpers/fixtures.mjs";

// 這份 fixture 的前提是「**今天**是交易日，而且今天就是除權息日」——週末兩者都不成立。
// 2026-07-27 用模擬時鐘實測：週六 4 條、週日 3 條轉紅（picks 是空的，引擎根本不產生訊號）。
//
// **不能改用 compactTradingDay(0) 繞過**：那會讓 fixture 的「今天」退到週五，而引擎的今天
// 仍是週六——兩者一旦不一致，「最後一根永遠不被還原」的保護就失效，實測會看到
// 分類從 strongContinuation 變成 pullbackReversal、成交量被 shareFactor 從 3000 砍成 1500。
// 那是被錯誤的前提製造出來的假失敗，比原本的空 picks 更難診斷。
// 正確做法與 signal-intraday-observation 一致：前提不成立就明確跳過並說明原因。
const today = compactToday(0);
const NON_TRADING_TODAY = compactTradingDay(0) !== today;
const SKIP_NON_TRADING = NON_TRADING_TODAY
  ? "今天不是交易日，沒有「今天除權息且引擎產生訊號」的情境可測"
  : false;
const roc = (compact) => `${Number(compact.slice(0, 4)) - 1911}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;

// 事件日（今天）：前收 100、配息 8 → 官方參考價 92；開 92 高 99 低 91.5 收 98。
//   對參考價：+6.52%（強勢續攻 3~9.5% 之內）
//   對前一根收盤 100：−2.00%（三個分群一個都進不去）
const PRE_CLOSE = 100;
const REFERENCE = 92;
const TODAY_BAR = { open: 92, high: 99, low: 91.5, close: 98, lots: 3000 };

// 逐月歷史：事件日之前一律平盤 100／量 1000，方便手算 MA 與量比。
// 事件日的漲跌價差欄用 "X0.00"——上市在除權息日就是這樣遮的（2026-07-26 實測 28/28）。
//
// computeMetrics 要求至少 21 個交易日（算 MA20），getStockHistory 會回溯查詢當月＋前 3 個月
// （monthsBack=4）、不足 fallbackMinRows=60 筆就退去查 Yahoo。原本這裡只有「今天」所在月份
// 有資料、前面月份全回空陣列——若「今天」落在月初 1~20 號，當月天數不到 21 天，
// computeMetrics 直接回 null，整檔股票在 preselectQuotes 之後、沒有任何 warning 的情況下
// 悄悄消失（不是「除權息有事件查不到參考價」那個有 warning 的分支，是更早的資料不足分支）。
// 這個 bug 從測試檔第一版就在，只是從未在真正的自動化 CI 裡跑過（2026-08-05 才第一次跑，
// 而且是月初），本機手動驗證時湊巧多半挑在月中之後跑，所以一直沒被抓到。
// 修法：不管查哪個月，只要是這兩檔代號，一律回傳「那個月的完整天數」的平盤資料
// （事件日除外），讓 history 長度不受「今天是幾號」影響，回溯 3 個月即可穩定超過 60 筆，
// 不會誤觸 Yahoo 備援（Yahoo mock 本身是空的）。
function daysInMonth(yearMonth) {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(4, 6));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function monthRoute(codes) {
  return {
    match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
    reply: (url) => {
      const code = String(url.searchParams.get("stockNo") || "");
      if (!codes.includes(code)) return { stat: "OK", data: [] };
      const month = String(url.searchParams.get("date") || "").slice(0, 6);
      const isCurrentMonth = month === today.slice(0, 6);
      const lastDay = isCurrentMonth ? Number(today.slice(6, 8)) : daysInMonth(month);
      const rows = [];
      for (let day = 1; day <= lastDay; day += 1) {
        const compact = `${month}${String(day).padStart(2, "0")}`;
        const isEventDay = compact === today;
        const bar = isEventDay
          ? TODAY_BAR
          : { open: PRE_CLOSE, high: PRE_CLOSE, low: PRE_CLOSE, close: PRE_CLOSE, lots: 1000 };
        rows.push([
          roc(compact), String(bar.lots * 1000), String(Math.round(bar.close * bar.lots * 1000)),
          bar.open.toFixed(2), bar.high.toFixed(2), bar.low.toFixed(2), bar.close.toFixed(2),
          isEventDay ? "X0.00" : "0.00",
          "1,800",
        ]);
      }
      return { stat: "OK", data: rows };
    },
  };
}

// 官方計算結果表只收錄 2330；2454 同樣被交易所標了除權息（X0.00），但查不到參考價。
const resultRow = [roc(today), "2330", "台積電", String(PRE_CLOSE), String(REFERENCE), "8", "息", "0", "0", "92", "92", "", "", "", ""];

const { mod, mock, dataDir } = await importServer({
  routes: [
    ...surveillanceRoutes({
      reference: [
        { ...stockDayAllRow({ code: "2330", name: "台積電", close: TODAY_BAR.close, open: TODAY_BAR.open, high: TODAY_BAR.high, low: TODAY_BAR.low }), Change: "0.0000" },
        { ...stockDayAllRow({ code: "2454", name: "聯發科", close: TODAY_BAR.close, open: TODAY_BAR.open, high: TODAY_BAR.high, low: TODAY_BAR.low }), Change: "0.0000" },
      ],
      tpexReference: [],
    }),
    monthRoute(["2330", "2454"]),
    { match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/, reply: (url) => (
      String(url.searchParams.get("startDate") || "").startsWith(today.slice(0, 6))
        ? { stat: "OK", data: [resultRow] }
        : { stat: "OK", data: [] }
    ) },
    { match: /www\.tpex\.org\.tw\/www\/zh-tw\/afterTrading\/tradingStock/, reply: { tables: [{ data: [] }] } },
    { match: /query1\.finance\.yahoo\.com/, reply: { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } } },
  ],
});
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const body = await mod.buildOvernightSignals({ persistSnapshot: false });
const allPicks = Object.values(body.groups || {}).flat();
const tsmc = allPicks.find((pick) => pick.code === "2330");

test("除權息當天的漲跌幅以官方參考價為基準，不是前一根收盤", { skip: SKIP_NON_TRADING }, () => {
  assert.ok(tsmc, `2330 應該入選強勢續攻（實際 picks：${JSON.stringify(allPicks.map((p) => [p.code, p.group]))}）`);
  assert.equal(tsmc.group, "strongContinuation");
  // (98 − 92) / 92 = +6.5217%；沒還原的話是 (98 − 100) / 100 = −2%，三個分群全部進不去。
  assert.ok(Math.abs(tsmc.changePct - 6.5217) < 0.001, `漲跌幅要對參考價 92 算（實際 ${tsmc.changePct}）`);
  assert.equal(tsmc.corporateActionBasis.referencePrice, REFERENCE);
  assert.equal(tsmc.corporateActionBasis.source, "exchange-result", "第一順位要走官方計算結果表");
});

test("卡片上的價格與成交量仍是真實成交數字，不得被還原動到", { skip: SKIP_NON_TRADING }, () => {
  // 還原因子從最後一根往回累乘、事件當根在 factor 更新前就寫入，所以最後一根永遠是原值。
  // 這條是整個做法成立的前提：拿還原後的序列算指標，但顯示的價格必須是真的能成交的價格。
  assert.equal(tsmc.price, TODAY_BAR.close, "收盤價要是真實成交價");
  assert.equal(tsmc.volumeLots, TODAY_BAR.lots, "成交量不得被 shareFactor 動到");
  // MA 則是還原後的：事件前的 100 全部乘 0.92 → 92。ma5 = (92×4 + 98) / 5 = 93.2
  assert.ok(Math.abs(tsmc.metrics.ma5 - 93.2) < 1e-6, `ma5 要在還原後的座標系（實際 ${tsmc.metrics.ma5}）`);
  assert.ok(tsmc.metrics.ma20 < PRE_CLOSE, "ma20 同樣要被還原，否則收盤價會假性跌破均線");
  assert.equal(tsmc.metrics.volumeRatio5, 3, "量比＝3000 / 1000（純除息不改股數，shareFactor 為 1）");
});

test("漲跌幅基準改變了要說出來，使用者才對得起「昨天的收盤價」", { skip: SKIP_NON_TRADING }, () => {
  assert.ok(
    tsmc.riskTags.includes("除權息日・漲跌對參考價"),
    `要標明基準（實際 ${JSON.stringify(tsmc.riskTags)}）`,
  );
});

test("交易所說有事件但查不到參考價 → 不編一個數字出來，那一檔不上榜", { skip: SKIP_NON_TRADING }, () => {
  // 2454 的資料與 2330 一模一樣，唯一差別是官方計算結果表沒有它。
  // 跳空只有 8%（< 10.5% heuristic 門檻）→ 推不出比率 → unresolved。
  assert.equal(allPicks.some((pick) => pick.code === "2454"), false, "算不出比率就不該給結論");
  const warningText = (body.warnings || []).join(" ");
  assert.match(warningText, /2454/, `被排除的股票要點名，不能讓它無聲消失：${warningText}`);
  assert.match(warningText, /參考價/, "要說清楚是哪一種資料缺了");
});
