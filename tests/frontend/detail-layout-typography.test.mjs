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
  assert.ok(fontPixels(".price-hero dt") >= 17);
  assert.ok(fontPixels(".price-hero dd") >= 22);
  assert.ok(fontPixels(".chart-metric em") >= 16);
  assert.ok(fontPixels(".chart-metric strong") >= 22);
});
