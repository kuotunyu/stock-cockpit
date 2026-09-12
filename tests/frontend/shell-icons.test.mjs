// 外殼常駐圖示（導覽 7 個＋頂欄 3 個）直接內嵌 SVG sprite，首屏不再等 lucide.min.js 解析＋createIcons 換圖。
// sprite 的每個 symbol 必須與同一版 lucide 實際 render 出來的路徑一致，否則圖示會悄悄走樣、兩處長得不一樣。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const lucideSource = readFileSync(new URL("../../lucide.min.js", import.meta.url), "utf8");
const doc = new JSDOM(html).window.document;

const SHELL_SLOTS = [".rail-nav .nav-action", ".bottom-nav .nav-action", ".top-actions .icon-button"];

test("外殼導覽與頂欄按鈕用 sprite 引用，不再留 data-lucide 佔位", () => {
  const buttons = SHELL_SLOTS.flatMap((selector) => [...doc.querySelectorAll(selector)]);
  assert.equal(buttons.length, 17, "rail 7＋bottom 7＋top 3");
  for (const button of buttons) {
    assert.equal(button.querySelector("i[data-lucide]"), null, button.outerHTML.slice(0, 80));
    const svg = button.querySelector("svg.ic");
    assert.ok(svg, `每顆按鈕都要有內嵌 svg.ic：${button.outerHTML.slice(0, 80)}`);
    assert.equal(svg.getAttribute("aria-hidden"), "true", "圖示是裝飾，名字在按鈕文字／aria-label");
    assert.equal(svg.getAttribute("stroke"), "currentColor", "顏色跟著按鈕（is-active 橘色）");
    assert.equal(svg.getAttribute("fill"), "none");
    const href = svg.querySelector("use")?.getAttribute("href") || "";
    assert.match(href, /^#ic-[a-z0-9-]+$/, href);
    assert.ok(doc.querySelector(`svg symbol[id="${href.slice(1)}"]`), `sprite 缺 ${href}`);
  }
  // 兩條導覽同一頁要用同一個圖示
  const rail = [...doc.querySelectorAll(".rail-nav .nav-action")].map((b) => [b.dataset.screen, b.querySelector("use").getAttribute("href")]);
  const bottom = [...doc.querySelectorAll(".bottom-nav .nav-action")].map((b) => [b.dataset.screen, b.querySelector("use").getAttribute("href")]);
  assert.deepEqual(rail, bottom);
});

test("sprite 的每個 symbol 與 lucide v1.24.0 實際 render 的路徑逐一相同", () => {
  const symbols = [...doc.querySelectorAll("svg symbol[id^='ic-']")];
  assert.ok(symbols.length >= 10, `sprite 只有 ${symbols.length} 個 symbol`);
  const names = symbols.map((symbol) => symbol.id.slice(3));
  const live = new JSDOM(
    `<!doctype html><body>${names.map((name) => `<i data-lucide="${name}"></i>`).join("")}<script>${lucideSource}</script></body>`,
    { runScripts: "dangerously" },
  );
  live.window.lucide.createIcons();
  const rendered = [...live.window.document.querySelectorAll("svg")];
  assert.equal(rendered.length, names.length, "每個 symbol 名稱都要是 lucide 認得的圖示");
  const norm = (markup) => markup.replace(/><\/(path|rect|circle|line|polyline|polygon)>/g, "/>").replace(/\s+/g, " ").trim();
  symbols.forEach((symbol, index) => {
    assert.equal(symbol.getAttribute("viewBox"), rendered[index].getAttribute("viewBox"), symbol.id);
    assert.equal(norm(symbol.innerHTML), norm(rendered[index].innerHTML), `${symbol.id} 的路徑與 lucide 不同`);
  });
});
