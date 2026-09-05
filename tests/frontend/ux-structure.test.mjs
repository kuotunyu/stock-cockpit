// UX 補完（結構與 a11y）：「這一頁是什麼」入口、更多頁分兩組、aria-live 移除、toast 逐則、
// 記住最後畫面、常駐說明條收合、隔日沖驗證卡下移、載入 skeleton、篩選後的空狀態文案。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test("topbar 有 44px 的「這一頁是什麼」鈕，開名詞解釋的「畫面說明」分類並帶目前畫面名稱", () => {
  const result = json(`(() => {
    const button = document.getElementById("screenHelp");
    state.screen = "surveillance";
    openScreenHelp(button);
    const modal = document.getElementById("glossaryModal");
    const out = { exists: Boolean(button), label: button?.getAttribute("aria-label"), cat: glossaryState.cat, q: glossaryState.q,
      open: !modal.hidden, firstTerm: document.querySelector("#glossaryBody dt")?.textContent || "" };
    closeGlossary();
    return out;
  })()`);
  assert.equal(result.exists, true);
  assert.equal(result.label, "這一頁是什麼");
  assert.equal(result.cat, "畫面說明");
  assert.equal(result.q, "處置看板");
  assert.equal(result.open, true);
  assert.match(result.firstTerm, /處置看板/);
  // jsdom 不算外部 CSS 的尺寸：沿用 .icon-button（styles.css 固定 44×44）當觸控尺寸的保證。
  const classes = json(`[...document.getElementById("screenHelp").classList]`);
  assert.ok(classes.includes("icon-button") && classes.includes("screen-help"), classes.join(" "));
});

test("更多頁：九顆 tile 分「看盤設定」「帳號與維護」兩組；靜態殼也已補齊九顆", () => {
  const result = json(`(() => {
    const shell = document.querySelectorAll(".settings-panel [data-setting]").length;
    state.screen = "more";
    renderMorePanel();
    const groups = [...document.querySelectorAll(".settings-panel .more-group")].map((h) => h.textContent);
    const order = [...document.querySelectorAll(".settings-panel [data-setting]")].map((b) => b.dataset.setting);
    return { shell, groups, order };
  })()`);
  assert.equal(result.shell, 9, "JS 載入前的殼就要有九顆，避免載入後跳動");
  assert.deepEqual(result.groups, ["看盤設定", "帳號與維護"]);
  assert.deepEqual(result.order, ["glossary", "source", "risk", "alerts", "system", "backup", "brokerGuide", "notesFeed", "version"]);
});

test("讀屏：明細與更多頁的內容區不再 aria-live；toast 每則 role=status、容器不重唸整堆", () => {
  const result = json(`(() => {
    showToast("測試一則");
    const stack = document.getElementById("toastStack");
    return {
      indicatorLive: document.getElementById("indicatorDetail").getAttribute("aria-live"),
      moreLive: document.getElementById("moreDetail")?.getAttribute("aria-live") ?? null,
      atomic: stack.getAttribute("aria-atomic"),
      toastRole: stack.lastElementChild?.getAttribute("role"),
    };
  })()`);
  assert.equal(result.indicatorLive, null);
  assert.equal(result.moreLive, null);
  assert.equal(result.atomic, "false");
  assert.equal(result.toastRole, "status");
});

test("記住最後畫面：切換畫面時寫入 stock1.lastScreen.v1", () => {
  const result = json(`(() => {
    state.screen = "watchlist";
    updateActiveNav();
    return { stored: localStorage.getItem("stock1.lastScreen.v1"), title: document.getElementById("screenTitle").textContent };
  })()`);
  assert.equal(result.stored, "watchlist");
  assert.equal(result.title, "自選股");
});

test("常駐說明條可收合並記住；收合時只留一行", () => {
  const result = json(`(() => {
    const toggle = document.querySelector("[data-scope-note-toggle]");
    toggle.click();
    const note = toggle.closest(".screen-scope-note");
    const afterCollapse = { collapsed: note.classList.contains("is-collapsed"), text: toggle.textContent, expanded: toggle.getAttribute("aria-expanded"), stored: localStorage.getItem("stock1.scopeNoteCollapsed.v1") };
    toggle.click();
    return { afterCollapse, reopened: note.classList.contains("is-collapsed"), storedAfter: localStorage.getItem("stock1.scopeNoteCollapsed.v1") };
  })()`);
  assert.deepEqual(result.afterCollapse, { collapsed: true, text: "展開", expanded: "false", stored: "1" });
  assert.equal(result.reopened, false);
  assert.equal(result.storedAfter, "0");
});

test("隔日沖總覽：驗證成績單排在三組清單之後，標題說的「先看清單」才成立", () => {
  const result = json(`(() => {
    state.screen = "overnight";
    state.overnightView = "overview";
    overnightState.loaded = true;
    overnightState.error = ""; // harness 沒接 /api/overnight，初始載入會留下錯誤字串
    overnightState.asOf = "2026-09-04";
    overnightState.source = "測試";
    overnightState.groups = { strongContinuation: [], volumeDanger: [], pullbackReversal: [] };
    overnightState.warnings = [];
    verifyState.loading = false;
    verifyState.data = { ok: true, available: true, signalDate: "2026-09-04", observationDate: "2026-09-05", observationPhase: "final", summary: { total: 1, hitPlus2: 1, brokeMinus2: 0 }, rows: [] };
    renderOvernightGroups();
    const html = el.overnightGroups.innerHTML;
    return { focus: html.indexOf("today-focus-panel"), verify: html.indexOf("verify-panel") };
  })()`);
  assert.ok(result.focus >= 0 && result.verify >= 0, JSON.stringify(result));
  assert.ok(result.verify > result.focus, "驗證卡必須在訊號重點與清單之後");
});

test("列表：第一次載入用三列 skeleton；篩選生效時的 0 筆要說「篩選後」", () => {
  const result = json(`(() => {
    const container = document.createElement("div");
    const prev = { loadedOnce: dataState.loadedOnce, error: dataState.error, direction: state.direction, stocksLen: stocks.length };
    dataState.loadedOnce = false; dataState.error = ""; stocks.length = 0;
    renderRows(container, [], "screener");
    const skeletons = container.querySelectorAll(".stock-row.is-skeleton").length;
    const skeletonRole = container.firstElementChild?.getAttribute("role");
    dataState.loadedOnce = true; stocks.push({ code: "2330" });
    state.direction = "up";
    renderRows(container, [], "screener");
    const filteredText = container.textContent;
    state.direction = "all"; state.watchOnly = false; state.minTurnover = 0; state.showSurveillance = true;
    renderRows(container, [], "screener");
    const plainText = container.textContent;
    dataState.loadedOnce = prev.loadedOnce; dataState.error = prev.error; state.direction = prev.direction; stocks.length = prev.stocksLen;
    return { skeletons, skeletonRole, filteredText, plainText };
  })()`);
  assert.equal(result.skeletons, 3);
  assert.equal(result.skeletonRole, "status");
  assert.match(result.filteredText, /篩選後沒有符合的標的（不是今天沒有）/);
  assert.match(result.plainText, /沒有符合條件的標的/);
  assert.doesNotMatch(result.plainText, /篩選後/);
});

test("手機 sheet 的關閉鈕：aria-label 是收合、備有向下箭頭；資料來源 pill 存在且預設收合", () => {
  const result = json(`(() => ({
    label: document.getElementById("detailClose").getAttribute("aria-label"),
    hasDown: Boolean(document.querySelector("#detailClose .detail-close-mobile")),
    pill: document.getElementById("sourcePill")?.getAttribute("aria-expanded"),
    loginNote: document.querySelector(".login-note")?.textContent || "",
  }))()`);
  assert.equal(result.label, "收合明細");
  assert.equal(result.hasDown, true);
  assert.equal(result.pill, "false");
  assert.doesNotMatch(result.loginNote, /部署到雲端/);
  assert.match(result.loginNote, /管理者/);
});
