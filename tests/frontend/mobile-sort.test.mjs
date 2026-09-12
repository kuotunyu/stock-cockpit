// 手機排序控制（M2）：表頭在 ≤760px 藏起來，改由 .mobile-sort 的選單＋方向鈕操作同一個 state.sort／sortDir。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("每個行情表前有一顆排序控制，選項來自表頭按鈕，值跟 state 同步", () => {
  app.evalIn(`state.screen = "watchlist"; state.sort = "flow"; state.sortDir = "desc"; renderActiveScreen();`);
  const result = json(`(() => {
    const panel = document.querySelector('[data-screen-panel="watchlist"]');
    const control = panel.querySelector(".mobile-sort");
    const select = control?.querySelector("[data-mobile-sort]");
    return {
      exists: Boolean(control),
      beforeScroller: control?.nextElementSibling?.classList.contains("table-scroller") || control?.nextElementSibling?.classList.contains("watch-table-scroller"),
      options: select ? [...select.options].map((o) => o.value + ":" + o.textContent) : [],
      value: select?.value, dir: control?.querySelector("[data-mobile-sort-dir]")?.textContent,
      count: panel.querySelectorAll(".mobile-sort").length,
    };
  })()`);
  assert.equal(result.exists, true);
  assert.ok(result.options.length >= 4, result.options.join(","));
  assert.ok(result.options.includes("price:漲跌幅"), result.options.join(","));
  assert.ok(result.options.includes("flow:總量"));
  assert.equal(result.value, "flow");
  assert.match(result.dir, /大→小/);
  app.evalIn(`renderActiveScreen();`);
  assert.equal(json(`document.querySelectorAll('[data-screen-panel="watchlist"] .mobile-sort').length`), result.count, "重繪不可重複插入");
});

test("選單改欄位 → state.sort 換、方向重設為 desc；方向鈕切換 asc/desc", () => {
  app.evalIn(`state.screen = "watchlist"; state.sort = "flow"; state.sortDir = "asc"; renderActiveScreen();`);
  app.evalIn(`(() => { const select = document.querySelector('[data-screen-panel="watchlist"] [data-mobile-sort]'); select.value = "price"; select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.deepEqual(json(`[state.sort, state.sortDir]`), ["price", "desc"]);
  app.evalIn(`document.querySelector('[data-screen-panel="watchlist"] [data-mobile-sort-dir]').click()`);
  assert.deepEqual(json(`[state.sort, state.sortDir]`), ["price", "asc"]);
  assert.match(String(app.evalIn(`document.querySelector('[data-screen-panel="watchlist"] [data-mobile-sort-dir]').textContent`)), /小→大/);
  const sorted = json(`[...document.querySelectorAll('[data-screen-panel="watchlist"] .table-head button')].filter((b) => b.classList.contains("is-sorted")).map((b) => b.dataset.sort)`);
  assert.deepEqual(sorted, ["price"], "表頭的 is-sorted 也跟著換（桌機同一個 state）");
});
