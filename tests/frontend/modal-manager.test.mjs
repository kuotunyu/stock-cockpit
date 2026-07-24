// 對話框回歸：最上層焦點、背景隔離與 Escape 必須維持單一一致的堆疊行為。
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;

beforeEach(async () => {
  app = await createAppWindow();
});

afterEach(() => app.cleanup());

function pressKey(target, key, options = {}) {
  const event = new app.win.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

test("every authored dialog has an accessible name and each visible trigger declares its dialog", () => {
  const dialogs = [...app.doc.querySelectorAll('[role="dialog"]')];
  assert.equal(dialogs.length, 10);

  for (const dialog of dialogs) {
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const name = labelledBy
      ? app.doc.getElementById(labelledBy)?.textContent?.trim()
      : dialog.getAttribute("aria-label")?.trim();
    assert.ok(name, `dialog ${dialog.parentElement?.id || dialog.className} needs an accessible name`);
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(dialog.tabIndex, -1);
  }

  const triggerIds = [
    "searchOpen",
    "filterOpen",
    "glossaryOpen",
    "strategyLegendToggle",
    "technicalHelpOpen",
    "technicalZoomOpen",
    "survHelpOpen",
    "detailZoomOpen",
    "zoomChartHelpOpen",
  ];
  for (const id of triggerIds) {
    const trigger = app.doc.getElementById(id);
    assert.ok(trigger, `missing trigger #${id}`);
    assert.equal(trigger.getAttribute("aria-haspopup"), "dialog", `#${id} should announce a dialog`);
    assert.ok(app.doc.getElementById(trigger.getAttribute("aria-controls")), `#${id} controls a missing element`);
  }

  for (const id of ["technicalChart", "priceChart"]) {
    const canvasTrigger = app.doc.getElementById(id);
    assert.equal(canvasTrigger.getAttribute("role"), "button");
    assert.equal(canvasTrigger.tabIndex, 0);
    assert.ok(canvasTrigger.getAttribute("aria-label")?.trim());
  }
});

test("search dialog owns focus, loops Tab in both directions, locks the page, and restores its opener", async () => {
  const opener = app.doc.getElementById("searchOpen");
  const modal = app.doc.getElementById("searchModal");
  const input = app.doc.getElementById("searchInput");

  opener.focus();
  opener.click();
  await app.settle(4);

  assert.equal(modal.hidden, false);
  assert.equal(app.doc.body.classList.contains("has-modal"), true);
  assert.equal(app.doc.activeElement, input);
  assert.ok(opener.closest("[inert]"), "content behind the dialog should be inert");

  app.evalIn("getDialogFocusables(el.searchModal).at(-1).focus()");
  const last = app.doc.activeElement;
  const forward = pressKey(last, "Tab");
  assert.equal(forward.defaultPrevented, true);
  assert.equal(app.doc.activeElement, input);

  const backward = pressKey(input, "Tab", { shiftKey: true });
  assert.equal(backward.defaultPrevented, true);
  assert.equal(app.doc.activeElement, last);

  pressKey(app.doc.activeElement, "Escape");
  await app.settle(4);

  assert.equal(modal.hidden, true);
  assert.equal(app.doc.body.classList.contains("has-modal"), false);
  assert.equal(
    app.doc.activeElement,
    opener,
    `expected focus on #searchOpen, got #${app.doc.activeElement?.id || "(no id)"}`,
  );
  assert.equal(opener.closest("[inert]"), null);
});

test("one Escape closes surveillance help without also closing an open stock detail", async () => {
  const detail = app.doc.getElementById("detailPanel");
  const help = app.doc.getElementById("survHelp");

  app.evalIn("openDetailPanel()");
  app.doc.getElementById("survHelpOpen").click();
  await app.settle(4);

  assert.equal(detail.classList.contains("is-open"), true);
  assert.equal(help.hidden, false);

  pressKey(app.doc.activeElement, "Escape");
  await app.settle(4);

  assert.equal(help.hidden, true);
  assert.equal(detail.classList.contains("is-open"), true, "Escape must not cascade into the detail panel");
});

test("mobile stock detail is inert while closed, owns focus while open, and restores its opener on Escape", async () => {
  const detail = app.doc.getElementById("detailPanel");
  const opener = app.doc.getElementById("searchOpen");
  const close = app.doc.getElementById("detailClose");

  assert.equal(detail.hasAttribute("inert"), true, "off-screen detail controls must not remain in the Tab order");
  assert.equal(detail.getAttribute("aria-hidden"), "true");

  opener.focus();
  app.evalIn("openDetailPanel(el.searchOpen)");
  await app.settle(4);

  assert.equal(detail.classList.contains("is-open"), true);
  assert.equal(detail.hasAttribute("inert"), false);
  assert.equal(detail.getAttribute("role"), "dialog");
  assert.equal(detail.getAttribute("aria-modal"), "true");
  assert.equal(app.doc.body.classList.contains("has-modal"), true);
  assert.equal(app.doc.activeElement, close);
  assert.ok(opener.closest("[inert]"), "content behind the mobile sheet should be inert");

  app.evalIn("getDialogFocusables(el.detailPanel).at(-1).focus()");
  const forward = pressKey(app.doc.activeElement, "Tab");
  assert.equal(forward.defaultPrevented, true);
  assert.equal(app.doc.activeElement, close);

  pressKey(app.doc.activeElement, "Escape");
  await app.settle(4);
  for (let attempt = 0; attempt < 8 && app.doc.activeElement !== opener; attempt += 1) {
    await app.settle(1);
  }

  assert.equal(detail.classList.contains("is-open"), false);
  assert.equal(detail.hasAttribute("inert"), true);
  assert.equal(detail.getAttribute("aria-hidden"), "true");
  assert.equal(app.doc.body.classList.contains("has-modal"), false);
  assert.equal(
    app.doc.activeElement,
    opener,
    `expected mobile detail focus on #searchOpen, got #${app.doc.activeElement?.id || "(no id)"}`,
  );
  assert.equal(opener.closest("[inert]"), null);
});

test("mobile detail restores focus to the replacement stock row after its opener is rerendered", async () => {
  app.evalIn(`
    stocks.length = 0;
    stocks.push({
      code: "2330", name: "台積電", change: 1, turnover: 2, total: 9000,
      unit: 5, high: 1010, low: 990, price: 1000, avgVol: 2,
      spark: [990, 1000], groups: ["strong"], strategies: ["量價轉強"], surveillance: null
    });
    state.screen = "screener";
    state.universe = "strong";
    render();
  `);
  const fixtureDebug = JSON.parse(app.evalIn(`JSON.stringify({
    filtered: filterStocks("screener").length,
    stock: stocks[0],
    universe: state.universe,
    strategy: state.strategy,
    direction: state.direction,
    watchOnly: state.watchOnly,
    showSurveillance: state.showSurveillance
  })`));
  assert.equal(fixtureDebug.filtered, 1, JSON.stringify(fixtureDebug));
  assert.match(app.doc.getElementById("screenerRows").innerHTML, /data-code="2330"/);
  const original = app.doc.querySelector('.stock-row[data-code="2330"]');
  assert.ok(original, "fixture needs a rendered 2330 stock row");

  original.focus();
  original.click();
  await app.settle(4);
  assert.equal(app.doc.activeElement, app.doc.getElementById("detailClose"));

  pressKey(app.doc.activeElement, "Escape");
  await app.settle(4);

  const replacement = app.doc.querySelector('.stock-row[data-code="2330"]');
  assert.ok(replacement);
  assert.notEqual(replacement, original, "opening detail rerenders the active stock list");
  for (let attempt = 0; attempt < 8 && app.doc.activeElement !== replacement; attempt += 1) {
    await app.settle(1);
  }
  assert.equal(app.doc.activeElement, replacement);
});

test("desktop stock detail remains a persistent aside instead of becoming modal", async () => {
  const desktop = await createAppWindow({
    beforeApp(win) {
      win.matchMedia = (query) => ({
        matches: query.includes("min-width: 1040px"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
    },
  });
  try {
    const detail = desktop.doc.getElementById("detailPanel");
    const opener = desktop.doc.getElementById("searchOpen");
    opener.focus();
    desktop.evalIn("openDetailPanel(el.searchOpen)");
    await desktop.settle(4);

    assert.equal(detail.hasAttribute("inert"), false);
    assert.equal(detail.hasAttribute("aria-hidden"), false);
    assert.equal(detail.hasAttribute("role"), false);
    assert.equal(detail.hasAttribute("aria-modal"), false);
    assert.equal(desktop.doc.body.classList.contains("has-modal"), false);
    assert.equal(desktop.doc.activeElement, opener, "persistent desktop aside must not steal focus");
  } finally {
    desktop.cleanup();
  }
});

test("technical zoom and its nested help close one layer at a time", async () => {
  const zoom = app.doc.getElementById("technicalZoomModal");
  const zoomSurface = zoom.querySelector('[role="dialog"]');
  const help = app.doc.getElementById("zoomChartHelp");
  const helpTrigger = app.doc.getElementById("zoomChartHelpOpen");
  const zoomTrigger = app.doc.getElementById("technicalZoomOpen");

  app.evalIn(`
    zoomChartState.open = true;
    openDialogLayer(el.technicalZoomModal, {
      trigger: el.technicalZoomOpen,
      initialFocus: ".chart-zoom-modal"
    });
  `);
  await app.settle(4);
  helpTrigger.click();
  await app.settle(4);

  assert.equal(zoom.hidden, false);
  assert.equal(help.hidden, false);
  assert.equal(zoomSurface.getAttribute("aria-modal"), "false");
  assert.equal(zoom.hasAttribute("inert"), true);

  pressKey(app.doc.activeElement, "Escape");
  await app.settle(4);

  assert.equal(help.hidden, true);
  assert.equal(zoom.hidden, false);
  assert.equal(zoomSurface.getAttribute("aria-modal"), "true");
  assert.equal(zoom.hasAttribute("inert"), false);
  assert.equal(app.doc.activeElement, helpTrigger);

  pressKey(app.doc.activeElement, "Escape");
  await app.settle(4);

  assert.equal(zoom.hidden, true);
  assert.equal(app.doc.body.classList.contains("has-modal"), false);
  assert.equal(app.doc.activeElement, zoomTrigger);
});

test("login dialog rejects background focus and can be cancelled safely", async () => {
  const opener = app.doc.getElementById("searchOpen");
  const gate = app.doc.getElementById("loginGate");
  const username = app.doc.getElementById("loginUsername");

  opener.focus();
  app.evalIn('setLoginGateVisible(true, "請先登入")');
  await app.settle(4);

  assert.equal(gate.hidden, false);
  assert.equal(app.doc.activeElement, username);
  assert.ok(opener.closest("[inert]"));

  opener.focus();
  assert.equal(app.doc.activeElement, username, "focus guard should return focus to the top dialog");

  app.doc.getElementById("loginClose").click();
  await app.settle(4);

  assert.equal(gate.hidden, true);
  assert.equal(app.doc.body.classList.contains("has-modal"), false);
  assert.equal(opener.closest("[inert]"), null);
  assert.equal(app.doc.activeElement, opener);
});

test("repeated auth prompts preserve the opener and return to an underlying dialog", async () => {
  const search = app.doc.getElementById("searchModal");
  const searchInput = app.doc.getElementById("searchInput");
  const gate = app.doc.getElementById("loginGate");

  app.doc.getElementById("searchOpen").click();
  await app.settle(4);
  assert.equal(app.doc.activeElement, searchInput);

  app.evalIn('setLoginGateVisible(true, "第一次驗證")');
  await app.settle(4);
  app.evalIn('setLoginGateVisible(true, "重複驗證")');
  await app.settle(4);

  app.doc.getElementById("loginClose").click();
  await app.settle(4);

  assert.equal(gate.hidden, true);
  assert.equal(search.hidden, false);
  assert.equal(search.querySelector('[role="dialog"]').getAttribute("aria-modal"), "true");
  assert.equal(app.doc.body.classList.contains("has-modal"), true);
  assert.equal(app.doc.activeElement, searchInput);
});
