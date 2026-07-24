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
