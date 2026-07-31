// 處置看板：名單比對狀態的前端出口，以及「篩空」與「今天沒有」的區別。
//
// 兩個現場都是「畫面印出一句與事實相反的話」：
//  ① 後端一直有算 staleHistoryFields（完全比不了）與 unreliableRemovalFields（消失≠出關），
//     但 app.js 一次都沒讀（修這條之前全 repo grep 為 0）。所以比對被關掉時，畫面照樣印
//     「新 今日新進」的圖例，而使用者只看到一個完全沒有「新」標籤的分頁——
//     讀起來就是「今天沒有新進的」，實際上是「今天不知道」。
//  ② 篩選後 0 筆時印「今天沒有被列為注意的股票」。2026-07-31 的 55 檔注意股全部是上櫃，
//     切到「上市」分頁就會撞到，而上方分頁徽章同時顯示著 55。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

function seedBoard(overrides = "{}") {
  app.evalIn(`
    watchLists[1] = new Set(); watchLists[2] = new Set(); watchLists[3] = new Set();
    state.survMineOnly = false; state.survMarket = "all"; state.survInterval = "all";
    state.survQuery = ""; state.survSort = "default";
    state.surveillanceTab = "attention";
    surveillanceBoardState.data = Object.assign({
      ok: true,
      aboutToDispose: [], inDisposition: [], aboutToRelease: [], blockTrades: [], changedTrading: [],
      attention: [
        { code: "6510", name: "精測", exchange: "TPEx", price: 120, changePct: 3.1, count: 2, daysOnList: 2 },
        { code: "8291", name: "尚茂", exchange: "TPEx", price: 31, changePct: 5.2, count: 1 },
      ],
      counts: { aboutToDispose: 0, inDisposition: 0, aboutToRelease: 0, blockTrades: 0, attention: 2, changedTrading: 0 },
      asOf: "2026-07-31", queryDate: "2026-07-31", quoteAsOf: "2026-07-31", warnings: [],
      hasHistory: true, comparisonAsOf: "2026-07-30", comparisonIsPreviousTradingDay: true,
      enteredToday: 3, releasedToday: 1, enteredSinceComparison: 3, releasedSinceComparison: 1,
      staleHistoryFields: [], unreliableRemovalFields: [],
    }, ${overrides});
    surveillanceBoardState.loaded = true;
    surveillanceBoardState.loading = false;
    surveillanceBoardState.error = "";
    surveillanceBoardState.asOf = "2026-07-31";
  `);
}

const boardHtml = () => {
  app.evalIn("renderSurveillanceScreen()");
  return app.evalIn("el.survBoard.innerHTML");
};
const legendText = () => {
  app.evalIn("renderSurveillanceScreen()");
  return app.evalIn("el.survLegend.textContent");
};

test("分頁 → 歷史欄位的對照表涵蓋全部六個分頁", () => {
  const map = JSON.parse(app.evalIn("JSON.stringify(SURV_TAB_HISTORY_FIELD)"));
  assert.deepEqual(Object.keys(map).sort(), [
    "aboutToDispose", "aboutToRelease", "attention", "blockTrades", "changedTrading", "inDisposition",
  ]);
  // 三個處置分頁共用同一份名單，不可各自對到不同欄位。
  assert.equal(map.aboutToDispose, "disposition");
  assert.equal(map.inDisposition, "disposition");
  assert.equal(map.aboutToRelease, "disposition");
  assert.equal(map.blockTrades, "block");
  assert.equal(map.changedTrading, "changed");
});

test("比對正常時：圖例有「新」、不出現比對狀態提示", () => {
  seedBoard();
  assert.match(legendText(), /新進/, "正常時圖例照舊解釋「新」");
  assert.doesNotMatch(boardHtml(), /surv-history-note/, "沒事就不要多一行字");
});

test("這一類完全比不了 → 圖例撤掉「新」，並明講「不是今天沒有新進」", () => {
  seedBoard(`{ staleHistoryFields: ["attention"] }`);
  const legend = legendText();
  assert.doesNotMatch(legend, /新進|今日新進/, "比不了的時候不能解釋一個不會出現的標記");
  const html = boardHtml();
  assert.match(html, /surv-history-note/);
  assert.match(html, /無法/, "要說清楚是無法比對");
  assert.match(html, /暫不判定/);
  assert.match(html, /不是今天沒有新進/, "這句是重點：兩種讀法意義相反");
  assert.match(html, /2026-07-30/, "要指出是跟哪一天比不了");
});

test("比得出新進但出關不可信 → 只提醒出關，圖例的「新」要留著", () => {
  seedBoard(`{ unreliableRemovalFields: ["attention"] }`);
  assert.match(legendText(), /新進/, "新進仍然可信，圖例不可一起撤掉");
  const html = boardHtml();
  assert.match(html, /surv-history-note/);
  assert.match(html, /不代表已出關/);
});

test("處置的出關不可信時，摘要列的「名單移除」不可印成 0 檔", () => {
  seedBoard(`{ unreliableRemovalFields: ["disposition"], releasedToday: 0, releasedSinceComparison: 0 }`);
  app.evalIn(`state.surveillanceTab = "inDisposition"`);
  const html = boardHtml();
  assert.match(html, /判定中/, "0 與「不知道」要看得出差別");
  assert.doesNotMatch(html, /名單移除 <b>0<\/b> 檔/);
});

test("其他類別的旗標不會誤傷這一個分頁", () => {
  seedBoard(`{ staleHistoryFields: ["disposition", "block"] }`);
  assert.match(legendText(), /新進/, "attention 分頁不受 disposition 的旗標影響");
  assert.doesNotMatch(boardHtml(), /surv-history-note/);
});

test("篩選後 0 筆 → 說「篩選後沒有」並帶出本分頁總數，不可說「今天沒有」", () => {
  // 2026-07-31 的實況：注意股 55 檔全部是上櫃，切到「上市」就是這個情境。
  seedBoard();
  app.evalIn(`state.survMarket = "TWSE"`);
  const html = boardHtml();
  assert.doesNotMatch(html, /今天沒有被列為注意的股票/, "那是一句與事實相反的斷言");
  assert.match(html, /篩選後沒有符合的/);
  assert.match(html, /本分頁共 2 檔/, "要給出未篩選的檔數，否則使用者不知道是自己篩掉的");
});

test("本分頁真的 0 筆 → 維持原本的「今天沒有」文案", () => {
  seedBoard(`{ attention: [], counts: { attention: 0 } }`);
  const html = boardHtml();
  assert.match(html, /今天沒有被列為注意的股票/, "真的沒有時不可改口，否則等於另一個方向的謊");
  assert.doesNotMatch(html, /篩選後沒有符合的/);
});

test("只看自選篩空 → 保留專屬文案，但也要帶出總數", () => {
  seedBoard();
  app.evalIn(`state.survMineOnly = true`);
  const html = boardHtml();
  assert.match(html, /你的自選股目前沒有在這個分頁/);
  assert.match(html, /本分頁共 2 檔/);
});

test("比對狀態提示會跳脫 HTML（comparisonAsOf 來自 payload）", () => {
  seedBoard(`{ staleHistoryFields: ["attention"], comparisonAsOf: "<img src=x onerror=alert(1)>" }`);
  app.evalIn("renderSurveillanceScreen()");
  const injected = app.evalIn(`el.survBoard.querySelectorAll("img[onerror]").length`);
  assert.equal(injected, 0, "payload 字串不得生成帶事件屬性的元素");
});
