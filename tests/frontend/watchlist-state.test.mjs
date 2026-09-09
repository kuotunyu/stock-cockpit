// 自選股狀態：帳號隔離、localStorage 往返、容量上限與同步競態。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const apps = [];
after(() => apps.forEach((a) => a.cleanup()));

test("beforeApp 種未驗證 localStorage → 登入初始化時不沿用前一帳號清單", async () => {
  const app = await createAppWindow({
    beforeApp: (win) => {
      win.localStorage.setItem("stock1-watch-lists-v1", JSON.stringify({ 1: ["6127", "5425"], 2: ["2330"], 3: [] }));
    },
  });
  apps.push(app);
  assert.deepEqual(app.jsdomErrors, []);
  assert.equal(app.evalIn(`watchLists[1].has("6127")`), false);
  assert.equal(app.evalIn(`watchLists[1].has("5425")`), false);
  assert.equal(app.evalIn(`watchLists[2].has("2330")`), false);
  assert.equal(app.evalIn(`watchLists[3].size`), 0);
  assert.deepEqual(JSON.parse(app.evalIn(`localStorage.getItem("stock1-watch-lists-v1")`)), {
    1: [], 2: [], 3: [],
  }, "切換登入範圍時舊帳號快取應被清成空清單");
});

test("壞 JSON → 不炸；登入初始化後維持空白帳號清單", async () => {
  const app = await createAppWindow({
    beforeApp: (win) => {
      win.localStorage.setItem("stock1-watch-lists-v1", "{not valid json!!");
    },
  });
  apps.push(app);
  assert.deepEqual(app.jsdomErrors, [], "載入不得有未捕捉錯誤");
  assert.equal(app.evalIn(`typeof watchLists`), "object");
  assert.equal(app.evalIn(`watchLists[1].size`), 0, "不可讓未驗證本機資料滲入登入帳號");
});

test("saveWatchLists → localStorage 寫回（往返）", async () => {
  const app = await createAppWindow();
  apps.push(app);
  app.evalIn(`
    watchLists[1] = new Set(["9945"]);
    saveWatchLists({ sync: false }); // 不觸發伺服器同步
  `);
  const stored = JSON.parse(app.evalIn(`localStorage.getItem("stock1-watch-lists-v1")`));
  assert.deepEqual(stored["1"], ["9945"]);
});

test("isInAnyWatchList：跨三組清單", async () => {
  const app = await createAppWindow();
  apps.push(app);
  app.evalIn(`
    watchLists[1] = new Set(["1111"]);
    watchLists[2] = new Set();
    watchLists[3] = new Set(["3333"]);
  `);
  assert.equal(app.evalIn(`isInAnyWatchList("1111")`), true);
  assert.equal(app.evalIn(`isInAnyWatchList("3333")`), true);
  assert.equal(app.evalIn(`isInAnyWatchList("2222")`), false);
});

test("addCodeToWatchList：100 檔上限會擋下且不顯示成功；99 檔仍可加入", async () => {
  const app = await createAppWindow();
  apps.push(app);
  app.evalIn(`
    document.getElementById("toastStack").replaceChildren();
    watchLists[1] = new Set(Array.from({ length: 100 }, (_, index) => String(1000 + index)));
  `);
  const before = JSON.parse(app.evalIn(`JSON.stringify([...watchLists[1]])`));

  assert.equal(app.evalIn(`addCodeToWatchList("9999", "1")`), false);
  assert.deepEqual(JSON.parse(app.evalIn(`JSON.stringify([...watchLists[1]])`)), before, "到上限後清單不可異動");
  const cappedToast = app.evalIn(`document.getElementById("toastStack").textContent`);
  assert.ok(cappedToast.includes("最多 100 檔"), "要明確說明容量上限");
  assert.ok(!cappedToast.includes("已加入"), "被擋下時不可顯示成功訊息");

  app.evalIn(`
    document.getElementById("toastStack").replaceChildren();
    watchLists[1] = new Set(Array.from({ length: 99 }, (_, index) => String(1000 + index)));
  `);
  assert.equal(app.evalIn(`addCodeToWatchList("9999", "1")`), true, "低於上限仍可加入");
  assert.equal(app.evalIn(`watchLists[1].size`), 100);
  assert.equal(app.evalIn(`watchLists[1].has("9999")`), true);
  app.evalIn(`window.clearTimeout(watchListSyncTimer);`);
});

test("syncWatchListsToServer：PUT canonical response 套回清單、localStorage 與 rev", async () => {
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/watchlists": (_raw, init) => init?.method === "PUT"
        ? { ok: true, rev: 7, lists: { 1: ["9999"], 2: ["2330"], 3: [] } }
        : { ok: true, rev: 1, lists: { 1: ["1111"], 2: [], 3: [] } },
    },
  });
  apps.push(app);

  await app.evalIn(`
    watchLists[1] = new Set(["2222"]);
    watchListMutationVersion += 1;
    syncWatchListsToServer()
  `);

  assert.deepEqual(JSON.parse(app.evalIn(`JSON.stringify(watchListsPayload())`)), {
    1: ["9999"],
    2: ["2330"],
    3: [],
  });
  assert.equal(app.evalIn(`watchListsRev`), 7);
  assert.deepEqual(JSON.parse(app.evalIn(`localStorage.getItem("stock1-watch-lists-v1")`)), {
    1: ["9999"],
    2: ["2330"],
    3: [],
  });
});

test("syncWatchListsToServer：延遲舊回應不得覆蓋期間內的較新本機異動", async () => {
  let putCount = 0;
  let resolveFirst;
  let resolveSecond;
  let secondRequestLists;
  const app = await createAppWindow({
    fetchRoutes: {
      "/api/watchlists": (_raw, init) => {
        if (init?.method !== "PUT") return { ok: true, rev: 1, lists: { 1: [], 2: [], 3: [] } };
        putCount += 1;
        if (putCount === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        secondRequestLists = JSON.parse(init.body).lists;
        return new Promise((resolve) => { resolveSecond = resolve; });
      },
    },
  });
  apps.push(app);

  const firstSync = app.evalIn(`
    watchLists[1] = new Set(["1111"]);
    watchListMutationVersion += 1;
    syncWatchListsToServer()
  `);
  app.evalIn(`
    watchLists[1].add("2222");
    watchListMutationVersion += 1;
  `);
  resolveFirst({ ok: true, rev: 2, lists: { 1: ["9999"], 2: [], 3: [] } });
  await firstSync;

  for (let round = 0; round < 20 && !resolveSecond; round += 1) await app.settle(1);
  assert.equal(putCount, 2, "舊回應完成後應補送期間內的新版本");
  assert.deepEqual(JSON.parse(app.evalIn(`JSON.stringify([...watchLists[1]])`)), ["1111", "2222"], "舊 canonical 不可覆寫新內容");
  assert.deepEqual(secondRequestLists["1"], ["1111", "2222"], "補送內容要是最新本機版本");

  resolveSecond({ ok: true, rev: 3, lists: secondRequestLists });
  await app.settle(2);
  assert.deepEqual(JSON.parse(app.evalIn(`JSON.stringify([...watchLists[1]])`)), ["1111", "2222"]);
  assert.equal(app.evalIn(`watchListsRev`), 3);
});

test("syncWatchListsToServer 完成後的重繪是背景重繪：不得把使用者正聚焦的處置卡換掉（與到價提醒同步同一類）", async () => {
  // 與 price-alerts 的同型案例：加入自選後 350ms 防抖才 PUT /api/watchlists，回應可能落在使用者已切到別頁、
  // 焦點停在某張卡片之後；成功路徑若用裸 render()，整頁重繪把卡換掉、焦點掉到 body。
  const app = await createAppWindow();
  apps.push(app);
  const result = JSON.parse(await app.evalIn(`(async () => {
    const orig = { put: putConfirmedResource };
    authState.user = { id: "u1", username: "admin", role: "admin" };
    watchLists[1].add("6488");
    surveillanceBoardState.data = { ok: true, queryDate: "2026-09-07", counts: { inDisposition: 1 }, warnings: [],
      inDisposition: [{ code: "6488", name: "環球晶", exchange: "TPEx", interval: "5", startSlash: "2026/09/01", endSlash: "2026/09/12", daysToRelease: 5 }] };
    surveillanceBoardState.loaded = true;
    state.screen = "surveillance"; state.surveillanceTab = "inDisposition";
    render();
    const card = document.querySelector('.surv-card[data-code="6488"]');
    card.focus();
    const before = document.activeElement === card;
    putConfirmedResource = async (path, body) => ({ ok: true, rev: 2, lists: body.lists });
    try {
      await syncWatchListsToServer();
    } finally {
      putConfirmedResource = orig.put;
    }
    const active = document.activeElement;
    return JSON.stringify({ before, rev: watchListsRev, stillInList: watchLists[1].has("6488"),
      activeIsCard: Boolean(active) && active.matches('.surv-card[data-code="6488"]'),
      activeDesc: active ? active.tagName + (active.dataset.code ? "[" + active.dataset.code + "]" : "") : null });
  })()`));
  assert.equal(result.before, true, "前提：卡片已聚焦");
  assert.equal(result.rev, 2, "前提：同步成功並套用伺服器 rev");
  assert.equal(result.stillInList, true, "前提：伺服器回的清單套回本機");
  assert.equal(result.activeIsCard, true, `同步完成的重繪後焦點要還在同一檔處置卡，實際 ${result.activeDesc}`);
});

test("搜尋加入自選後補抓報價完成的重繪是背景重繪：不得把使用者已移到的處置卡換掉", async () => {
  // 加入自選的點擊處理器先同步 render()，再 ensureStockForDetailCode(code).then(() => render()) 補抓報價；
  // 那個 .then 是背景回呼，使用者這時可能已切到別頁、焦點停在某張卡片上。
  const heldQuotes = [];
  const app = await createAppWindow({ fetchRoutes: {
    "/api/symbols": { ok: true, results: [{ code: "6488", name: "環球晶", exchange: "TPEx" }] },
    "/api/quotes": (raw) => (raw.includes("6488")
      ? new Promise((resolve) => heldQuotes.push(resolve))
      : { ok: false, error: "dom-harness offline" }),
    "/api/watchlists": (raw, init) => (init?.method === "PUT"
      ? { ok: true, rev: 2, lists: JSON.parse(init.body).lists }
      : { ok: true, rev: 1, lists: { 1: [], 2: [], 3: [] } }),
  } });
  apps.push(app);
  await app.settle();
  app.evalIn(`state.screen = "watchlist"; state.watchList = "1"; render();`);
  app.doc.getElementById("watchAdd").click();
  const input = app.doc.getElementById("searchInput");
  input.value = "環球";
  input.dispatchEvent(new app.win.Event("input", { bubbles: true }));
  for (let round = 0; round < 40 && !app.doc.querySelector('.search-result[data-code="6488"]'); round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const result = app.doc.querySelector('.search-result[data-code="6488"]');
  assert.ok(result, "前提：搜尋結果要出現 6488");
  result.click();
  await app.settle(8);
  assert.equal(app.evalIn(`watchLists[1].has("6488")`), true, "前提：已加入清單 1");
  assert.equal(heldQuotes.length, 1, "前提：補抓報價的請求已發出且被扣住");

  // 使用者在補抓期間切到處置看板、焦點停在 6488 卡上。
  const focused = JSON.parse(app.evalIn(`(() => {
    surveillanceBoardState.data = { ok: true, queryDate: "2026-09-07", counts: { inDisposition: 1 }, warnings: [],
      inDisposition: [{ code: "6488", name: "環球晶", exchange: "TPEx", interval: "5", startSlash: "2026/09/01", endSlash: "2026/09/12", daysToRelease: 5 }] };
    surveillanceBoardState.loaded = true;
    state.screen = "surveillance"; state.surveillanceTab = "inDisposition"; render();
    const card = document.querySelector('.surv-card[data-code="6488"]'); card.focus();
    return JSON.stringify({ ok: document.activeElement === card });
  })()`));
  assert.equal(focused.ok, true, "前提：卡片已聚焦");

  const now = new Date().toISOString();
  heldQuotes[0]({ ok: true, sourceKey: "official", source: "測試", generatedAt: now, realtimeCount: 1, fallbackCount: 0, warnings: [], dataQuality: { degraded: false },
    quotes: [{ code: "6488", name: "環球晶", exchange: "TPEx", price: 100, previousClose: 99, open: 99.5, high: 101, low: 98.5, change: 1, changePct: 1.01, unitLots: 1, volumeLots: 1000, turnoverPct: 1, source: "測試", sourceKind: "realtime", asOf: now, priceStale: false }] });
  await app.settle(4);
  const after = JSON.parse(app.evalIn(`JSON.stringify({
    stockLoaded: stocks.some((s) => s.code === "6488"),
    activeIsCard: Boolean(document.activeElement) && document.activeElement.matches('.surv-card[data-code="6488"]'),
    activeDesc: document.activeElement ? document.activeElement.tagName + (document.activeElement.dataset.code ? "[" + document.activeElement.dataset.code + "]" : "") : null,
  })`));
  assert.equal(after.stockLoaded, true, "前提：報價補抓完成、6488 進入 stocks（背景回呼確實跑了）");
  assert.equal(after.activeIsCard, true, `補抓完成的重繪後焦點要還在同一檔處置卡，實際 ${after.activeDesc}`);
});
