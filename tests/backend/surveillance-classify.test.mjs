// 處置／注意／全額交割：來源分類、期間解析、分盤間隔、單檔優先序查詢。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer();
const {
  SURVEILLANCE_RANK, classifySurveillance,
  parseDispositionPeriod, parseDispositionInterval, lookupStockSurveillance,
} = mod;

test("classifySurveillance：三類正規化", () => {
  const disp = classifySurveillance("TWSE 處置股");
  assert.equal(disp.kind, "disposition");
  assert.equal(disp.label, "處置");
  assert.ok(disp.note.includes("分盤"));

  const changed = classifySurveillance("TWSE 變更交易");
  assert.equal(changed.kind, "changed");
  assert.equal(changed.label, "全額交割");

  const attn = classifySurveillance("TPEx 注意股");
  assert.equal(attn.kind, "attention");
  assert.equal(attn.label, "注意");
});

test("SURVEILLANCE_RANK：處置 > 全額交割 > 注意", () => {
  assert.ok(SURVEILLANCE_RANK.disposition > SURVEILLANCE_RANK.changed);
  assert.ok(SURVEILLANCE_RANK.changed > SURVEILLANCE_RANK.attention);
});

test("parseDispositionPeriod：TWSE 民國斜線（全形～）", () => {
  assert.deepEqual(parseDispositionPeriod("115/06/12～115/06/26"), { start: "20260612", end: "20260626" });
});

test("parseDispositionPeriod：TPEx 民國 7 碼（半形~）", () => {
  assert.deepEqual(parseDispositionPeriod("1150626~1150709"), { start: "20260626", end: "20260709" });
});

test("parseDispositionPeriod：單一日期（無迄日）→ 迄=起；垃圾 → 空字串", () => {
  assert.deepEqual(parseDispositionPeriod("1150626"), { start: "20260626", end: "20260626" });
  const bad = parseDispositionPeriod("garbage");
  assert.equal(bad.start, "");
  assert.equal(bad.end, "");
});

test("parseDispositionInterval：五分鐘／二十分鐘各種寫法", () => {
  assert.equal(parseDispositionInterval("每五分鐘撮合一次"), 5);
  assert.equal(parseDispositionInterval("每5分鐘撮合"), 5);
  assert.equal(parseDispositionInterval("約每二十分鐘撮合一次"), 20);
  assert.equal(parseDispositionInterval("每 20 分鐘"), 20);
  assert.equal(parseDispositionInterval("預收款券"), null);
  assert.equal(parseDispositionInterval(""), null);
});

// ---- lookupStockSurveillance：優先序 disposition > changed > attention ----
function makeBoard() {
  return {
    aboutToDispose: [
      { code: "1111", daysToStart: 2, daysToRelease: 12, interval: 20, startSlash: "2026/07/04", endSlash: "2026/07/14" },
    ],
    inDisposition: [
      { code: "2222", daysToStart: -3, daysToRelease: 4, interval: 5, startSlash: "2026/06/29", endSlash: "2026/07/06" },
      { code: "9999", daysToStart: -1, daysToRelease: 9, interval: 5, startSlash: "2026/07/01", endSlash: "2026/07/11" },
    ],
    attention: [
      { code: "3333", count: 2 },
      { code: "9999", count: 5 }, // 同時在處置 → 處置優先
      { code: "5555", count: 1 }, // 同時在全額 → 全額優先
    ],
    changedTrading: [
      { code: "5555" },
      { code: "9999" }, // 同時在處置 → 處置優先
    ],
  };
}

test("lookup：處置中", () => {
  const hit = lookupStockSurveillance("2222", makeBoard());
  assert.equal(hit.kind, "disposition");
  assert.equal(hit.status, "inDisposition");
  assert.equal(hit.interval, 5);
  assert.equal(hit.daysToRelease, 4);
});

test("lookup：即將處置（起日在未來）", () => {
  const hit = lookupStockSurveillance("1111", makeBoard());
  assert.equal(hit.kind, "disposition");
  assert.equal(hit.status, "aboutToDispose");
});

test("lookup：優先序（處置 > 全額 > 注意）", () => {
  assert.equal(lookupStockSurveillance("9999", makeBoard()).kind, "disposition");
  assert.equal(lookupStockSurveillance("5555", makeBoard()).kind, "changed");
  assert.equal(lookupStockSurveillance("3333", makeBoard()).kind, "attention");
  assert.equal(lookupStockSurveillance("3333", makeBoard()).count, 2);
});

test("lookup：未知代號／null 看板 → null", () => {
  assert.equal(lookupStockSurveillance("8888", makeBoard()), null);
  assert.equal(lookupStockSurveillance("2222", null), null);
});

test("lookup：代號先 cleanCode（含空白也查得到）", () => {
  assert.equal(lookupStockSurveillance(" 2222 ", makeBoard()).kind, "disposition");
});
