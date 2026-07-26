// 名詞表的股票制度說明必須與實際風險政策、官方公司行動還原邏輯一致。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const app = await createAppWindow();
after(() => app.cleanup());

const glossary = JSON.parse(app.evalIn("JSON.stringify(GLOSSARY)"));
const definition = (term) => glossary.find((item) => item.term === term)?.def || "";

test("策略雷達名詞表不得誤稱注意／處置／變更交易股會被排除", () => {
  const scope = definition("掃描範圍（前 240 檔）");
  const changed = definition("變更交易 / 全額交割");

  assert.match(scope, /保留並醒目標示/);
  assert.match(scope, /風險開關隱藏/);
  assert.doesNotMatch(scope, /排除(?:注意|處置|變更交易)|(?:注意|處置|變更交易)[^。]{0,20}排除/);
  assert.match(changed, /保留並醒目標示/);
  assert.doesNotMatch(changed, /選股策略.*排除/);
});

test("還原股價名詞表區分官方事件、估算還原與 unresolved 阻擋", () => {
  const restored = definition("還原股價（除權息）");

  assert.match(restored, /官方/);
  assert.match(restored, /疑似／估算還原/);
  assert.match(restored, /公告欄位未齊.*暫停.*判定/);
  assert.doesNotMatch(restored, /近期除息（已還原）/);
});

// D-45：官方只提供除權息的機器可讀資料，**沒有**減資／面額變更／股票分割的端點
// （2026-07-26 實測 TWSE OpenAPI 143 個端點，公司行動只有除權除息預告表與股利分派情形；
//  TWT49U 計算結果表 2,717 筆歸檔的 kind 也只有除息／除權息／除權三種）。
// 這幾類事件只能靠「跳空 > 10.5%」推估：減資 10% 以上（跳空 11.1%）與所有股票分割
// （1:2 就跳空 50%）都抓得到並標成估算，但**小於 10.5% 的減資抓不到**。
// 所以名詞表必須把這條界線講出來，不能讓使用者以為還原是完整的。
test("還原股價名詞表要交代偵測範圍的界線（減資／分割沒有官方端點）", () => {
  const restored = definition("還原股價（除權息）");
  assert.match(restored, /減資/, "要點名減資這個缺口");
  assert.match(restored, /10\.5%/, "要給出具體門檻，不能只說「可能不完整」");
  assert.match(restored, /沒查到|不是保證沒發生|偵測不到/, "要說清楚「沒偵測到」≠「沒發生」");
});

// 圖表旁的說明與名詞表必須講同一件事。這句話是這個缺口最會誤導人的地方：
// 「這段區間沒有偵測到公司行動」很容易被讀成「這段期間沒有公司行動」。
test("技術分析頁的「沒有偵測到公司行動」必須附上偵測範圍，不得無條件斷言", () => {
  const html = app.evalIn(`renderTechnicalCorporateActions({ corporateActions: { events: [], notes: [] } })`);
  assert.match(html, /沒有偵測到公司行動/, "前提：走的是「沒有事件」那條分支");
  assert.match(html, /title="[^"]*10\.5%[^"]*"/, "要用 tooltip 交代門檻，而不是讓句子看起來像保證");
  assert.match(html, /title="[^"]*減資[^"]*"/, "要點名減資這個抓不到的類別");
  // 反向：有事件時不該掛這個 tooltip（那時說明的是實際偵測到的事件）
  const withEvent = app.evalIn(
    `renderTechnicalCorporateActions({ corporateActions: { events: [{ date: "20260611", ratio: 0.92, source: "exchange-result" }], notes: [] } })`,
  );
  assert.doesNotMatch(withEvent, /沒有偵測到公司行動/);
  assert.match(withEvent, /交易所/, "有事件時要標來源");
});
