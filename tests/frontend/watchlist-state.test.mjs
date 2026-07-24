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
