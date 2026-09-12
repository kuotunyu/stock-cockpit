// 籌碼標籤（法人、融資券、當沖、即將除權息）在隔日沖卡片與波段卡上的呈現：每顆連名詞解釋、tone 對應顏色。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

const PICK = {
  code: "2330", chips: { items: [
    { key: "foreignNet", label: "外資買超 1,235 張", tone: "up", asOf: "2026-09-11", term: "三大法人（外資／投信／自營）" },
    { key: "marginUsage", label: "融資使用率 65%", tone: "warn", asOf: "2026-09-11", term: "融資使用率與券資比" },
    { key: "dayTrade", label: "當沖比 40%", tone: "warn", asOf: "2026-09-11", term: "當沖比" },
  ] },
  dividendAhead: { exDate: "20260918", daysUntil: 6, kind: "cash-dividend", cashDividend: 5, stockRatio: 0 },
};

test("renderFlowChips：區塊版有「籌碼」標題，inline 版只有膠囊；tone 對應 class；每顆連到名詞解釋", () => {
  const block = String(app.evalIn(`renderFlowChips(${JSON.stringify(PICK)})`));
  assert.match(block, /<span class="pick-flow"><em>籌碼<\/em>/);
  assert.match(block, /pick-chip is-flow is-up"[^>]*>.*外資買超 1,235 張/);
  assert.match(block, /pick-chip is-flow is-warn"[^>]*>.*融資使用率 65%/);
  assert.match(block, /data-glossary-term="三大法人（外資／投信／自營）"/);
  assert.match(block, /data-glossary-term="融資使用率與券資比"/);
  assert.match(block, /data-glossary-term="當沖比"/);
  assert.match(block, /data-glossary-term="即將除權息"/);
  assert.match(block.replace(/<[^>]+>/g, ""), /6 天後除息 09\/18・現金 5 元/);
  assert.match(block, /2026-09-11 的官方數字/);
  const inline = String(app.evalIn(`renderFlowChips(${JSON.stringify(PICK)}, { inline: true })`));
  assert.doesNotMatch(inline, /pick-flow"/);
  assert.equal((inline.match(/pick-chip is-flow/g) || []).length, 4);
  assert.equal(app.evalIn(`renderFlowChips({ code: "2330" })`), "", "沒有標籤就不印");
  const today = String(app.evalIn(`renderFlowChips({ code: "2330", dividendAhead: { exDate: "20260913", daysUntil: 0, kind: "dividend", cashDividend: 0, stockRatio: 0.1 } })`)).replace(/<[^>]+>/g, "");
  assert.match(today, /今日除權息 09\/13・配股 0\.1/);
});

test("名詞表：三個新條目在「風險與制度」，別名可查", () => {
  const terms = json(`GLOSSARY.filter((g) => g.cat === "風險與制度").map((g) => g.term + "|" + (g.aliases || []).join("|"))`);
  for (const needle of ["融資使用率", "券資比", "當沖比", "即將除權息"]) assert.ok(terms.some((t) => t.includes(needle)), `缺 ${needle}`);
});
