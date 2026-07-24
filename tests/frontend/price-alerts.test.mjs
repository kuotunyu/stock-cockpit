// 到價提醒前端邏輯：觸價方向、一次性、priceStale 跳過、盒渲染、列表鈴鐺。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

function seed(alerts, stockRows) {
  // 觸發時 checkPriceAlerts 會呼叫 render() → filterStocks 等會讀 groups/strategies/spark，
  // fixture 要補上這些必要欄位，避免渲染鏈炸掉。
  const rows = stockRows.map((row) => ({
    groups: [],
    strategies: [],
    spark: [],
    change: 0,
    changeText: "0%",
    signal: "flat",
    unit: 0,
    total: 0,
    ...row,
  }));
  app.evalIn(`
    priceAlertsState.alerts = ${JSON.stringify(alerts)};
    stocks.length = 0;
    ${JSON.stringify(rows)}.forEach((row) => stocks.push(row));
  `);
}

test("checkPriceAlerts：漲到/跌到方向正確，觸發後標記 triggeredAt 且不重複", () => {
  seed(
    [
      { id: "up1", code: "2330", op: ">=", price: 1080, active: true, triggeredAt: "" },
      { id: "dn1", code: "1101", op: "<=", price: 38, active: true, triggeredAt: "" },
      { id: "far", code: "2330", op: ">=", price: 2000, active: true, triggeredAt: "" },
    ],
    [
      { code: "2330", name: "台積電", price: 1085, spark: [] },
      { code: "1101", name: "台泥", price: 37.5, spark: [] },
    ]
  );
  assert.equal(app.evalIn(`checkPriceAlerts()`), 2, "漲到與跌到各觸發一筆");
  const alerts = json(`priceAlertsState.alerts`);
  assert.ok(alerts.find((a) => a.id === "up1").triggeredAt, "站上目標 → 觸發");
  assert.equal(alerts.find((a) => a.id === "up1").active, false, "觸發後轉不作用（一次性）");
  assert.ok(alerts.find((a) => a.id === "dn1").triggeredAt, "跌破目標 → 觸發");
  assert.equal(alerts.find((a) => a.id === "far").triggeredAt, "", "沒到價不觸發");
  // 再跑一次：已觸發的不重複
  assert.equal(app.evalIn(`checkPriceAlerts()`), 0);
});

test("checkPriceAlerts：priceStale（顯示昨收）與查無報價的檔位跳過", () => {
  seed(
    [
      { id: "s1", code: "3333", op: ">=", price: 10, active: true, triggeredAt: "" },
      { id: "s2", code: "9999", op: ">=", price: 10, active: true, triggeredAt: "" },
    ],
    [{ code: "3333", name: "無即時", price: 99, priceStale: true, spark: [] }]
  );
  assert.equal(app.evalIn(`checkPriceAlerts()`), 0, "昨收不算觸價；沒報價不觸發");
});

test("checkPriceAlerts：loader 指定的本輪即時代號缺少時，不沿用 stocks 舊價", () => {
  seed(
    [{ id: "old1", code: "2330", op: ">=", price: 100, active: true, triggeredAt: "" }],
    [{ code: "2330", name: "台積電", price: 999, priceStale: false, spark: [] }]
  );
  assert.equal(app.evalIn(`checkPriceAlerts(new Set())`), 0, "本輪 API 沒回 2330，不得用上一輪 999 元觸發");
  assert.equal(app.evalIn(`priceAlertsState.alerts[0].triggeredAt`), "");
});

test("eligibleAlertQuoteCodes：只接受今日 realtime／broker-realtime，不接受 daily-close 或舊日資料", () => {
  const eligible = json(`(() => {
    const today = getTaiwanClockParts().isoDate;
    const slash = today.replaceAll("-", "/");
    return [...eligibleAlertQuoteCodes([
      { code: "1111", price: 50, sourceKind: "daily-close", asOf: slash, priceStale: false },
      { code: "2222", price: 60, sourceKind: "realtime", asOf: "2000/01/01 13:30:00", priceStale: false },
      { code: "3333", price: 70, sourceKind: "realtime", asOf: slash + " 10:00:00", priceStale: false },
      { code: "4444", price: 80, sourceKind: "broker-realtime", asOf: slash + " 10:00:00", priceStale: false },
      { code: "5555", price: 90, sourceKind: "realtime", asOf: slash + " 10:00:00", priceStale: true }
    ])];
  })()`);
  assert.deepEqual(eligible.sort(), ["3333", "4444"]);
});

test("checkPriceAlerts：除息日觸發的 toast 要加註除息缺口", () => {
  seed(
    [{ id: "ex1", code: "2330", op: "<=", price: 100, active: true, triggeredAt: "" }],
    [{
      code: "2330", name: "台積電", price: 97,
      dividend: { exDate: "2026-07-02", kind: "除息", cash: 3, isToday: true, daysUntil: 0 },
    }]
  );
  assert.equal(app.evalIn(`checkPriceAlerts()`), 1);
  assert.ok(
    app.evalIn(`document.body.textContent`).includes("除息缺口"),
    "toast 要提醒使用者跌幅含除息缺口"
  );
});

test("addPriceAlert：驗證輸入；alertsForCode 過濾", () => {
  app.evalIn(`priceAlertsState.alerts = [];`);
  assert.equal(app.evalIn(`addPriceAlert("2330", ">=", "abc")`), false, "非數字擋下");
  assert.equal(app.evalIn(`addPriceAlert("2330", ">=", "-3")`), false, "負數擋下");
  assert.equal(app.evalIn(`addPriceAlert("2330", "<=", "999.456")`), true);
  const list = json(`alertsForCode("2330")`);
  assert.equal(list.length, 1);
  assert.equal(list[0].price, 999.46, "四捨五入到兩位");
  assert.equal(list[0].op, "<=");
  assert.deepEqual(json(`alertsForCode("1101")`), [], "別檔查不到");
});

test("addPriceAlert：50 筆上限會擋下且不顯示成功；49 筆仍可加入", () => {
  app.evalIn(`
    document.getElementById("toastStack").replaceChildren();
    priceAlertsState.alerts = Array.from({ length: 50 }, (_, index) => ({ id: "a" + index }));
  `);
  const before = json(`priceAlertsState.alerts`);

  assert.equal(app.evalIn(`addPriceAlert("2330", ">=", 1000)`), false);
  assert.deepEqual(json(`priceAlertsState.alerts`), before, "到上限後提醒清單不可異動");
  const cappedToast = app.evalIn(`document.getElementById("toastStack").textContent`);
  assert.ok(cappedToast.includes("最多 50 筆"), "要明確說明容量上限");
  assert.ok(!cappedToast.includes("已設定"), "被擋下時不可顯示成功訊息");

  app.evalIn(`
    document.getElementById("toastStack").replaceChildren();
    priceAlertsState.alerts = Array.from({ length: 49 }, (_, index) => ({ id: "b" + index }));
  `);
  assert.equal(app.evalIn(`addPriceAlert("2330", ">=", 1000)`), true, "低於上限仍可加入");
  assert.equal(app.evalIn(`priceAlertsState.alerts.length`), 50);
  assert.ok(app.evalIn(`document.getElementById("toastStack").textContent`).includes("已設定 2330 到價提醒"));
  app.evalIn(`window.clearTimeout(alertSyncTimer);`);
});

test("syncAlertsToServer：PUT canonical response 套回提醒與 rev", async (t) => {
  const syncApp = await createAppWindow({
    fetchRoutes: {
      "/api/alerts": (_raw, init) => init?.method === "PUT"
        ? { ok: true, rev: 8, alerts: [{ id: "server", code: "2330", op: ">=", price: 1000, active: true }] }
        : { ok: true, rev: 1, alerts: [] },
    },
  });
  t.after(() => syncApp.cleanup());

  await syncApp.evalIn(`
    priceAlertsState.alerts = [{ id: "local", code: "1101", op: "<=", price: 30, active: true }];
    alertMutationVersion += 1;
    syncAlertsToServer()
  `);

  assert.deepEqual(JSON.parse(syncApp.evalIn(`JSON.stringify(priceAlertsState.alerts)`)), [
    { id: "server", code: "2330", op: ">=", price: 1000, active: true },
  ]);
  assert.equal(syncApp.evalIn(`priceAlertsState.rev`), 8);
});

test("syncAlertsToServer：延遲舊回應不得覆蓋期間內的較新本機異動", async (t) => {
  let putCount = 0;
  let resolveFirst;
  let resolveSecond;
  let secondRequestAlerts;
  const syncApp = await createAppWindow({
    fetchRoutes: {
      "/api/alerts": (_raw, init) => {
        if (init?.method !== "PUT") return { ok: true, rev: 1, alerts: [] };
        putCount += 1;
        if (putCount === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        secondRequestAlerts = JSON.parse(init.body).alerts;
        return new Promise((resolve) => { resolveSecond = resolve; });
      },
    },
  });
  t.after(() => syncApp.cleanup());

  const firstSync = syncApp.evalIn(`
    priceAlertsState.alerts = [{ id: "a1", code: "2330", op: ">=", price: 1000, active: true }];
    alertMutationVersion += 1;
    syncAlertsToServer()
  `);
  syncApp.evalIn(`
    priceAlertsState.alerts.push({ id: "a2", code: "1101", op: "<=", price: 30, active: true });
    alertMutationVersion += 1;
  `);
  resolveFirst({ ok: true, rev: 2, alerts: [{ id: "stale", code: "9999", op: ">=", price: 1, active: true }] });
  await firstSync;

  for (let round = 0; round < 20 && !resolveSecond; round += 1) await syncApp.settle(1);
  assert.equal(putCount, 2, "舊回應完成後應補送期間內的新版本");
  assert.deepEqual(JSON.parse(syncApp.evalIn(`JSON.stringify(priceAlertsState.alerts.map((alert) => alert.id))`)), ["a1", "a2"], "舊 canonical 不可覆寫新內容");
  assert.deepEqual(secondRequestAlerts.map((alert) => alert.id), ["a1", "a2"], "補送內容要是最新本機版本");

  resolveSecond({ ok: true, rev: 3, alerts: secondRequestAlerts });
  await syncApp.settle(2);
  assert.deepEqual(JSON.parse(syncApp.evalIn(`JSON.stringify(priceAlertsState.alerts.map((alert) => alert.id))`)), ["a1", "a2"]);
  assert.equal(syncApp.evalIn(`priceAlertsState.rev`), 3);
});

test("renderPriceAlertBox：清單＋表單＋已觸發樣式；無股票 → 隱藏", () => {
  seed(
    [
      { id: "r1", code: "2330", op: ">=", price: 1080, active: true, triggeredAt: "" },
      { id: "r2", code: "2330", op: "<=", price: 900, active: false, triggeredAt: "2026-07-02T01:00:00.000Z" },
    ],
    [{ code: "2330", name: "台積電", price: 1000, spark: [] }]
  );
  app.evalIn(`renderPriceAlertBox(stocks[0])`);
  assert.equal(json(`el.priceAlertBox.hidden`), false);
  assert.equal(json(`el.priceAlertBox.querySelectorAll('.alert-row').length`), 2);
  assert.equal(json(`el.priceAlertBox.querySelectorAll('.alert-row.is-done').length`), 1, "已觸發的有完成樣式");
  assert.equal(json(`!!el.priceAlertBox.querySelector('[data-alert-form]')`), true, "登入狀態要有新增表單");
  const text = app.evalIn(`el.priceAlertBox.textContent`);
  assert.ok(text.includes("漲到") && text.includes("跌到"));
  assert.ok(text.includes("頁面顯示於前景"), "官方來源要誠實說明背景頁不監控");
  app.evalIn(`sourceState.selected = "broker"; renderPriceAlertBox(stocks[0])`);
  assert.ok(app.evalIn(`el.priceAlertBox.textContent`).includes("券商模式不自動輪詢"), "券商來源要明示需手動更新");
  app.evalIn(`sourceState.selected = "official";`);
  app.evalIn(`renderPriceAlertBox(null)`);
  assert.equal(json(`el.priceAlertBox.hidden`), true);
});

test("rowTemplate：有效提醒的列帶 🔔 鈴鐺；全部已觸發則不帶", () => {
  seed(
    [{ id: "b1", code: "2330", op: ">=", price: 1080, active: true, triggeredAt: "" }],
    [{ code: "2330", name: "台積電", price: 1000, change: 1, changeText: "+1%", spark: [], signal: "buy", unit: 10, total: 100 }]
  );
  assert.ok(app.evalIn(`rowTemplate(stocks[0], "watchlist")`).includes("alert-bell"), "等待中的提醒 → 鈴鐺");
  app.evalIn(`priceAlertsState.alerts[0].active = false;`);
  assert.ok(!app.evalIn(`rowTemplate(stocks[0], "watchlist")`).includes("alert-bell"), "沒有等待中的提醒 → 不帶鈴鐺");
});
