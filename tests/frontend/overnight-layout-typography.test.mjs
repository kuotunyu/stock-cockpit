// 隔日沖總覽可讀性：摘要資訊分組、重點卡不留第五格空白，驗證與清單主資訊不得退回小字。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");

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

test("overnight overview promotes summary, verification and pick data to readable sizes", () => {
  assert.ok(fontPixels(".overnight-summary-primary strong") >= 22);
  // 2026-07-16 密度整修：摘要條攤平成單一 wrap 流（primary/facts display:contents），不再三段垂直堆疊
  assert.match(ruleBody(".overnight-summary"), /display\s*:\s*flex/);
  assert.match(ruleBody(".overnight-summary"), /flex-wrap\s*:\s*wrap/);
  assert.match(ruleBody(".overnight-summary-primary,\n.overnight-summary-facts"), /display\s*:\s*contents/);
  assert.ok(fontPixels(".today-focus-grid > .data-trust-card strong") >= 20);
  assert.ok(fontPixels(".verify-panel header strong") >= 22);
  assert.ok(fontPixels(".verify-chip strong") >= 20);
  assert.ok(fontPixels(".verify-chip span") >= 22);
  assert.ok(fontPixels(".overnight-group.is-overview .pick-main strong") >= 20);
  assert.ok(fontPixels(".overnight-group.is-overview .pick-quote strong") >= 21);
});

test("data trust becomes a full-width status row instead of leaving a fifth-card gap", () => {
  assert.match(styles, /\.today-focus-grid > \.data-trust-card\s*\{[^}]*grid-column\s*:\s*1\s*\/\s*-1[^}]*grid-template-columns\s*:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(ruleBody(".today-focus-grid"), /repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.today-focus-grid > \.today-focus-card\.is-watch\s*\{[^}]*grid-column\s*:\s*1\s*\/\s*-1[^}]*grid-template-columns\s*:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
});

test("focus pick separates the name from a large, readable percentage", () => {
  assert.match(app, /class="focus-pick-name"/);
  assert.match(ruleBody(".today-focus-card:not(.is-watch) strong"), /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.ok(fontPixels(".today-focus-card .focus-pick-name") >= 21);
  const percent = ruleBody(".today-focus-card:not(.is-watch) strong em");
  assert.match(percent, /font-family\s*:\s*var\(--mono\)/);
  assert.match(percent, /font-variant-numeric\s*:\s*tabular-nums/);
  assert.match(percent, /font-size\s*:\s*21px/);
});

test("overview rows preserve full names by stacking identity and quote beside the score", () => {
  const row = ruleBody(".overnight-group.is-overview .overnight-pick");
  assert.match(row, /grid-template-columns\s*:\s*70px\s+minmax\(0,\s*1fr\)/);
  assert.match(row, /"rank main"\s*"rank quote"/s);

  const name = ruleBody(".overnight-group.is-overview .pick-main strong");
  assert.match(name, /white-space\s*:\s*normal/);
  assert.match(name, /text-overflow\s*:\s*clip/);
  assert.doesNotMatch(name, /ellipsis/);

  const quote = ruleBody(".overnight-group.is-overview .pick-quote");
  assert.match(quote, /grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("overnight group count is a compact title badge, not a full-height header column", () => {
  assert.match(app, /class="overnight-group-titleline"/);
  assert.match(app, /class="overnight-group-count"/);
  assert.match(app, /class="overnight-group-meta"/);
  assert.match(ruleBody(".overnight-group-titleline"), /display\s*:\s*flex/);
  const count = ruleBody(".overnight-group-count");
  assert.match(count, /min-height\s*:\s*30px/);
  assert.match(count, /font-size\s*:\s*18px/);
  assert.match(ruleBody(".overnight-group-meta"), /font-size\s*:\s*16px/);
});
