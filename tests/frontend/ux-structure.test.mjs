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
    return { focus: html.indexOf("today-focus-panel"), verify: html.indexOf("verify-panel"), badge: html.includes('class="provenance-badge" data-kind="official"') };
  })()`);
  assert.ok(result.focus >= 0 && result.verify >= 0, JSON.stringify(result));
  assert.ok(result.verify > result.focus, "驗證卡必須在訊號重點與清單之後");
  assert.equal(result.badge, true, "來源 chip 要套 provenance-badge token");
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

// ---- 第二輪第一批：頂欄 grid 必須放得下全部子元素（「?」鈕曾把 4 欄 grid 撐到隱含第二列） ----
import { readFile } from "node:fs/promises";
const css = await readFile(new URL("../../styles.css", import.meta.url), "utf8");

function gridColumnsOf(block) {
  const match = block.match(/grid-template-columns:\s*([^;]+);/);
  assert.ok(match, "區塊裡沒有 grid-template-columns");
  // minmax(0, 1fr) 內含空白，先把括號內容壓成一個字再切
  return match[1].replace(/\([^)]*\)/g, "()").trim().split(/\s+/).length;
}
function topbarBlockAt(mediaPrefix) {
  // 同一個 media 條件在檔案裡出現多次；取該條件之後第一個「有 grid-template-areas」的 .topbar 區塊。
  const start = css.indexOf(mediaPrefix);
  assert.ok(start >= 0, `找不到 ${mediaPrefix}`);
  const blocks = [...css.slice(start).matchAll(/\.topbar\s*\{[^}]*\}/g)].map((m) => m[0]);
  const block = blocks.find((text) => text.includes("grid-template-areas"));
  assert.ok(block, `${mediaPrefix} 之後沒有帶 grid-template-areas 的 .topbar 區塊`);
  return block;
}

test("頂欄 grid：桌機欄數＝直接子元素數；760px 與 340px 的 areas 都給「?」一個位置", () => {
  const children = json(`document.querySelector(".topbar").children.length`);
  assert.equal(children, 5, "market-pill、h1、screenHelp、source-switch、top-actions");
  const desktop = css.match(/\n\.topbar\s*\{[^}]*\}/)[0];
  assert.equal(gridColumnsOf(desktop), children, "桌機 grid 欄數要等於子元素數，否則最後一個會掉到隱含第二列");
  for (const prefix of ["@media (max-width: 760px)", "@media (max-width: 340px)"]) {
    const block = topbarBlockAt(prefix);
    const areas = block.match(/grid-template-areas:\s*([^;]+);/);
    assert.ok(areas, `${prefix} 的 .topbar 要有 grid-template-areas`);
    assert.match(areas[1], /\bhelp\b/, `${prefix} 的 areas 要含 help`);
    const rows = areas[1].match(/"[^"]+"/g).map((row) => row.replace(/"/g, "").trim().split(/\s+/).length);
    const columns = gridColumnsOf(block);
    assert.ok(rows.every((count) => count === columns), `${prefix}：每一列的 area 數（${rows.join(",")}）要等於欄數 ${columns}`);
  }
  assert.match(css, /\.screen-help\s*\{[^}]*grid-area:\s*help/, ".screen-help 要指到 help 區");
});

test("隔日沖摘要 chip 樣式只套在 facts 的直接子元素（.market-stance 與來源徽章不再被包成 chip 套 chip）", () => {
  assert.doesNotMatch(css, /\.overnight-summary-facts span\s*\{/, "後代選擇器會把 .market-stance 裡的漲跌數字與 ⚠ 包成小藥丸");
  assert.match(css, /\.overnight-summary-facts\s*>\s*span\s*\{/);
  assert.match(css, /\.overnight-summary\s+\.market-stance\s*\{[^}]*flex-basis:\s*100%/, "位階行在摘要條裡要獨佔一行");
});

// ---- 第二輪第一批：決策工具的登入閘、名詞表補條目 ----
const samplePick = JSON.stringify({ code: "2330", name: "台積電", price: 100, changePct: 1, score: 80, scenario: { key: "midBandDefense", name: "中軌攻防" }, plan: { entry: 100, structuralStop: 95, initialStop: 95, trailingTrigger: 105, target: 110, rr: 2, rrNet: 1.8 }, reasons: [], warnings: [] });

test("未登入按「建立三筆到價提醒」→ 直接開登入閘並說明原因；卡片按鈕文案也講明要登入", () => {
  const result = json(`(() => {
    const prevUser = authState.user;
    authState.user = null;
    const out = createPlanAlerts("2330", { structuralStop: 95, target: 110, trailingTrigger: 105 });
    const gate = document.getElementById("loginGate");
    const open = !gate.hidden;
    const message = document.getElementById("loginMessage")?.textContent || "";
    const anonCard = renderSwingCard(${samplePick}, 1);
    closeDialogLayer(gate);
    authState.user = { id: "u1", username: "me", role: "user" };
    const inCard = renderSwingCard(${samplePick}, 1);
    authState.user = prevUser;
    return { out, open, message, anonLabel: /登入後建立提醒/.test(anonCard), inLabel: /建立三筆到價提醒/.test(inCard) };
  })()`);
  assert.deepEqual(result.out, { created: 0, skipped: 0, loginRequired: true });
  assert.equal(result.open, true, "setLoginGateVisible 就在手邊，不該叫人自己走「更多 → 帳號管理」三層");
  assert.match(result.message, /登入後/);
  assert.equal(result.anonLabel, true);
  assert.equal(result.inLabel, true);
});

test("名詞表：新分類「成績單與決策」補齊 8 條（成績單與決策工具的數字以前只在 title 裡解釋）", () => {
  assert.ok(json(`GLOSSARY_CATS.includes("成績單與決策")`));
  const terms = json(`GLOSSARY.filter((g) => g.cat === "成績單與決策").map((g) => g.term + "|" + (g.aliases || []).join("|"))`);
  for (const needle of ["開盤賣勝率", "信賴區間", "獲利因子", "最長連虧", "大盤位階", "期指基差", "建議張數", "次日開盤進場"]) {
    assert.ok(terms.some((t) => t.includes(needle)), `缺 ${needle}`);
  }
  assert.ok(terms.length >= 8, terms.join(" | "));
});
