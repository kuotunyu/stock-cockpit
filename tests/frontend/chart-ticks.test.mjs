// K 線圖座標刻度（放大圖打磨）：價格軸 1-2-5 漂亮刻度、日期軸月界/季界/年界自適應。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

// 產生「只有日期」的合成 K 棒（boundary 判定只看 date 字串）
function dayCandles(startIso, days) {
  const out = [];
  const d = new Date(`${startIso}T00:00:00`);
  for (let i = 0; i < days; i += 1) {
    out.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

test("niceTicks：截圖案例 85.4–342.1 → 100/150/200/250/300（步進 50，全是整數）", () => {
  assert.deepEqual(json(`niceTicks(85.4, 342.1, 5)`), [100, 150, 200, 250, 300]);
});

test("niceTicks：低價股小數步進、無殘渣；無效範圍回空陣列", () => {
  assert.deepEqual(json(`niceTicks(12.3, 14.18, 5)`), [12.5, 13, 13.5, 14], "步進 0.5、小數乾淨");
  assert.deepEqual(json(`niceTicks(96, 1085, 5)`), [200, 400, 600, 800, 1000], "大範圍步進 200");
  assert.deepEqual(json(`niceTicks(5, 5, 5)`), []);
  assert.deepEqual(json(`niceTicks(10, 3, 5)`), [], "max<min 不炸");
});

test("buildDateTicks：半年日K → 每個月界一格，第一格與 1 月帶年份", () => {
  const candles = dayCandles("2025-10-15", 170); // 10月中～翌年4月初
  const ticks = json(`buildDateTicks(${JSON.stringify(candles)})`);
  assert.ok(ticks.length >= 5, `至少 11~3 月的月界：${JSON.stringify(ticks.map((t) => t.label))}`);
  assert.ok(ticks[0].label.includes("/"), "第一格帶年份定位");
  assert.ok(ticks.some((t) => t.label === "2026/1月"), "跨年那格標年份");
  assert.ok(ticks.some((t) => t.label === "3月"), "其餘只標月");
  // 每個刻度都真的是「該月第一根」
  const raw = candles;
  for (const t of ticks) {
    assert.notEqual(raw[t.i].date.slice(0, 7), raw[t.i - 1].date.slice(0, 7), "刻度要打在月界上");
  }
});

test("buildDateTicks：視窗太窄（單月內）→ null 交回逐根取樣；超寬 → 季界/年界抽稀", () => {
  assert.equal(json(`buildDateTicks(${JSON.stringify(dayCandles("2026-06-03", 18))})`), null, "不足兩個月界");
  // 15 個月 → 月界 14 個（>9）→ 季界抽稀
  const wide = json(`buildDateTicks(${JSON.stringify(dayCandles("2025-03-20", 460))})`);
  assert.ok(wide.length <= 9, `要抽稀：${wide.length}`);
  assert.ok(wide.every((t) => ["1", "4", "7", "10"].includes(t.label.replace(/^\d{4}\//, "").replace("月", ""))), `只留季首：${JSON.stringify(wide.map((t) => t.label))}`);
  // 三年 → 年界
  const years = json(`buildDateTicks(${JSON.stringify(dayCandles("2024-05-10", 800))})`);
  assert.ok(years.every((t) => t.label.endsWith("年")), `年界標籤：${JSON.stringify(years.map((t) => t.label))}`);
  assert.deepEqual(years.map((t) => t.label), ["2025年", "2026年"]);
});
