// 更多頁「版本與更新」面板：狀態→文案的對應、未查詢/查不到時不得謊報最新、字串跳脫。
//
// 這個面板存在的理由是三個人各自 git pull、各自 npm start，畫面對不上時要能先確認
// 彼此跑的是不是同一份 code。因此最重要的一條是：**「不知道」不可以被講成「已是最新」**。
import test from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

const BUILD = { available: true, commit: "55d5bed", branch: "main", repo: "kuotunyu/stock-cockpit" };

function showVersionPanel(app, { build = BUILD, update = null, loaded = true, loading = false, error = "", version = "0.1.0", identity = { runtime: { commit: '55d5bed', fingerprint: 'a'.repeat(64), dirty: false }, disk: { commit: '55d5bed', fingerprint: 'a'.repeat(64), dirty: false }, restartRequired: false } } = {}) {
  app.evalIn(`
    appVersionState.loaded = ${JSON.stringify(loaded)};
    appVersionState.loading = ${JSON.stringify(loading)};
    appVersionState.error = ${JSON.stringify(error)};
    appVersionState.version = ${JSON.stringify(version)};
    appVersionState.build = ${JSON.stringify(build)};
    appVersionState.update = ${JSON.stringify(update)};
    appVersionState.identity = ${JSON.stringify(identity)};
    if (appVersionState.identity && !appVersionState.identity.shellVersion) appVersionState.identity.shellVersion = typeof APP_SHELL_VERSION === 'undefined' ? 'legacy' : APP_SHELL_VERSION;
    state.screen = "more";
    state.morePanel = "version";
    render();
  `);
}

function panelText(app) {
  return app.doc.getElementById("moreDetail")?.textContent || "";
}

function tileBadge(app) {
  const tile = app.doc.querySelector('[data-setting="version"]');
  return tile?.querySelector("em")?.textContent || "";
}

test("落後時要說出落後幾個 commit，並給出可照做的更新步驟", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: "behind", behindBy: 3, localAhead: 0 } });
    const text = panelText(app);
    assert.match(text, /3 個新 commit/);
    assert.match(text, /git pull/);
    assert.match(text, /重新啟動伺服器/, "改了 server.mjs 一定要重啟，文案不能漏掉這步");
    assert.equal(tileBadge(app), "落後 3");
    assert.match(text, /main@55d5bed/, "本機 commit 要看得到，才能跟朋友對版");
  } finally {
    app.cleanup();
  }
});

test('後端與磁碟不符優先提示重啟，前端載入版本不隨 API 漂移', async () => {
  const app = await createAppWindow();
  try {
    const shell = app.evalIn('typeof APP_SHELL_VERSION === "undefined" ? "missing" : APP_SHELL_VERSION');
    showVersionPanel(app, { identity: { runtime: { commit: 'old', fingerprint: 'a', dirty: false }, disk: { commit: 'new', fingerprint: 'b', dirty: true }, shellVersion: 'shell-next', restartRequired: true }, update: { state: 'current' } });
    assert.equal(tileBadge(app), '需要重啟');
    assert.match(panelText(app), /執行中後端/); assert.match(panelText(app), /磁碟後端/); assert.match(panelText(app), /本分頁外殼/);
    assert.match(panelText(app), /未提交修改/);
    assert.ok(panelText(app).includes(shell)); assert.notEqual(shell, 'missing');
    assert.equal(app.evalIn('APP_SHELL_VERSION'), shell);
  } finally { app.cleanup(); }
});

test('純文件 commit 更新不強制重啟；只有外殼不同時要求刷新', async () => {
  const app = await createAppWindow();
  try {
    const identity = { runtime: { commit: 'old', fingerprint: 'a', dirty: false }, disk: { commit: 'docs', fingerprint: 'a', dirty: false }, restartRequired: false };
    showVersionPanel(app, { identity, update: { state: 'current' } });
    assert.match(panelText(app), /後端來源一致/); assert.doesNotMatch(panelText(app), /需要重啟/);
    showVersionPanel(app, { identity: { ...identity, shellVersion: 'shell-new' }, update: { state: 'current' } });
    assert.equal(tileBadge(app), '需要刷新'); assert.match(panelText(app), /Ctrl\+F5/);
  } finally { app.cleanup(); }
});

test('新前端遇到舊後端缺身份時不得聲稱已驗證最新', async () => {
  const app = await createAppWindow();
  try { showVersionPanel(app, { identity: null, update: { state: 'current' } }); assert.equal(tileBadge(app), '身份未確認'); assert.match(panelText(app), /舊版後端未提供/); assert.doesNotMatch(panelText(app), /已是 GitHub 上的最新版本/); } finally { app.cleanup(); }
});

test('精確來源說明預設收合，重繪仍保留使用者展開狀態', async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: 'current' } });
    const details = app.doc.querySelector('.version-details'); assert.ok(details); assert.equal(details.open, false);
    assert.match(details.textContent, /server.mjs/);
    details.open = true; app.evalIn('renderMorePanel()');
    assert.equal(app.doc.querySelector('.version-details').open, true);
  } finally { app.cleanup(); }
});

test("已是最新才可以說最新", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: "current", behindBy: 0, localAhead: 0 } });
    assert.match(panelText(app), /已是 GitHub 上的最新版本/);
    assert.equal(tileBadge(app), "最新");
  } finally {
    app.cleanup();
  }
});

test("查不到上游時必須說「無法確認」，不得退回「最新」", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: "unavailable", reason: "無法連線 GitHub" } });
    const text = panelText(app);
    assert.match(text, /無法跟 GitHub 對版/);
    assert.match(text, /無法連線 GitHub/, "要說出原因，不要只給一個含糊的失敗");
    assert.doesNotMatch(text, /已是.*最新版本/, "不知道就不可以說是最新");
    assert.equal(tileBadge(app), "無法確認");
    assert.match(text, /不影響任何看盤功能/, "要講清楚這不是行情故障");
  } finally {
    app.cleanup();
  }
});

test("還沒查詢時不得預設任何結論", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { loaded: false, update: null });
    const text = panelText(app);
    assert.doesNotMatch(text, /已是.*最新版本/);
    assert.doesNotMatch(text, /落後/);
    assert.equal(tileBadge(app), "查看");
  } finally {
    app.cleanup();
  }
});

test("本機有沒推上去的 commit 不算「有新版」", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: "ahead", behindBy: 0, localAhead: 2 } });
    const text = panelText(app);
    assert.match(text, /2 個 commit 還沒推上 GitHub/);
    assert.match(text, /git push/);
    assert.doesNotMatch(text, /落後/);
    assert.equal(tileBadge(app), "本機較新");
  } finally {
    app.cleanup();
  }
});

test("分岔要同時講出兩個方向", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: "diverged", behindBy: 4, localAhead: 1 } });
    const text = panelText(app);
    assert.match(text, /上游有 4 個新 commit/);
    assert.match(text, /本機有 1 個沒推上去/);
    assert.equal(tileBadge(app), "已分岔");
  } finally {
    app.cleanup();
  }
});

test("讀不到本機 commit 就顯示「無法辨識」，不編一個假版本", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, {
      build: { available: false, commit: "", branch: "", repo: "" },
      update: { state: "unavailable", reason: "沒有 GitHub origin" },
    });
    const text = panelText(app);
    assert.match(text, /無法辨識/);
    assert.match(text, /沒有 GitHub origin/);
  } finally {
    app.cleanup();
  }
});

test("伺服器回來的字串一律跳脫（reason 與 repo 都來自本機以外的內容）", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, {
      build: { available: true, commit: "55d5bed", branch: "main", repo: `<img src=x onerror="window.__versionXss=1">` },
      update: { state: "unavailable", reason: `<img src=y onerror="window.__versionXss=2">` },
    });
    await app.settle(2);
    assert.equal(app.evalIn("window.__versionXss"), undefined, "不得生成帶事件屬性的元素");
    const detail = app.doc.getElementById("moreDetail");
    assert.equal(detail.querySelectorAll("img").length, 0);
    assert.match(detail.textContent, /onerror/, "原文應以純文字顯示出來");
  } finally {
    app.cleanup();
  }
});

test("重新檢查按鈕會呼叫 loadAppVersion，且查詢中不可重複觸發", async () => {
  const app = await createAppWindow();
  try {
    showVersionPanel(app, { update: { state: "current", behindBy: 0, localAhead: 0 } });
    app.evalIn(`
      window.__versionLoadCalls = 0;
      window.__originalLoadAppVersion = loadAppVersion;
      loadAppVersion = (...args) => { window.__versionLoadCalls += 1; return Promise.resolve(); };
    `);
    const button = app.doc.querySelector('[data-action="refresh-app-version"]');
    assert.ok(button, "面板要有重新檢查按鈕");
    button.focus();
    button.click();
    await app.settle(2);
    assert.equal(app.evalIn("window.__versionLoadCalls"), 1);

    showVersionPanel(app, { loading: true, update: { state: "current", behindBy: 0, localAhead: 0 } });
    const busy = app.doc.querySelector('[data-action="refresh-app-version"]');
    assert.equal(busy.disabled, true, "查詢中要 disable，避免連按洪水");
    assert.match(busy.textContent, /查詢中/);
  } finally {
    app.cleanup();
  }
});
