// 字串／數值解析工具（特徵化：以現行行為為準）。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer();
const { cleanCode, parseNumber, parsePercentNumber, formatDate, unique, average, pct } = mod;

test("cleanCode：去空白、轉大寫、僅留 0-9A-Z", () => {
  assert.equal(cleanCode(" 2330 "), "2330");
  assert.equal(cleanCode("2330.tw"), "2330TW"); // 字母會保留（設計行為：只濾符號）
  assert.equal(cleanCode("00675L"), "00675L");
  assert.equal(cleanCode("６１２７"), "");      // 全形數字不在 [0-9A-Z] → 被濾掉
  assert.equal(cleanCode(null), "");
  assert.equal(cleanCode(undefined), "");
});

test("parseNumber：千分位／占位符／無效值", () => {
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber("-5.2"), -5.2);
  assert.equal(parseNumber("0"), 0);
  assert.equal(parseNumber("--"), null);
  assert.equal(parseNumber("-"), null);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber(undefined), null);
});

test("parsePercentNumber：去 % 與空白", () => {
  assert.equal(parsePercentNumber("+2.35%"), 2.35);
  assert.equal(parsePercentNumber("-1.2 %"), -1.2);
  assert.equal(parsePercentNumber("--"), null);
});

test("formatDate：西元 8 碼與民國 7 碼", () => {
  assert.equal(formatDate("20260612"), "2026/06/12");
  assert.equal(formatDate("1150612"), "2026/06/12");
  assert.equal(formatDate("2026-06-12"), "2026/06/12"); // 先去非數字再判斷
  assert.equal(formatDate(""), "");
});

test("unique：去重且濾掉空值，保留順序", () => {
  assert.deepEqual(unique([1, 1, 2, "", null, undefined, 3, 2]), [1, 2, 3]);
  assert.deepEqual(unique([0]), [0]); // 0 是合法值，不該被濾
});

test("average：忽略非數值；全空 → null", () => {
  assert.equal(average([1, 2, 3]), 2);
  assert.equal(average([1, null, 2, NaN, 3]), 2);
  assert.equal(average([]), null);
  assert.equal(average([null, undefined]), null);
});

test("pct：分母 0 或非數值 → null", () => {
  assert.equal(pct(50, 200), 25);
  assert.equal(pct(1, 0), null);
  assert.equal(pct(NaN, 5), null);
  assert.equal(pct(5, null), null);
});
