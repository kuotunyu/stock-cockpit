// 自選股表格可讀性：放大有效資訊，並讓成交價／漲跌幅形成置中且穩定的兩層數字群組。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

function fontPixels(selector) {
  const match = ruleBody(selector).match(/font-size\s*:\s*([\d.]+)px/);
  assert.ok(match, `missing px font size: ${selector}`);
  return Number(match[1]);
}

test("watchlist rows use the available height for readable data instead of small text", () => {
  assert.ok(fontPixels(".stock-name strong") >= 22);
  assert.ok(fontPixels(".stock-name span") >= 18);
  assert.ok(fontPixels(".stock-reason") >= 16);
  assert.ok(fontPixels(".quote-value") >= 24);
  assert.ok(fontPixels(".quote-change") >= 19);
  assert.ok(fontPixels(".metric-stack") >= 22);
});

test("price and change are centered, tabular and divided into two explicit rows", () => {
  const quote = ruleBody(".quote-value");
  assert.match(ruleBody(":root"), /--mono\s*:\s*"Stock1 Plex Mono"/);
  assert.match(quote, /font-family\s*:\s*var\(--mono\)/);
  assert.match(quote, /align-items\s*:\s*center/);
  assert.match(quote, /text-align\s*:\s*center/);
  assert.match(quote, /font-variant-numeric\s*:\s*tabular-nums/);
  assert.match(ruleBody(".quote-price,\n.quote-change"), /justify-content\s*:\s*center/);
});

test("watchlist gives the identity group room and reserves only chart-width space for the sparkline", () => {
  const columns = ruleBody(".watch-table-head,\n.watch-stock-row");
  const rowColumns = ruleBody(".watch-row-select");
  assert.match(columns, /min-width\s*:\s*712px/);
  assert.match(columns, /minmax\(174px, 1\.5fr\)/);
  assert.match(columns, /minmax\(86px, 0\.7fr\)/);
  assert.match(rowColumns, /minmax\(174px, 1\.5fr\)/);
  assert.match(rowColumns, /minmax\(86px, 0\.7fr\)/);
  const identity = ruleBody(".watch-stock-row .stock-main");
  assert.match(identity, /width\s*:\s*100%/);
  assert.match(identity, /justify-content\s*:\s*center/);
  assert.match(ruleBody(".spark-cell svg"), /width\s*:\s*86px/);
});
