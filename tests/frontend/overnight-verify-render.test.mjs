// 隔日表現驗證前端：實際下一交易日、盤中／正式語意、部分資料不混入長期累計。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const normalized = (html) => String(html).replace(/\s+/g, " ").trim();

test('開盤有效一天不得借20個收盤日顯示CI或綠燈，缺欄不是0%', () => {
  const metric={value:null,validCount:0,totalCount:20,missingCount:20,validDays:0};
  const html=normalized(app.evalIn(`(() => {
    verifyHistoryState.data={ records:[{asOf:'2026-09-01',status:'final',complete:true,verified:1,signals:1}],
      totals:{days:20,signals:20,winAtOpen:0,ci:{winAtOpen:{low:0.9,high:1}},metricCoverage:{winAtOpen:${JSON.stringify(metric)}}} };
    return renderVerifyHistory(); })()`));
  assert.doesNotMatch(html,/positive/);
  assert.doesNotMatch(html,/區間 90/);
  assert.doesNotMatch(html,/淨獲利率[^<]*0%/);
});

test('新正式母體只提供帶限制的區間，採集覆蓋未知不亮確定性綠燈', () => {
  const html=normalized(app.evalIn(`(() => {
    const headline={days:20,signals:20,winAtOpen:20,metricCoverage:{winAtOpen:{value:1,validCount:20,totalCount:20,missingCount:0,validDays:20}},ci:{winAtOpen:{low:0.9,high:1}}};
    verifyHistoryState.data={records:[{status:'final',complete:true,signals:1,verified:1}],cohort:{headline,models:[]},captureCoverage:{expectedDateReason:'official-session-dates-only'}};
    return renderVerifyHistory(); })()`));
  assert.match(html,/區間 90～100%/);
  assert.doesNotMatch(html,/class="positive"/);
});

test("單日驗證顯示訊號日到實際下一交易日、完成比例與正式／盤中語意", () => {
  const finalHtml = normalized(app.evalIn(`(() => {
    verifyState.data = {
      ok: true,
      available: true,
      signalDate: "2026-07-10",
      observationDate: "2026-07-13",
      observationPhase: "final",
      expectedSignals: 2,
      verifiedSignals: 2,
      summary: { total: 2, hitPlus2: 1, brokeMinus2: 0, avgCurrentReturn: 1.25 },
      rows: [
        { code: "2330", name: "台積電", currentReturn: 2.5, highReturn: 3.1, hitPlus2: true },
        { code: "1101", name: "台泥", currentReturn: null, highReturn: null, hitPlus2: false },
      ],
    };
    verifyState.loading = false;
    verifyState.error = "";
    return renderSignalVerification();
  })()`));

  assert.match(finalHtml, /隔日表現驗證/);
  assert.match(finalHtml, /07\/10 訊號 → 07\/13 實際下一交易日 · 正式收盤/);
  assert.match(finalHtml, /已驗證 2\/2/);
  assert.match(finalHtml, /平均收盤/);
  assert.doesNotMatch(finalHtml, /昨日訊號驗證/);

  const host = app.doc.createElement("div");
  host.innerHTML = finalHtml;
  const neutral = host.querySelector('[data-overnight-code="1101"]');
  assert.ok(neutral);
  assert.equal(neutral.classList.contains("is-up"), false, "缺值不可被 Number(null) 誤標成上漲");
  assert.equal(neutral.classList.contains("is-down"), false);

  const intradayHtml = normalized(app.evalIn(`(() => {
    verifyState.data.observationPhase = "intraday";
    verifyState.data.verifiedSignals = 1;
    return renderSignalVerification();
  })()`));
  assert.match(intradayHtml, /盤中暫定/);
  assert.match(intradayHtml, /已驗證 1\/2/);
  assert.match(intradayHtml, /平均現價/);
  assert.match(intradayHtml, /盤中結果不會寫入正式長期統計/);
});

test("歷史驗證以訊號→觀察呈現，partial 明示暫不納入累計", () => {
  const html = normalized(app.evalIn(`(() => {
    verifyHistoryState.data = {
      ok: true,
      totals: { days: 1, signals: 2, hitPlus2: 1, brokeMinus2: 0, avgCloseReturn: 1.25 },
      records: [
        {
          asOf: "2026-07-10", observationDate: "2026-07-13", status: "final",
          pending: false, complete: true, signals: 2, verified: 2, hitPlus2: 1,
          brokeMinus2: 0, avgHighReturn: 2.4, avgCloseReturn: 1.25,
        },
        {
          asOf: "2026-07-09", observationDate: "2026-07-10", status: "partial",
          pending: true, complete: false, signals: 3, verified: 2,
        },
      ],
    };
    verifyHistoryState.loading = false;
    verifyHistoryState.error = "";
    return renderVerifyHistory();
  })()`));

  assert.match(html, /訊號→觀察/);
  assert.match(html, /07\/10→07\/13/);
  assert.match(html, /07\/09→07\/10/);
  assert.match(html, /2\/3 檔/);
  assert.match(html, /部分官方行情待補，暫不納入累計/);
  assert.match(html, /累計 1 天 \/ 2 檔/);
  assert.match(html, /部分資料不進累計/);
});

test("單日驗證：勝率改成可執行口徑（開盤賣／收盤賣），觸及改名「曾達／曾破」，不到一半不染綠", () => {
  const html = normalized(app.evalIn(`(() => {
    verifyState.data = {
      ok: true, available: true, signalDate: "2026-07-10", observationDate: "2026-07-13", observationPhase: "final",
      expectedSignals: 4, verifiedSignals: 4,
      summary: { total: 4, hitPlus2: 1, brokeMinus2: 2, winAtOpen: 3, winAtClose: 1, avgOpenReturn: 0.8, avgOpenReturnNet: 0.33, avgCurrentReturn: -0.2 },
      rows: [],
    };
    verifyState.loading = false;
    verifyState.error = "";
    return renderSignalVerification();
  })()`));
  assert.match(html, /開盤賣勝率 3\/4/);
  assert.match(html, /收盤賣勝率 1\/4/);
  assert.match(html, /盤中曾達 \+2%：1\/4/);
  assert.match(html, /盤中曾破 −2%：2\/4/);
  assert.match(html, /平均開盤/);
  assert.doesNotMatch(html, /達\+2%：/, "舊文案不可殘留");
  const host = app.doc.createElement("div");
  host.innerHTML = html;
  const chips = [...host.querySelectorAll(".verify-stats span")];
  assert.ok(chips.find((c) => c.textContent.includes("開盤賣勝率")).classList.contains("positive"), "3/4 ≥ 50% 染紅");
  assert.equal(chips.find((c) => c.textContent.includes("收盤賣勝率")).classList.contains("positive"), false);
  assert.ok(chips.every((c) => !c.classList.contains("negative")), "不到一半不可用綠色（綠＝跌）");
});

test("長期成績單：未滿 20 天不染色且顯示累積中；達到後附信賴區間、染色看下界", () => {
  const render = (totals) => normalized(app.evalIn(`(() => {
    verifyHistoryState.data = { ok: true, totals: ${JSON.stringify(totals)}, records: [
      { asOf: "2026-07-10", observationDate: "2026-07-13", status: "final", pending: false, complete: true,
        signals: 2, verified: 2, hitPlus2: 1, brokeMinus2: 0, winAtOpen: 2, winAtClose: 1, avgOpenReturn: 0.9, avgHighReturn: 2.4, avgCloseReturn: 1.25 },
    ] };
    verifyHistoryState.loading = false;
    verifyHistoryState.error = "";
    return renderVerifyHistory();
  })()`));
  const few = render({ days: 5, signals: 60, hitPlus2: 40, brokeMinus2: 10, winAtOpen: 45, winAtClose: 33, avgOpenReturn: 0.5, avgCloseReturn: 0.3, minDays: 20,
    ci: { hitPlus2: { n: 5, mean: 0.66, low: 0.55, high: 0.77 }, winAtOpen: { n: 5, mean: 0.75, low: 0.6, high: 0.9 }, winAtClose: null } });
  assert.match(few, /累積中 5\/20 天/);
  assert.doesNotMatch(few, /（區間 \d+～\d+%）/, "未滿 20 天不顯示區間");
  let host = app.doc.createElement("div");
  host.innerHTML = few;
  assert.ok([...host.querySelectorAll(".verify-stats span")].every((c) => !c.classList.contains("positive")), "未滿 20 天不染色");

  const enough = render({ days: 25, signals: 300, hitPlus2: 200, brokeMinus2: 50, winAtOpen: 225, winAtClose: 120, avgOpenReturn: 0.5, avgCloseReturn: 0.3, minDays: 20,
    ci: { hitPlus2: { n: 25, mean: 0.66, low: 0.45, high: 0.87 }, winAtOpen: { n: 25, mean: 0.75, low: 0.6, high: 0.9 }, winAtClose: null } });
  // 括號要有「區間」標籤：散戶第一眼會把「75%（60～90%）」讀成範圍勝率或某種區間報酬。
  const enoughText = enough.replace(/<[^>]+>/g, "");
  assert.match(enoughText, /開盤觀察淨獲利率 75%（區間 60～90%）/);
  assert.match(enoughText, /曾達\+2% 67%（區間 45～87%）/);
  assert.match(enough, /data-glossary-term="開盤賣勝率"/, "標籤要能點開名詞解釋");
  host = app.doc.createElement("div");
  host.innerHTML = enough;
  const chips = [...host.querySelectorAll(".verify-stats span")];
  assert.ok(chips.find((c) => c.textContent.includes("開盤觀察淨獲利率")).classList.contains("positive"), "下界 60% ≥ 50% 染色");
  assert.equal(chips.find((c) => c.textContent.includes("曾達+2%")).classList.contains("positive"), false, "點估計 67% 但下界 45% 不染");
  assert.match(enough, /開盤賣勝率.*曾達\+2%.*曾破−2%.*平均開盤.*平均收盤/, "表頭七欄");
  assert.match(enough, /100%/, "該日 winAtOpen 2/2");
});

test("策略表現面板：明講 look-ahead 取樣與偏誤量級，卡片回測門檻 10 次", () => {
  const html = normalized(app.evalIn(`(() => {
    backtestState.loading = false;
    backtestState.error = "";
    backtestState.data = { days: 30, generatedAt: "2026-09-04T14:00:00+08:00", sampleCodes: ["2330"],
      summary: { strongContinuation: { groupName: "強勢續攻", sampleSize: 12, hitPlus2Rate: 0.5, brokeMinus2Rate: 0.2, winAtOpenRate: 0.4, winAtCloseRate: 0.3, avgOpenReturn: 0.3, avgHighReturn: 1.5, avgCloseReturn: 0.2 } } };
    return renderBacktestPerformance();
  })()`));
  assert.match(html, /事後挑樣本（look-ahead）/, "先講白話再放原文");
  assert.match(html, /\+0\.3～0\.5/);
  assert.match(html, /候選股自身的歷史統計/);
  assert.doesNotMatch(html, /策略表現（近/);
  assert.match(html, /開盤賣勝率/);
  const few = app.evalIn(`renderBacktestChips({ sampleSize: 8, hitPlus2Rate: 1, avgCloseReturn: 3 })`);
  assert.match(few, /樣本不足/);
  const enough = app.evalIn(`renderBacktestChips({ sampleSize: 12, hitPlus2Rate: 0.5, avgCloseReturn: 3 })`);
  assert.doesNotMatch(enough, /樣本不足/);
});

test("長期成績單：依大盤季線上／下分層的一行", () => {
  const html = normalized(app.evalIn(`(() => {
    verifyHistoryState.data = { ok: true, records: [
      { asOf: "2026-07-10", observationDate: "2026-07-13", status: "final", pending: false, complete: true, signals: 2, verified: 2, hitPlus2: 1, brokeMinus2: 0, winAtOpen: 2, winAtClose: 1, avgOpenReturn: 0.9, avgCloseReturn: 1.25 },
    ], totals: { days: 30, signals: 300, hitPlus2: 100, brokeMinus2: 50, winAtOpen: 150, winAtClose: 100,
      minDays: 20, ci: {}, byRegime: {
        aboveMa60: { days: 20, signals: 200, hitPlus2: 80, winAtOpen: 120, winAtClose: 80, avgCloseReturn: 0.4, minDays: 20, ci: { winAtOpen: { n: 20, mean: 0.6, low: 0.52, high: 0.68 }, winAtClose: null } },
        belowMa60: { days: 8, signals: 80, hitPlus2: 20, winAtOpen: 24, winAtClose: 16, avgCloseReturn: -0.6, minDays: 20, ci: { winAtOpen: { n: 8, mean: 0.3, low: 0.1, high: 0.5 }, winAtClose: null } },
        unknown: { days: 2, signals: 20, hitPlus2: 0, winAtOpen: 6, winAtClose: 4, avgCloseReturn: 0, minDays: 20, ci: { winAtOpen: null, winAtClose: null } } } } };
    verifyHistoryState.loading = false;
    verifyHistoryState.error = "";
    return renderVerifyHistory();
  })()`));
  assert.match(html, /大盤季線上 20 天：開盤賣 60%（區間 52～68%）・收盤賣 40%/);
  assert.match(html, /季線下 8 天（累積中 8\/20）/, "未滿最小天數的分層不印百分比");
  assert.doesNotMatch(html, /季線下 8 天：開盤賣/);
  assert.match(html, /位階未知 2 天/);
});
