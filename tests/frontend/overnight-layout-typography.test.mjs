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

// 2026-09-09 CUA-03（computer use 心得 F03）：手機兩欄卡把桌機的「名稱＋漲幅」兩欄 strong 擠到約 60px，
// 「力士／同協／美好證」逐字直排。手機 query 內把 strong 改單欄（名稱在上、漲幅在下），桌機規則不動，不用 ellipsis。
test("mobile focus pick stacks name above percentage instead of squeezing the name", () => {
  // 定位「重點卡改兩欄」那個 760px 區塊（styles.css 有多個 max-width:760px query），再以大括號深度確認
  // 覆寫真的在同一個 media 區塊內：放到頂層或另一個 query 都算沒修（會蓋到桌機）。
  // 第五批④：手機兩欄改成 em 下限的 auto-fit（一般字級兩欄、200% 文字退成一欄），錨點跟著換。
  const gridOverride = styles.search(/\.today-focus-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*max\(9em,\s*45%\)\),\s*1fr\)\)/);
  assert.ok(gridOverride > 0, "手機重點卡兩欄（em 下限）規則必須存在");
  const mediaStart = styles.lastIndexOf("@media (max-width: 760px)", gridOverride);
  assert.ok(mediaStart >= 0, "兩欄規則必須在 760px media query 內");
  let depth = 0;
  let mediaEnd = -1;
  for (let index = styles.indexOf("{", mediaStart); index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    else if (styles[index] === "}") {
      depth -= 1;
      if (depth === 0) { mediaEnd = index; break; }
    }
  }
  assert.ok(mediaEnd > gridOverride, "media 區塊必須包住兩欄規則");
  const mobileBlock = styles.slice(mediaStart, mediaEnd);
  const override = mobileBlock.match(/\.today-focus-card:not\(\.is-watch\) strong\s*\{([^}]*)\}/);
  assert.ok(override, "同一個 760px media 區塊內必須覆寫 .today-focus-card:not(.is-watch) strong");
  assert.match(override[1], /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/, "手機改成單欄，名稱獨占一行");
  assert.doesNotMatch(override[1], /minmax\(0,\s*1fr\)\s+auto/);
  const topLevelOverrides = [...styles.matchAll(/\.today-focus-card:not\(\.is-watch\) strong\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*;/g)]
    .filter((match) => match.index < mediaStart || match.index > mediaEnd);
  assert.equal(topLevelOverrides.length, 0, "單欄覆寫不得出現在 media 區塊外（會蓋掉桌機兩欄）");
  const nameRules = [...styles.matchAll(/\.focus-pick-name[^{]*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(nameRules, /text-overflow\s*:\s*ellipsis/, "股名不得用 ellipsis 縮成「鑫…」");
  assert.doesNotMatch(nameRules, /font-size\s*:\s*(1\d|20)px/, "手機不得縮小股名字級");
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
