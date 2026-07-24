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
