// 處置看板渲染：狀態字串、卡片標記（自選星／新／指標頁腳）、四種畫面狀態、圖例、自選提醒去重。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("survCard PPT layout gives full-height columns to name, facts, and quote", () => {
  seedBoard();
  const structure = json(`(() => {
    const longName = "\\u8d85\\u9577\\u540d\\u7a31<&\\u6e2c\\u8a66>";
    const item = { ...surveillanceBoardState.data.inDisposition[0], name: longName };
    const host = document.createElement("div");
    host.innerHTML = survCard(item, "inDisposition");
    const card = host.firstElementChild;
    const name = card.querySelector(".surv-card-name");
    const facts = card.querySelector(".surv-card-facts");
    const code = card.querySelector(".surv-code");
    const meta = card.querySelector(".surv-card-meta");
    const quote = card.querySelector(".surv-card-quote");
    const status = card.querySelector(".surv-card-status");
    const noQuoteHost = document.createElement("div");
    noQuoteHost.innerHTML = survCard({ code: "9999", name: "No quote" }, "attention");
    const noQuoteCard = noQuoteHost.firstElementChild;
    return {
      directOrder: [name, facts, quote, status].every((node, index) => card.children[index] === node),
      nameText: name?.textContent.trim(),
      nameHasElements: name?.childElementCount,
      codeText: code?.textContent.trim(),
      codeInFacts: code?.parentElement === facts,
      metaInFacts: meta?.parentElement === facts,
      factsOrder: facts?.children[0] === code && facts?.children[1] === meta,
      factsText: facts?.textContent.replace(/\\s+/g, " ").trim(),
      quoteOwnsPrice: quote?.querySelector(".surv-price")?.parentElement === quote,
      quoteOwnsChange: quote?.querySelector(".surv-change")?.parentElement === quote,
      priceText: quote?.querySelector(".surv-price")?.textContent.trim(),
      changeText: quote?.querySelector(".surv-change")?.textContent.trim(),
      quotePositive: quote?.classList.contains("positive"),
      statusText: status?.textContent.replace(/\\s+/g, " ").trim(),
      metricRowCount: status?.querySelectorAll(".surv-metrics > span").length,
      volumeMetricText: status?.querySelector(".surv-metric-volume")?.textContent.trim(),
      buttonType: card.getAttribute("type"),
      dataCode: card.dataset.code,
      noQuoteMuted: noQuoteCard.querySelector(".surv-card-quote")?.classList.contains("muted"),
      noQuoteHasChange: !!noQuoteCard.querySelector(".surv-change"),
      noQuoteHasMarket: !!noQuoteCard.querySelector(".surv-market"),
    };
  })()`);

  assert.equal(structure.directOrder, true, "card should be name / facts / quote, followed by status");
  assert.equal(structure.nameText, "\u8d85\u9577\u540d\u7a31<&\u6e2c\u8a66>");
  assert.equal(structure.nameHasElements, 0, "escaped name must remain plain text");
  assert.equal(structure.codeText, "3147");
  assert.equal(structure.codeInFacts, true, "code should occupy the facts column's top row");
  assert.equal(structure.metaInFacts, true, "market and interval should occupy the facts column's bottom row");
  assert.equal(structure.factsOrder, true);
  assert.match(structure.factsText, /3147.*上櫃.*20分盤/);
  assert.equal(structure.quoteOwnsPrice, true);
  assert.equal(structure.quoteOwnsChange, true);
  assert.equal(structure.priceText, "345");
  assert.ok(structure.changeText.endsWith("1.47%"));
  assert.equal(structure.quotePositive, true);
  assert.ok(structure.statusText.includes("3"));
  assert.ok(structure.statusText.includes("3.2%"));
  assert.ok(structure.statusText.includes("1,234"));
  assert.equal(structure.metricRowCount, 2, "turnover and volume should use separate footer rows");
  assert.equal(structure.volumeMetricText, "量 1,234", "volume should own the emphasized metric role");
  assert.equal(structure.buttonType, "button");
  assert.equal(structure.dataCode, "3147");
  assert.equal(structure.noQuoteMuted, true, "missing quote should use a neutral color");
  assert.equal(structure.noQuoteHasChange, false);
  assert.equal(structure.noQuoteHasMarket, false, "unknown exchange must not be mislabeled as listed");
});

function seedBoard(overrides = "{}") {
  app.evalIn(`
    watchLists[1] = new Set(["3147"]); watchLists[2] = new Set(); watchLists[3] = new Set();
    state.survMineOnly = false; state.survMarket = "all"; state.survInterval = "all";
    state.survQuery = ""; state.survSort = "default";
    surveillanceBoardState.data = Object.assign({
      ok: true,
      aboutToDispose: [],
      inDisposition: [
        { code: "3147", name: "大綜", exchange: "TPEx", price: 345, changePct: 1.47, interval: 20,
          daysToRelease: 3, startSlash: "2026/06/12", endSlash: "2026/06/26", turnover: 3.2, volumeLots: 1234, isNew: true },
        { code: "6830", name: "汎銓", exchange: "TWSE", price: 554, changePct: -1.07, interval: 5,
          daysToRelease: 0, startSlash: "2026/06/15", endSlash: "2026/06/29", turnover: 1.5, volumeLots: 888, isNew: false },
      ],
      aboutToRelease: [], blockTrades: [],
      attention: [
        { code: "2356", name: "英業達", exchange: "TWSE", price: 66.7, changePct: 0.45, count: 4,
          reason: "漲幅異常", isNew: true, daysOnList: 3, nearDisposition: true },
      ],
      changedTrading: [],
      counts: { aboutToDispose: 0, inDisposition: 2, aboutToRelease: 0, blockTrades: 0, attention: 1, changedTrading: 0 },
      asOf: "2026-06-26", queryDate: "2026-06-26", quoteAsOf: "2026-06-25", warnings: [],
      hasHistory: true, comparisonAsOf: "2026-06-25", comparisonIsPreviousTradingDay: true,
      enteredToday: 5, releasedToday: 2, enteredSinceComparison: 5, releasedSinceComparison: 2,
    }, ${overrides});
    surveillanceBoardState.loaded = true;
    surveillanceBoardState.loading = false;
    surveillanceBoardState.error = "";
    surveillanceBoardState.asOf = "2026-06-26";
  `);
}

test("survStatusKey：各分頁的色鍵", () => {
  assert.equal(app.evalIn(`survStatusKey({daysToStart: 2}, "aboutToDispose")`), "soon");
  assert.equal(app.evalIn(`survStatusKey({daysToRelease: 3}, "inDisposition")`), "in");
  assert.equal(app.evalIn(`survStatusKey({daysToRelease: 3, releaseSoon: true}, "inDisposition")`), "release");
  assert.equal(app.evalIn(`survStatusKey({}, "blockTrades")`), "block");
  assert.equal(app.evalIn(`survStatusKey({}, "attention")`), "attn");
  assert.equal(app.evalIn(`survStatusKey({}, "changedTrading")`), "changed");
});

test("survStatusLine：公告迄日仍在處置，下一交易日才解除", () => {
  const line = (item, tab) => app.evalIn(`survStatusLine(${JSON.stringify(item)}, ${JSON.stringify(tab)})`);
  assert.ok(line({ daysToRelease: 0, releaseSoon: true, endSlash: "2026/07/13" }, "inDisposition").includes("今日為處置最後一日"));
  assert.ok(line({ daysToRelease: 3, releaseSoon: true, releaseOnNextTradingDay: true, endSlash: "2026/07/13" }, "inDisposition").includes("處置至下一交易日 07/13"));
  assert.ok(line({ daysToRelease: 4, endSlash: "2026/07/17" }, "inDisposition").includes("處置至 07/17"));
  assert.ok(line({ daysToStart: 3, startsNextTradingDay: true, startSlash: "2026/07/13" }, "aboutToDispose").includes("下一交易日 07/13 起處置"));
  assert.ok(line({ count: 5, valueYi: 12.3 }, "blockTrades").includes("鉅額 5 筆 · 共 12.3 億"));
  assert.ok(line({ count: 3 }, "attention").includes("累計 3 次"));
  const changed = line({ periodic: true }, "changedTrading");
  assert.ok(changed.includes("全額交割") && changed.includes("兼分盤"));
});

test("survCard：自選星標＋金框、新進 badge、指標頁腳、無價 → --", () => {
  seedBoard();
  const html3147 = app.evalIn(`survCard(surveillanceBoardState.data.inDisposition[0], "inDisposition")`);
  assert.ok(html3147.includes("is-mine"), "自選股卡片要有 is-mine");
  assert.ok(html3147.includes("surv-mine-star"), "要有星標");
  assert.ok(html3147.includes("is-new"), "isNew 要有「新」badge");
  assert.ok(html3147.includes("週轉 3.2%"), "頁腳要有週轉率");
  assert.ok(html3147.includes("量 1,234"), "頁腳量要有千分位");
  const htmlNoPrice = app.evalIn(`survCard({ code: "9999", name: "無價", exchange: "TWSE" }, "attention")`);
  assert.ok(htmlNoPrice.includes("--"), "缺價格顯示 --");
  assert.ok(!htmlNoPrice.includes("is-mine"), "非自選不標星");
});

test("survCard：逐檔行情日不同時要在卡片直接揭露，不能只相信看板總日期", () => {
  seedBoard();
  const html = app.evalIn(`survCard({
    ...surveillanceBoardState.data.inDisposition[0],
    quoteAsOf: "2026-06-24",
    quoteDateMismatch: true,
  }, "inDisposition")`);
  assert.ok(html.includes("surv-metric-quote-date"));
  assert.ok(html.includes("行情 06/24"));
});

test("survCard：注意股升溫／連N天 badge", () => {
  seedBoard();
  const html = app.evalIn(`survCard(surveillanceBoardState.data.attention[0], "attention")`);
  assert.ok(html.includes("is-hot"), "nearDisposition → 升溫");
  assert.ok(html.includes("連3天"), "daysOnList → 連N天");
});

test("renderSurveillanceScreen：正常渲染＋摘要條＋精簡圖例", () => {
  seedBoard();
  app.evalIn(`state.surveillanceTab = "inDisposition"; renderSurveillanceScreen();`);
  const boardHtml = app.evalIn(`el.survBoard.innerHTML`);
  assert.ok(boardHtml.includes("surv-grid"));
  assert.ok(boardHtml.includes("較前一交易日新增處置"), "相鄰交易日比較要用精確語意");
  assert.ok(app.evalIn(`el.survAsOf.textContent`).includes("查詢日 2026-06-26 · 行情 2026-06-25"));
  assert.equal(json(`[...el.survBoard.querySelectorAll(".surv-card")].length`), 2);
  // 精簡圖例：處置分頁只留 ★／即將出關／新；「分盤=…」等完整解釋移到說明彈窗
  const legend = app.evalIn(`el.survLegend.textContent`);
  assert.ok(legend.includes("自選股") && legend.includes("即將出關") && legend.includes("新"), `處置分頁精簡圖例：${legend}`);
  assert.ok(!legend.includes("撮合"), "分盤詳解不該在圖例（在說明彈窗）");
  assert.ok(app.evalIn(`el.survHelp.textContent`).includes("撮合"), "分盤詳解應在說明彈窗");
  assert.ok(app.evalIn(`el.survHelp.textContent`).includes("連N天"), "連N天解釋應在說明彈窗");
  // 切到注意股 → 圖例換內容
  app.evalIn(`state.surveillanceTab = "attention"; renderSurveillanceScreen();`);
  assert.ok(app.evalIn(`el.survLegend.textContent`).includes("升溫"));
});

test("renderSurveillanceScreen：載入中（含 spinner）／錯誤／空清單 三態", () => {
  seedBoard();
  app.evalIn(`surveillanceBoardState.data = null; surveillanceBoardState.loading = true; renderSurveillanceScreen();`);
  assert.ok(app.evalIn(`el.survBoard.textContent`).includes("載入中"));
  assert.equal(json(`!!el.survBoard.querySelector(".surv-empty.is-loading .mini-spinner")`), true, "載入中要有 spinner");
  app.evalIn(`surveillanceBoardState.loading = false; surveillanceBoardState.error = "測試失敗訊息"; renderSurveillanceScreen();`);
  assert.ok(app.evalIn(`el.survBoard.textContent`).includes("測試失敗訊息"));
  seedBoard(`{ inDisposition: [], counts: { inDisposition: 0 } }`);
  app.evalIn(`state.surveillanceTab = "inDisposition"; renderSurveillanceScreen();`);
  assert.ok(app.evalIn(`el.survBoard.textContent`).includes("目前沒有處置中"), "空清單提示");
});

test("survCard：選取中的卡片帶 is-selected（同步 state.selectedCode）", () => {
  seedBoard();
  app.evalIn(`state.selectedCode = "3147"; state.surveillanceTab = "inDisposition"; renderSurveillanceScreen();`);
  assert.equal(json(`el.survBoard.querySelector('.surv-card[data-code="3147"]').classList.contains("is-selected")`), true);
  assert.equal(json(`el.survBoard.querySelector('.surv-card[data-code="6830"]').classList.contains("is-selected")`), false);
  // 換選 → 標記跟著移
  app.evalIn(`state.selectedCode = "6830"; renderSurveillanceScreen();`);
  assert.equal(json(`el.survBoard.querySelector('.surv-card[data-code="6830"]').classList.contains("is-selected")`), true);
  assert.equal(json(`el.survBoard.querySelector('.surv-card[data-code="3147"]').classList.contains("is-selected")`), false);
});

test("只看自選股（開啟後空）→ 專屬空狀態文案", () => {
  seedBoard();
  app.evalIn(`watchLists[1] = new Set(["9999"]); state.survMineOnly = true; state.surveillanceTab = "inDisposition"; renderSurveillanceScreen();`);
  assert.ok(app.evalIn(`el.survBoard.textContent`).includes("自選股目前沒有在這個分頁"));
  app.evalIn(`state.survMineOnly = false;`);
});

test("右側明細若不在目前處置篩選結果，要明確標示上下文", () => {
  seedBoard();
  const result = json(`(() => {
    const previousScreen = state.screen;
    state.screen = "surveillance";
    state.surveillanceTab = "inDisposition";
    const inside = getDetailScreenContext({ code: "3147" });
    const outside = getDetailScreenContext({ code: "2330" });
    state.screen = previousScreen;
    return { inside, outside };
  })()`);
  assert.equal(result.inside, "");
  assert.equal(result.outside, "不在目前篩選");
});

test("renderTechnicalSurveillance：停牌標記優先於處置/注意，並顯示起日", () => {
  // 只停牌
  app.evalIn(`technicalState.data = { surveillance: null, halted: { since: "2026-06-25" } }; renderTechnicalSurveillance();`);
  assert.equal(json(`el.technicalSurveillance.hidden`), false);
  assert.ok(app.evalIn(`el.technicalSurveillance.className`).includes("is-halted"));
  const text = app.evalIn(`el.technicalSurveillance.textContent`);
  assert.ok(text.includes("停牌") && text.includes("06/25"), `停牌文字：${text}`);
  // 停牌＋同時被列處置 → 停牌優先、附註另列
  app.evalIn(`technicalState.data = { surveillance: { kind: "disposition", label: "處置" }, halted: { since: null } }; renderTechnicalSurveillance();`);
  assert.ok(app.evalIn(`el.technicalSurveillance.textContent`).includes("另列處置"));
  // 都沒有 → 隱藏
  app.evalIn(`technicalState.data = { surveillance: null, halted: null }; renderTechnicalSurveillance();`);
  assert.equal(json(`el.technicalSurveillance.hidden`), true);
});

test("maybeAlertMineNewlyListed：同 session 每檔只提醒一次", () => {
  seedBoard();
  app.evalIn(`
    watchLists[1] = new Set(["3147"]);
    survAlertedThisSession.clear();
    maybeAlertMineNewlyListed(surveillanceBoardState.data);
  `);
  assert.equal(app.evalIn(`survAlertedThisSession.has("3147")`), true);
  const sizeAfterFirst = app.evalIn(`survAlertedThisSession.size`);
  app.evalIn(`maybeAlertMineNewlyListed(surveillanceBoardState.data)`); // 再跑一次
  assert.equal(app.evalIn(`survAlertedThisSession.size`), sizeAfterFirst, "不重複提醒");
  // 無歷史 → 不提醒
  app.evalIn(`survAlertedThisSession.clear(); maybeAlertMineNewlyListed({ ...surveillanceBoardState.data, hasHistory: false })`);
  assert.equal(app.evalIn(`survAlertedThisSession.size`), 0);
});
