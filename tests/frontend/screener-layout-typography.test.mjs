// 盤中選股字型與版面：自架 IBM Plex Mono、只套數字資料，並維持可讀字級與穩定欄寬。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const index = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

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

test("screener uses a scoped surface and self-hosted Plex faces without a runtime CDN", () => {
  assert.match(index, /class="screen screener-screen" data-screen-panel="screener"/);
  assert.match(styles, /font-family:\s*"Stock1 Plex Mono"/);
  assert.match(ruleBody(":root"), /--mono\s*:\s*"Stock1 Plex Mono"/);
  assert.match(ruleBody(":root"), /--screener-mono\s*:\s*var\(--mono\)/);
  assert.match(styles, /IBMPlexMono-Medium-Latin1\.woff2/);
  assert.match(styles, /IBMPlexMono-SemiBold-Latin1\.woff2/);
  assert.match(styles, /IBMPlexMono-Bold-Latin1\.woff2/);
  assert.doesNotMatch(styles, /@import|fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test("screener applies Plex only to comparable numeric roles with tabular figures", () => {
  for (const selector of [
    ".screener-screen .quote-value",
    ".screener-screen .metric-stack",
    ".screener-screen .stock-name > span",
  ]) {
    const body = ruleBody(selector);
    assert.match(body, /font-family\s*:\s*var\(--screener-mono\)/);
    assert.match(body, /font-variant-numeric\s*:\s*tabular-nums/);
  }
  assert.doesNotMatch(ruleBody(".screener-screen .stock-name strong"), /font-family\s*:/);
});

test("screener typography stays readable while the table gains calmer spacing", () => {
  assert.ok(fontPixels(".screener-screen .table-head > button,\n.screener-screen .table-head > span") >= 19);
  assert.ok(fontPixels(".screener-screen .stock-name strong") >= 21);
  assert.ok(fontPixels(".screener-screen .stock-reason") >= 15);
  assert.ok(fontPixels(".screener-screen .quote-value") >= 23);
  assert.ok(fontPixels(".screener-screen .metric-stack") >= 21);
  assert.match(ruleBody(".screener-screen .table-grid,\n.screener-screen .stock-row"), /min-width\s*:\s*760px/);
  const row = ruleBody(".screener-screen .stock-row");
  assert.match(row, /min-height\s*:\s*94px/);
  assert.match(row, /padding\s*:\s*0/);
});

test("screener K-bar header and rows share the same internal alignment grid", () => {
  const header = ruleBody(".screener-screen .table-head > button:first-child");
  const stockMain = ruleBody(".screener-screen .stock-main");
  assert.match(header, /display\s*:\s*grid/);
  assert.match(header, /grid-template-columns\s*:\s*34px minmax\(0, 1fr\)/);
  assert.match(header, /column-gap\s*:\s*6px/);
  assert.match(stockMain, /display\s*:\s*grid/);
  assert.match(stockMain, /grid-template-columns\s*:\s*34px minmax\(0, 1fr\)/);
  assert.match(stockMain, /column-gap\s*:\s*6px/);
  assert.match(ruleBody(".screener-screen .stock-main .kbar"), /justify-self\s*:\s*center/);
  const kbarLabel = ruleBody(".screener-screen .table-head > button:first-child > span");
  const stockLabel = ruleBody(".screener-screen .table-head > button:first-child > em");
  assert.match(kbarLabel, /font-size\s*:\s*18px/);
  assert.match(stockLabel, /font-size\s*:\s*18px/);
});
