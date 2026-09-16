// 2026-09-16 使用者問「為什麼注意？要注意什麼？」：注意標籤的 title 直接講官方理由；明細面板多一區
// 「為什麼／要注意什麼」（注意／處置／全額交割各自的白話），沒有標籤時整區藏起來。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));
const REASON = "最近六個營業日(含當日)累積之最後成交價漲幅達27.11%，當日之成交量較最近六十個營業日日平均成交量放大27.02倍(第三款)當日週轉率達46%(第四款)";

test("注意標籤的 title 講官方理由與累計次數；沒理由時提示點開明細；處置／全額交割維持原本的 note", () => {
  const host = (info) => json(`(() => { const d = document.createElement("div"); d.innerHTML = renderSurveillanceBadge(${JSON.stringify(info)}); const t = d.querySelector(".surv-tag"); return { title: t?.title, text: t?.textContent, cls: t?.className }; })()`);
  const withReason = host({ kind: "attention", label: "注意", note: "", count: 2, reason: REASON });
  assert.equal(withReason.text, "注意");
  assert.match(withReason.title, /^注意股（累計 2 次）：最近六個營業日/);
  const noReason = host({ kind: "attention", label: "注意", note: "", count: 1, reason: "" });
  assert.match(noReason.title, /^注意股：交易所今天列入注意交易資訊/);
  const disposition = host({ kind: "disposition", label: "處置", note: "分盤撮合・預收款券・多不可當沖" });
  assert.equal(disposition.title, "處置：分盤撮合・預收款券・多不可當沖");
  assert.match(json(`(() => { const d = document.createElement("div"); d.innerHTML = renderSurveillanceBadge({ kind: "attention", label: "注意", reason: "<img src=x onerror=alert(1)>" }); return d.querySelector(".surv-tag").getAttribute("title"); })()`), /<img/, "理由是上游文字，走 escapeHtml（屬性值仍是純文字）");
  assert.equal(json(`(() => { const d = document.createElement("div"); d.innerHTML = renderSurveillanceBadge({ kind: "attention", label: "注意", reason: "<img src=x onerror=alert(1)>" }); return d.querySelectorAll("img").length; })()`), 0);
});

test("明細面板：注意股列「為什麼」（官方原文）與「要注意什麼」（處置的前一步）、累計／連天、處置看板入口；沒有標籤整區藏起來", () => {
  const attention = json(`(() => {
    renderDetailSurveillance({ code: "6148", surveillance: { kind: "attention", label: "注意", note: "", count: 3, daysOnList: 2, reason: ${JSON.stringify(REASON)} } });
    const box = el.detailSurveillance;
    return { hidden: box.hidden, text: box.textContent.replace(/\\s+/g, " ").trim(), tag: box.querySelector(".surv-tag")?.className, link: box.querySelector('[data-go-screen="surveillance"]')?.textContent, imgs: box.querySelectorAll("img").length };
  })()`);
  assert.equal(attention.hidden, false);
  assert.match(attention.text, /為什麼.*漲幅達27\.11%/);
  assert.match(attention.text, /要注意什麼.*分盤撮合/);
  assert.match(attention.text, /累計 3 次・連 2 天/);
  assert.equal(attention.tag, "surv-tag is-attention");
  assert.match(attention.link, /處置看板/);

  const noReason = json(`(() => { renderDetailSurveillance({ code: "2330", surveillance: { kind: "attention", label: "注意", note: "", count: 1 } }); return el.detailSurveillance.textContent.replace(/\\s+/g, " "); })()`);
  assert.match(noReason, /沒附具體條款文字/);
  assert.equal(json(`el.detailSurveillance.querySelector(".detail-surv-head small")`), null, "只有 1 次、沒連天數就不印統計");

  const disposition = json(`(() => { renderDetailSurveillance({ code: "1234", surveillance: { kind: "disposition", label: "處置", note: "分盤撮合・預收款券・多不可當沖", daysToRelease: 3, releaseOnNextTradingDay: false } }); return el.detailSurveillance.textContent.replace(/\\s+/g, " "); })()`);
  assert.match(disposition, /還有 3 天出關/);
  assert.match(disposition, /每 5 或 20 分鐘/);

  const changed = json(`(() => { renderDetailSurveillance({ code: "1234", surveillance: { kind: "changed", label: "全額交割", note: "預收全額款券" } }); return el.detailSurveillance.textContent.replace(/\\s+/g, " "); })()`);
  assert.match(changed, /財務或營運疑慮/);

  const none = json(`(() => { renderDetailSurveillance({ code: "2330", surveillance: null }); return { hidden: el.detailSurveillance.hidden, html: el.detailSurveillance.innerHTML }; })()`);
  assert.deepEqual(none, { hidden: true, html: "" });
  const escaped = json(`(() => { renderDetailSurveillance({ code: "1", surveillance: { kind: "attention", label: "注意", reason: "<img src=x onerror=alert(1)>" } }); return el.detailSurveillance.querySelectorAll("img").length; })()`);
  assert.equal(escaped, 0, "官方原文一律 escapeHtml");
});
