// 處置看板清單管線：只看自選股／市場／分盤篩選、搜尋、排序（survVisibleList）。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
const codes = (expr) => JSON.parse(app.evalIn(`JSON.stringify((${expr}).map(i => i.code))`));

const LIST = JSON.stringify([
  { code: "3147", name: "大綜", exchange: "TPEx", price: 345, changePct: 1.47, interval: 20, turnover: 3.2 },
  { code: "6127", name: "九豪", exchange: "TPEx", price: 93.6, changePct: 9.99, interval: 5, turnover: 8.1 },
  { code: "6830", name: "汎銓", exchange: "TWSE", price: 554, changePct: -1.07, interval: 5, turnover: 1.5 },
  { code: "4402", name: "郡都開發", exchange: "TPEx", price: 16.2, changePct: -4.42, interval: 20, turnover: 12.3 },
]);

function resetState() {
  app.evalIn(`
    state.survMineOnly = false; state.survMarket = "all"; state.survInterval = "all";
    state.survQuery = ""; state.survSort = "default";
    watchLists[1] = new Set(); watchLists[2] = new Set(); watchLists[3] = new Set();
  `);
}

before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

test("預設：原順序、不過濾", () => {
  resetState();
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["3147", "6127", "6830", "4402"]);
});

test("只看自選股", () => {
  resetState();
  app.evalIn(`watchLists[2] = new Set(["6127", "4402"])`); // 任一組自選清單皆算
  app.evalIn(`state.survMineOnly = true`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["6127", "4402"]);
});

test("市場篩選：上市／上櫃", () => {
  resetState();
  app.evalIn(`state.survMarket = "TWSE"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["6830"]);
  app.evalIn(`state.survMarket = "TPEx"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["3147", "6127", "4402"]);
});

test("分盤篩選：僅處置類分頁生效", () => {
  resetState();
  app.evalIn(`state.survInterval = "5"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["6127", "6830"]);
  // 注意股分頁沒有分盤概念 → 篩選不套用
  assert.deepEqual(codes(`survVisibleList(${LIST}, "attention")`).length, 4);
});

test("搜尋：代號與名稱皆可", () => {
  resetState();
  app.evalIn(`state.survQuery = "44"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["4402"]);
  app.evalIn(`state.survQuery = "九豪"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["6127"]);
  app.evalIn(`state.survQuery = "  "`); // 空白 → 不過濾
  assert.equal(codes(`survVisibleList(${LIST}, "inDisposition")`).length, 4);
});

test("排序：漲跌幅／週轉率／代號", () => {
  resetState();
  app.evalIn(`state.survSort = "changeDesc"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["6127", "3147", "6830", "4402"]);
  app.evalIn(`state.survSort = "changeAsc"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["4402", "6830", "3147", "6127"]);
  app.evalIn(`state.survSort = "turnoverDesc"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["4402", "6127", "3147", "6830"]);
  app.evalIn(`state.survSort = "code"`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["3147", "4402", "6127", "6830"]);
});

test("組合：市場＋搜尋＋排序疊加", () => {
  resetState();
  app.evalIn(`state.survMarket = "TPEx"; state.survSort = "changeDesc"; state.survQuery = ""`);
  assert.deepEqual(codes(`survVisibleList(${LIST}, "inDisposition")`), ["6127", "3147", "4402"]);
});
