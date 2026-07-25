// 渲染字串跳脫回歸：策略健檢／策略雷達／隔日沖／波段卡片／個股健檢卡的「使用者輸入與伺服器字串」
// 一律不得直接進 innerHTML。2026-07-25 實測 renderStrategyInspect 會把健檢輸入框內容原樣塞進
// innerHTML（後端 /api/swing/inspect 的錯誤訊息也會把 query 原樣回填），確實會生出可執行的
// <img onerror>；此檔把修好的行為釘住，避免再退回去。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

// 典型 DOM XSS payload：只要沒跳脫就會被 jsdom 解析成真的 <img> 元素並帶著 onerror 屬性。
const PAYLOAD = '<img src=x onerror=window.__pwned=1>';

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

// 把一段 HTML 掛進暫時節點，回報「有沒有長出注入元素」與純文字內容。
const probe = (buildHtmlExpr) => json(`(() => {
  const host = document.createElement("div");
  host.innerHTML = ${buildHtmlExpr};
  return {
    injected: host.querySelectorAll("img, script, [onerror]").length,
    text: host.textContent,
  };
})()`);

test("策略健檢：載入中與查無資料都不得讓輸入框內容變成元素", () => {
  const result = json(`(() => {
    const payload = ${JSON.stringify(PAYLOAD)};
    const host = document.getElementById("strategyInspectResult");
    const out = {};
    strategyInspectState.loading = true;
    strategyInspectState.error = "";
    strategyInspectState.data = null;
    strategyInspectState.query = payload;
    renderStrategyInspect();
    out.loadingInjected = host.querySelectorAll("img, script, [onerror]").length;
    out.loadingText = host.textContent;
    strategyInspectState.loading = false;
    strategyInspectState.error = "找不到「" + payload + "」";
    renderStrategyInspect();
    out.errorInjected = host.querySelectorAll("img, script, [onerror]").length;
    out.errorText = host.textContent;
    strategyInspectState.error = "";
    strategyInspectState.query = "";
    renderStrategyInspect();
    return out;
  })()`);
  assert.equal(result.loadingInjected, 0, "載入中的健檢字串不得產生元素");
  assert.ok(result.loadingText.includes(PAYLOAD), "跳脫後仍要把原字串當純文字顯示給使用者看");
  assert.equal(result.errorInjected, 0, "錯誤訊息（伺服器會回填 query）不得產生元素");
  assert.ok(result.errorText.includes(PAYLOAD), "錯誤訊息同樣要保留可讀原文");
});

test("策略雷達／隔日沖：錯誤字串以純文字呈現", () => {
  const strategy = json(`(() => {
    const prev = { error: strategyState.error, loading: strategyState.loading, loaded: strategyState.loaded };
    strategyState.loading = false;
    strategyState.loaded = true;
    strategyState.error = ${JSON.stringify(PAYLOAD)};
    renderStrategyBoard();
    const host = el.strategyBoard;
    const out = { injected: host.querySelectorAll("img, script, [onerror]").length, text: host.textContent };
    Object.assign(strategyState, prev);
    return out;
  })()`);
  assert.equal(strategy.injected, 0, "策略雷達錯誤字串不得產生元素");
  assert.ok(strategy.text.includes(PAYLOAD));

  const overnight = json(`(() => {
    const prev = { error: overnightState.error };
    overnightState.error = ${JSON.stringify(PAYLOAD)};
    renderOvernightGroups();
    const host = el.overnightGroups;
    const out = { injected: host.querySelectorAll("img, script, [onerror]").length, text: host.textContent };
    Object.assign(overnightState, prev);
    return out;
  })()`);
  assert.equal(overnight.injected, 0, "隔日沖錯誤字串不得產生元素");
  assert.ok(overnight.text.includes(PAYLOAD));
});

test("波段卡片與個股健檢卡：股名／市場／場景描述都走跳脫", () => {
  const card = probe(`renderSwingCard({
    rank: 1, code: "2330", name: ${JSON.stringify(PAYLOAD)}, market: ${JSON.stringify(PAYLOAD)},
    exchange: "TWSE", price: 100, changePct: 1.2, score: 80,
    scenario: { name: "中軌防守", desc: ${JSON.stringify(PAYLOAD)} },
  })`);
  assert.equal(card.injected, 0, "波段卡片的股名／市場／場景描述不得產生元素");
  assert.ok(card.text.includes(PAYLOAD), "股名仍要以純文字完整顯示，不可被吃掉");

  const inspect = probe(`renderInspectCard({
    code: "2330", name: ${JSON.stringify(PAYLOAD)}, market: ${JSON.stringify(PAYLOAD)},
    price: 100, changePct: 1.2, score: 80, checks: [], scenarios: [],
  })`);
  assert.equal(inspect.injected, 0, "個股健檢卡的股名／市場不得產生元素");
  assert.ok(inspect.text.includes(PAYLOAD));
});

test("波段卡片的 aria-label 也必須跳脫（屬性上下文）", () => {
  const label = app.evalIn(`(() => {
    const host = document.createElement("div");
    host.innerHTML = renderSwingCard({
      rank: 1, code: "2330", name: '2330" onmouseover="window.__pwned=1',
      exchange: "TWSE", price: 100, changePct: 1.2, score: 80,
      scenario: { name: "中軌防守", desc: "" },
    });
    const card = host.querySelector(".swing-card");
    return JSON.stringify({
      hasHandler: card.hasAttribute("onmouseover"),
      ariaLabel: card.getAttribute("aria-label"),
    });
  })()`);
  const parsed = JSON.parse(label);
  assert.equal(parsed.hasHandler, false, "屬性上下文不得被引號逃逸出來掛上事件處理器");
  assert.ok(parsed.ariaLabel.includes('2330" onmouseover='), "跳脫後的 aria-label 仍應保留原始文字");
});
