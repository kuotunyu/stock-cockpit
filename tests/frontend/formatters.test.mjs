// 前端格式化函式（jsdom 載入完整 app.js 後以 evalIn 驅動）。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

test("app.js 在 jsdom 中載入無未捕捉錯誤", () => {
  assert.deepEqual(app.jsdomErrors.map((e) => String(e)), []);
  assert.equal(app.evalIn("typeof state"), "object", "頂層 state 應可經 eval 取得");
  assert.equal(app.evalIn("typeof formatNumber"), "function");
});

test("初始化有打 /api/auth/me（initializeApp 有跑）", () => {
  assert.ok(app.fetchLog.some((c) => c.path.includes("/api/auth/me")), JSON.stringify(app.fetchLog.slice(0, 5)));
});

test("formatNumber：整數原樣、小數去尾零、無效 → --", () => {
  assert.equal(app.evalIn("formatNumber(1234567)"), "1234567"); // 整數不加千分位（現行行為）
  assert.equal(app.evalIn("formatNumber(93.6)"), "93.6");
  assert.equal(app.evalIn("formatNumber(93.60)"), "93.6");
  assert.equal(app.evalIn("formatNumber(93.65)"), "93.65");
  assert.equal(app.evalIn("formatNumber(null)"), "0"); // Number(null)===0（現行行為）
  assert.equal(app.evalIn("formatNumber(undefined)"), "--");
  assert.equal(app.evalIn("formatNumber('abc')"), "--");
  assert.equal(app.evalIn("formatNumber(0)"), "0");
});

test("formatSignedPercent：▲▼與平盤", () => {
  assert.equal(app.evalIn("formatSignedPercent(2.5)"), "▲2.50%");
  assert.equal(app.evalIn("formatSignedPercent(-1.07)"), "▼1.07%");
  assert.equal(app.evalIn("formatSignedPercent(0)"), "0.00%");
  assert.equal(app.evalIn("formatSignedPercent(0.004)"), "0.00%", "顯示為 0.00% 時不可仍帶上漲箭頭");
  assert.equal(app.evalIn("formatSignedPercent(-0.004)"), "0.00%", "顯示為 0.00% 時不可仍帶下跌箭頭");
  assert.equal(app.evalIn("formatSignedPercent(0.005)"), "▲0.01%", "0.005 四捨五入後已不是平盤");
  assert.equal(app.evalIn("formatSignedPercent(NaN)"), "--");
});

test("signedDirection／tone／K棒：平盤與缺值統一中性", () => {
  assert.equal(app.evalIn("signedDirection(0.004)"), 0);
  assert.equal(app.evalIn("signedDirection(-0.004)"), 0);
  assert.equal(app.evalIn("signedDirection(0.005)"), 1);
  assert.equal(app.evalIn("signedDirection(-0.005)"), -1);
  assert.equal(app.evalIn("signedDirection(undefined)"), 0);
  assert.equal(app.evalIn("toneFromNet(0.004)"), "muted");
  assert.equal(app.evalIn("signalFromChange(-0.004)"), "white");
  assert.equal(app.evalIn("signalFromChange(undefined)"), "white");
  assert.equal(app.evalIn("formatMarketMove(0.004)"), "0");
});

test("formatShareLots：股數→張、正負號、N/A", () => {
  assert.equal(app.evalIn("formatShareLots(5000)"), "+5 張");
  assert.equal(app.evalIn("formatShareLots(-2500)"), "-2.5 張");
  assert.equal(app.evalIn("formatShareLots(undefined)"), "N/A");
});

test("clampChartValue：夾在上下限", () => {
  assert.equal(app.evalIn("clampChartValue(5, 0, 10)"), 5);
  assert.equal(app.evalIn("clampChartValue(-3, 0, 10)"), 0);
  assert.equal(app.evalIn("clampChartValue(99, 0, 10)"), 10);
});
