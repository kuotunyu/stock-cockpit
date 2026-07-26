// 右側明細可讀性：四個頁籤同列，標題、資料時間、漲跌與指標字級使用既有空間而不縮字。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

function fontPixels(selector) {
  const match = ruleBody(selector).match(/font-size\s*:\s*([\d.]+)px/);
  assert.ok(match, `missing px font size: ${selector}`);
  return Number(match[1]);
}

test("detail tabs use the entire row instead of leaving a two-cell blank second row", () => {
  assert.match(ruleBody(".detail-tabs"), /grid-template-columns\s*:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
});

test("detail header, quote facts and metric labels keep the enlarged readable scale", () => {
  assert.ok(fontPixels(".detail-top h2") >= 24);
  assert.ok(fontPixels(".detail-top p") >= 15);
  assert.ok(fontPixels(".price-hero span") >= 20);
  // .price-hero dt / dd 隨那份重複的單量／總量欄一起移除——單量與總量在下方「即時」分頁
  // 與「量價摘要」指標各印一次，hero 不必印第三次。字級下限改守 hero 的價格本體。
  assert.ok(fontPixels(".price-hero strong") >= 40, "現價是面板上最重要的數字，不得縮到 40px 以下");
  assert.ok(fontPixels(".chart-metric em") >= 16);
  assert.ok(fontPixels(".chart-metric strong") >= 22);
});

// 2026-07-16 的 UI 整修訂了「字重上限 700」。這是整份面板唯一還留著 900 的地方。
test("detail panel keeps the project-wide 700 font-weight ceiling", () => {
  const overWeight = [...styles.matchAll(/\.(?:price-hero|chart-metric|detail-top)[^{]*\{[^}]*font-weight\s*:\s*(\d{3})/g)]
    .filter((match) => Number(match[1]) > 700)
    .map((match) => match[0].slice(0, 60));
  assert.deepEqual(overWeight, [], `明細面板不得有字重 > 700：${overWeight.join(" / ")}`);
});
