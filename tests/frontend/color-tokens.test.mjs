// 顏色語意與對比：warn／error／info 三個 token 存在且被用掉；.positive/.negative 用可讀的
// --up-text/--down-text（--red/--green 只給資料圖形）；漲跌停 chip 白字壓在 surface 色上 ≥4.5:1；
// 橘色 focus 死碼清掉（全站青色環）；K 棒有 ▲／▼ 第二編碼；蠟燭漲空心跌實心。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const css = await readFile(new URL("../../styles.css", import.meta.url), "utf8");
const appSource = await readFile(new URL("../../app.js", import.meta.url), "utf8");

function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `找不到 token --${name}`);
  return match[1];
}
function luminance(hex) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `找不到規則 ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

test("語意色 token 存在，且 warn/error 規則已收斂到 token（不再手寫六種色相）", () => {
  assert.match(css, /--warn-text:\s*var\(--orange-2\)/);
  assert.match(css, /--error-text:\s*#ff9d94/);
  assert.match(css, /--info-text:\s*var\(--cyan\)/);
  for (const selector of [".source-switch.is-error small", ".technical-status.is-error", ".strategy-empty.is-error", ".notes-hint.is-error", ".company-summary-text.is-error", ".search-status.is-error"]) {
    assert.match(rule(selector), /var\(--error-text\)/, `${selector} 要用 --error-text`);
  }
  for (const selector of [".more-status strong.is-warn", ".more-detail dd.is-warn", ".chart-metrics-note.is-warn", ".fund-hint.is-warn", ".data-trust-card.is-warn strong"]) {
    assert.match(rule(selector), /var\(--warn-text\)/, `${selector} 要用 --warn-text`);
  }
  assert.doesNotMatch(rule(".data-trust-card.is-warn"), /255, 77, 61/, "資料可信度警告不可再用紅（紅＝漲）");
  assert.match(rule(".swing-stat-hint.is-warn"), /var\(--yellow\)/, "盈虧比偏低是資訊，維持 --yellow");
});

test("文字用可讀色、資料圖形才用 --red/--green；漲跌停 chip 與文字對比 ≥ 4.5:1", () => {
  assert.match(rule(".positive"), /var\(--up-text\)/);
  assert.match(rule(".negative"), /var\(--down-text\)/);
  assert.match(rule(".price-chip.hot-red"), /var\(--up-surface\)/);
  assert.match(rule(".price-chip.hot-green"), /var\(--down-surface\)/);
  assert.match(rule(".kbar.red"), /var\(--red\)/, "K 棒圖形維持 --red");
  const white = "#ffffff";
  assert.ok(contrast(white, token("up-surface")) >= 4.5, `白字／up-surface ${contrast(white, token("up-surface")).toFixed(2)}`);
  assert.ok(contrast(white, token("down-surface")) >= 4.5, `白字／down-surface ${contrast(white, token("down-surface")).toFixed(2)}`);
  assert.ok(contrast(token("up-text"), token("panel")) >= 4.5);
  assert.ok(contrast(token("down-text"), token("panel")) >= 4.5);
  assert.ok(contrast(token("muted"), "#202326") >= 4.5, "disabled 改用 --muted 後在輸入框底色上仍可讀");
  assert.match(rule(".watch-remove-selected:disabled"), /var\(--muted\)/);
});

test("focus：橘色 outline 死碼清掉，全站只剩青色環", () => {
  assert.doesNotMatch(css, /outline:\s*2px solid var\(--orange\)/);
  assert.match(css, /:is\(button, a\[href\], input, select, textarea, \[tabindex\]\):focus-visible \{\s*outline: 2px solid var\(--cyan\)/);
});

test("紅綠色弱的第二編碼：K 棒 ▲／▼、蠟燭漲空心跌實心", () => {
  assert.match(css, /\.kbar\.red \.kbar-dir::before \{ content: "▲"; \}/);
  assert.match(css, /\.kbar\.green \.kbar-dir::before \{ content: "▼"; \}/);
  const row = String(app.evalIn(`rowTemplate({ code: "2330", name: "台積電", price: 100, change: 1.5, high: 101, low: 99, groups: [], spark: [] }, "screener")`));
  assert.match(row, /class="kbar red"><i class="kbar-dir" aria-hidden="true"><\/i>/);
  assert.match(appSource, /function drawCandleBody\(context, up, x, y, width, height\)/);
  assert.match(appSource, /if \(up\) \{\s*const prevFill = context\.fillStyle;\s*context\.fillStyle = CANDLE_HOLLOW_FILL;/);
  assert.equal((appSource.match(/drawCandleBody\(context, up, x - candleWidth/g) || []).length, 2, "明細圖與技術圖兩處都要走同一個實體繪製");
  assert.doesNotMatch(appSource.slice(appSource.indexOf("function drawTechnicalChart")), /drawTechnicalCanvasLegend\(context, \[\s*\{ label: "MA5"/, "技術頁圖內圖例已移除（chip 列已有數值）");
});
