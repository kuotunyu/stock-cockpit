// 手機明細抽屜（M3，2026-09-13）：把手手勢的判定、每次開啟回到半屏、到價提醒說明摺進 ⓘ。
// 幾何（58%／92% 高度、把手、價格一行）在 tests/browser/mobile-shell.test.mjs 量。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("把手手勢判定：原地點一下切換、往上 60px 拉滿、往下 80px 關閉、拉滿時往下 40px 回半屏", () => {
  const cases = [
    [{ dy: 0, moved: false, full: false }, "toggle"],
    [{ dy: 3, moved: false, full: true }, "toggle"],
    [{ dy: -70, moved: true, full: false }, "expand"],
    [{ dy: -70, moved: true, full: true }, "none"],
    [{ dy: 90, moved: true, full: false }, "close"],
    [{ dy: 90, moved: true, full: true }, "close"],
    [{ dy: 50, moved: true, full: true }, "collapse"],
    [{ dy: 50, moved: true, full: false }, "none"],
    [{ dy: -20, moved: true, full: false }, "none"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(app.evalIn(`resolveDetailSheetGesture(${JSON.stringify(input)})`), expected, JSON.stringify(input));
  }
});

test("每次開明細都回到半屏：拉滿後關閉再開，is-full 清掉", () => {
  app.evalIn("setDetailSheetFull(true)");
  assert.equal(json(`el.detailPanel.classList.contains("is-full")`), true);
  app.evalIn(`openDetailPanel(); closeDetailPanel({ viaHistory: true }); openDetailPanel();`);
  assert.equal(json(`el.detailPanel.classList.contains("is-open")`), true);
  assert.equal(json(`el.detailPanel.classList.contains("is-full")`), false, "上一次拉滿不帶到下一次開啟");
  app.evalIn(`closeDetailPanel({ viaHistory: true })`);
  assert.equal(json(`el.detailPanel.classList.contains("is-open")`), false);
});

test("到價提醒說明摺進 ⓘ：預設收起、點一下展開、重繪後保持", () => {
  app.evalIn(`renderPriceAlertBox({ code: "2330", name: "台積電", price: 1000 })`);
  const first = json(`(() => {
    const box = el.priceAlertBox;
    const toggle = box.querySelector("[data-alert-help]");
    return { has: Boolean(toggle), expanded: toggle?.getAttribute("aria-expanded"), open: box.classList.contains("is-help-open"),
      hint: box.querySelector(".alert-head small")?.textContent || "" };
  })()`);
  assert.equal(first.has, true, "到價提醒標題旁有 ⓘ");
  assert.equal(first.expanded, "false");
  assert.equal(first.open, false);
  assert.ok(first.hint.length > 0, "說明文字仍在 DOM（桌機直接顯示，手機由 CSS 收起）");
  app.evalIn(`el.priceAlertBox.querySelector("[data-alert-help]").click()`);
  assert.equal(json(`el.priceAlertBox.classList.contains("is-help-open")`), true);
  assert.equal(json(`el.priceAlertBox.querySelector("[data-alert-help]").getAttribute("aria-expanded")`), "true");
  app.evalIn(`renderPriceAlertBox({ code: "2330", name: "台積電", price: 1000 })`);
  assert.equal(json(`el.priceAlertBox.classList.contains("is-help-open")`), true, "重繪後保持展開");
  assert.equal(json(`el.priceAlertBox.querySelector("[data-alert-help]").getAttribute("aria-expanded")`), "true");
  app.evalIn(`el.priceAlertBox.querySelector("[data-alert-help]").click()`);
  assert.equal(json(`el.priceAlertBox.classList.contains("is-help-open")`), false, "再點一下收起");
});
