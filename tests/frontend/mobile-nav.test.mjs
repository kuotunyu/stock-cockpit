// 手機導覽（M5，2026-09-13）：底部 5 籤／7 籤設定、滑動切頁判定、5 籤模式的「更多」代理、加到主畫面。
// 幾何（每籤寬度、真的滑動）在 tests/browser/mobile-shell.test.mjs 量。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("resolveScreenSwipe：≥ 70px、水平明顯大於垂直、600ms 內才算；被擋一律不算", () => {
  const cases = [
    [{ dx: -120, dy: 10, elapsed: 200, blocked: false }, "next"],
    [{ dx: 120, dy: -20, elapsed: 200, blocked: false }, "prev"],
    [{ dx: -60, dy: 0, elapsed: 200, blocked: false }, null],
    [{ dx: -120, dy: 100, elapsed: 200, blocked: false }, null],
    [{ dx: -120, dy: 10, elapsed: 900, blocked: false }, null],
    [{ dx: -120, dy: 10, elapsed: 200, blocked: true }, null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(json(`resolveScreenSwipe(${JSON.stringify(input)})`), expected, JSON.stringify(input));
  }
});

test("底部導覽預設 5 籤：body.is-nav-5、可見分頁不含盤中選股／處置看板；「更多 → 手機介面」切 7 籤寫 localStorage", () => {
  app.evalIn(`localStorage.removeItem("stock1.navTabs.v1"); applyNavTabsMode();`);
  assert.equal(json(`navTabsMode()`), "5");
  assert.equal(json(`document.body.classList.contains("is-nav-5")`), true);
  assert.deepEqual(json(`visibleNavScreens()`), ["overnight", "strategy", "watchlist", "technical", "more"]);
  assert.equal(json(`document.querySelectorAll(".bottom-nav .nav-action").length`), 7, "DOM 仍 7 顆（讀屏名稱不變），只是 CSS 藏兩顆");
  app.evalIn(`state.screen = "more"; state.morePanel = "mobile"; render();`);
  assert.equal(json(`Boolean(document.querySelector('[data-setting="mobile"]'))`), true, "更多頁有「手機介面」tile");
  assert.equal(json(`document.querySelector('[data-nav-tabs="5"]').getAttribute("aria-pressed")`), "true");
  app.evalIn(`document.querySelector('[data-nav-tabs="7"]').click()`);
  assert.deepEqual(
    json(`[navTabsMode(), localStorage.getItem("stock1.navTabs.v1"), document.body.classList.contains("is-nav-5"), visibleNavScreens().length, document.querySelector('[data-nav-tabs="7"]').getAttribute("aria-pressed")]`),
    ["7", "7", false, 7, "true"],
  );
  app.evalIn(`document.querySelector('[data-nav-tabs="5"]').click()`);
  assert.deepEqual(json(`[navTabsMode(), document.body.classList.contains("is-nav-5")]`), ["5", true]);
});

test("5 籤模式在盤中選股／處置看板時，底部「更多」亮起當代理；更多頁的入口鈕能切到這兩頁", () => {
  app.evalIn(`localStorage.setItem("stock1.navTabs.v1", "5"); applyNavTabsMode(); state.screen = "more"; state.morePanel = "mobile"; render();`);
  app.evalIn(`document.querySelector('[data-go-screen="screener"]').click()`);
  assert.equal(json(`state.screen`), "screener");
  assert.deepEqual(json(`[
    document.querySelector('.bottom-nav .nav-action[data-screen="more"]').classList.contains("is-active-proxy"),
    document.querySelector('.bottom-nav .nav-action[data-screen="screener"]').classList.contains("is-active"),
    document.querySelector('.rail-nav .nav-action[data-screen="more"]')?.classList.contains("is-active-proxy") ?? false,
  ]`), [true, true, false], "只有底部導覽套代理，桌機側欄不套");
  app.evalIn(`state.screen = "overnight"; render();`);
  assert.equal(json(`document.querySelector('.bottom-nav .nav-action[data-screen="more"]').classList.contains("is-active-proxy")`), false);
});

test("加到主畫面：沒有 beforeinstallprompt 時說明未提供；有事件時出現安裝鈕、按下呼叫 prompt() 且只用一次", () => {
  app.evalIn(`pwaState.deferredPrompt = null; pwaState.installed = false;`);
  assert.match(json(`pwaInstallSummary().status`), /瀏覽器未提供|用 Safari 分享|已加到主畫面/);
  app.evalIn(`
    window.__pwaPrompted = 0;
    pwaState.deferredPrompt = { prompt() { window.__pwaPrompted += 1; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: "accepted" }) };
    state.screen = "more"; state.morePanel = "mobile"; render();`);
  assert.equal(json(`pwaInstallSummary().status`), "可安裝");
  assert.equal(json(`Boolean(document.querySelector("[data-pwa-install]"))`), true);
  app.evalIn(`document.querySelector("[data-pwa-install]").click()`);
  assert.equal(json(`window.__pwaPrompted`), 1);
  assert.equal(json(`pwaState.deferredPrompt`), null, "prompt 只能用一次，用掉就清");
  app.evalIn(`pwaState.deferredPrompt = null; pwaState.installed = false; state.screen = "overnight"; render();`);
});
