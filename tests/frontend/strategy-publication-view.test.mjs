// 策略雷達的發布身份：publication.kind（formal／correction／research／provisional／not-persisted）
// 早已在 /api/swing 每條回傳路徑上，前端卻既沒宣告也沒渲染——暫定（provisional）榜單照樣掛
// 「收盤凍結」徽章、tooltip 照樣寫「同一基準日只算一次」。這檔釘住 kind → 文案的純映射、
// meta 列的徽章與 tooltip，以及切場景／載入失敗時 publication 必須清空，不能借上一個場景的身份。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => { app = await createAppWindow(); });
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

const renderMeta = (publication, over = {}) => json(`(() => {
  Object.assign(strategyState, {
    loaded: true, loading: false, error: "", scenario: "midBandDefense",
    picks: [], candidateCount: 240, matchedCount: 0, asOf: "2026-09-08", generatedAt: "2026-09-08T16:06:00Z",
    warnings: [], publication: ${JSON.stringify(publication)}, ...${JSON.stringify(over)},
  });
  state.screen = "strategy";
  renderStrategyBoard();
  const badge = el.strategyMeta.querySelector("[data-publication-badge]");
  const timeChip = [...el.strategyMeta.querySelectorAll(".m")].find((node) => node.textContent.includes("計算"));
  return {
    meta: el.strategyMeta.textContent.replace(/\\s+/g, " "),
    badgeKind: badge ? badge.dataset.kind : null,
    badgeTitle: badge ? badge.title : "",
    timeTitle: timeChip ? timeChip.title : "",
    board: el.strategyBoard.innerHTML,
  };
})()`);

test("strategyPublicationView：五種 kind 與缺失各自對應誠實文案，徽章色調只用既有 data-kind", () => {
  const views = json(`Object.fromEntries(["formal", "correction", "research", "provisional", "not-persisted", "weird"]
    .map((kind) => [kind, strategyPublicationView({ kind })]).concat([["missing", strategyPublicationView(null)]]))`);
  assert.match(views.formal.label, /正式採集/);
  assert.equal(views.formal.kind, "frozen");
  assert.match(views.correction.label, /更正/);
  assert.equal(views.correction.kind, "frozen");
  assert.match(views.research.label, /研究/);
  assert.equal(views.research.kind, "estimated");
  assert.match(views.provisional.label, /暫定/);
  assert.equal(views.provisional.kind, "estimated");
  assert.match(views["not-persisted"].label, /未確認保存/);
  assert.equal(views["not-persisted"].kind, "stale");
  assert.match(views.weird.label, /未確認/);
  assert.match(views.missing.label, /未確認/);
  for (const key of ["research", "provisional", "not-persisted", "weird", "missing"]) {
    assert.doesNotMatch(views[key].label, /凍結|正式/, `${key} 不得自稱正式或凍結`);
  }
});

test("provisional：meta 顯示暫定，不再掛「收盤凍結」，tooltip 不再說同一基準日只算一次", () => {
  const view = renderMeta({ kind: "provisional" });
  assert.match(view.meta, /暫定/);
  assert.doesNotMatch(view.meta, /收盤凍結/);
  assert.equal(view.badgeKind, "estimated");
  assert.match(view.badgeTitle, /未完整/);
  assert.doesNotMatch(view.timeTitle, /只算一次/);
  assert.match(view.timeTitle, /重算|再算/);
});

test("formal：meta 顯示正式採集清單，仍是 frozen 色調，tooltip 保留同一基準日只算一次", () => {
  const view = renderMeta({ kind: "formal" });
  assert.match(view.meta, /正式採集清單/);
  assert.doesNotMatch(view.meta, /暫定/);
  assert.equal(view.badgeKind, "frozen");
  assert.match(view.timeTitle, /只算一次/);
  assert.match(view.timeTitle, /2026-09-08/, "asOf 仍代表基準日");
});

test("research／correction／not-persisted 各自有身份，不冒充正式凍結", () => {
  assert.match(renderMeta({ kind: "research" }).meta, /研究清單/);
  assert.match(renderMeta({ kind: "correction" }).meta, /更正版本/);
  const notPersisted = renderMeta({ kind: "not-persisted" });
  assert.match(notPersisted.meta, /未確認保存/);
  assert.doesNotMatch(notPersisted.meta, /收盤凍結/);
});

test("舊回應沒有 publication：顯示發布狀態未確認，不因收盤時間就猜正式", () => {
  const view = renderMeta(null);
  assert.match(view.meta, /發布狀態未確認/);
  assert.doesNotMatch(view.meta, /收盤凍結|正式採集/);
});

test("零候選＋惡意 warning 字串：警告可見且已跳脫，不產生 img", () => {
  const view = renderMeta({ kind: "provisional" }, { warnings: ["<img src=x onerror=alert(1)> 僅部分市場可用"] });
  assert.match(view.board, /僅部分市場可用/);
  assert.doesNotMatch(view.board, /<img/);
  assert.match(view.board, /&lt;img/);
});

test("載入失敗：publication 清空，不留上一次成功的身份", async () => {
  await app.evalIn(`(async () => {
    window.__origFetchApi = fetchApi;
    fetchApi = async (path) => {
      if (String(path).startsWith("/api/swing")) throw Object.assign(new Error("受控失敗"), { status: 500 });
      return { ok: false };
    };
    strategyState.publication = { kind: "formal" };
    strategyState.scenario = "midBandDefense";
    try { await loadStrategyBoard(); } finally { fetchApi = window.__origFetchApi; }
  })()`);
  await app.settle();
  const after = json(`({ publication: strategyState.publication, error: strategyState.error })`);
  assert.equal(after.publication, null);
  assert.equal(after.error, "受控失敗");
});

test("切換場景：publication 立刻清空，不借上一個場景的發布身份", async () => {
  const result = json(`(() => {
    strategyState.publication = { kind: "formal" };
    strategyState.scenario = "midBandDefense";
    strategyState.error = "";
    const target = document.querySelector('[data-swing-scenario="strongContinuation"]');
    target.click();
    return { publication: strategyState.publication, loaded: strategyState.loaded, scenario: strategyState.scenario };
  })()`);
  await app.settle();
  assert.equal(result.scenario, "strongContinuation");
  assert.equal(result.loaded, false);
  assert.equal(result.publication, null);
});
