// 策略雷達卡片：鎖定完整寬度資訊流、可讀字級與桌機／手機欄位收斂。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

function fontPixels(selector) {
  const match = ruleBody(selector).match(/font-size\s*:\s*([\d.]+)px/);
  assert.ok(match, `missing px font size: ${selector}`);
  return Number(match[1]);
}

test("strategy card separates identity, quote and signals into stable layout groups", () => {
  assert.match(app, /class="swing-headline">\s*<div class="swing-identity">[\s\S]*class="swing-quote-inline"/);
  assert.match(app, /class="swing-signal-line">\s*<div class="swing-tags">[\s\S]*class="swing-desc"/);
  assert.match(ruleBody(".swing-headline"), /grid-template-columns\s*:\s*minmax\(0, 1fr\) auto/);
});

test("ranking uses only the lead rows while explanations use the full card width", () => {
  const card = ruleBody(".swing-card");
  assert.match(card, /"rank head"/);
  assert.match(card, /"rank signal"/);
  assert.match(card, /"reason reason"/);
  assert.match(card, /"facts facts"/);
  assert.match(card, /"entry entry"/);
  assert.match(ruleBody(".swing-head"), /display\s*:\s*contents/);
  assert.match(ruleBody(".swing-reason"), /grid-area\s*:\s*reason/);
  assert.match(ruleBody(".swing-facts"), /grid-area\s*:\s*facts/);
  assert.match(ruleBody(".swing-entry-tip"), /grid-area\s*:\s*entry/);
});

test("strategy card keeps primary and supporting information comfortably readable", () => {
  assert.ok(fontPixels(".swing-nm") >= 25);
  assert.ok(fontPixels(".swing-code") >= 17);
  assert.ok(fontPixels(".swing-market") >= 15);
  assert.ok(fontPixels(".swing-price") >= 28);
  assert.ok(fontPixels(".swing-chg") >= 22);
  assert.ok(fontPixels(".swing-desc") >= 16.5);
  assert.ok(fontPixels(".swing-reason") >= 16);
  assert.ok(fontPixels(".swing-facts") >= 16);
  assert.ok(fontPixels(".swing-entry-tip") >= 15.5);
  assert.ok(fontPixels(".swing-stat span") >= 15);
  assert.ok(fontPixels(".swing-stat strong") >= 24);
});

test("strategy plan uses six desktop columns and two readable phone columns", () => {
  assert.match(styles, /@media \(min-width: 1040px\)[\s\S]*?\.swing-plan\s*\{\s*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.swing-plan\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?"rank"[\s\S]*?"head"[\s\S]*?"signal"/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.swing-desc\s*\{\s*flex:\s*0 1 auto;[\s\S]*?width:\s*100%/);
});
