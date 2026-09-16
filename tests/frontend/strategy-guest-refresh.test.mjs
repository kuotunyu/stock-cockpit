// 2026-09-16 使用者回報：在策略雷達按「重新整理」會跳出登入畫面。根因：重新整理帶 refresh=1（強制重掃），
// 伺服器要登入，訪客拿到 401 → handleAuthRequired 開登入閘。訪客的重新整理只重新載入榜單、不帶 refresh=1；登入後才強制重掃。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

const stub = `
  window.__swingCalls = [];
  window.__origFetchApi = fetchApi;
  fetchApi = async (path) => {
    if (String(path).startsWith("/api/swing")) {
      window.__swingCalls.push(String(path));
      if (String(path).includes("refresh=1") && !authState.user) throw Object.assign(new Error("需要先登入"), { status: 401, code: "AUTH_REQUIRED" });
      return { ok: true, asOf: "2026-09-16", picks: [], scenarios: [], candidateCount: 0, matchedCount: 0 };
    }
    return { ok: true };
  };
  window.__toasts = [];
  window.__origShowToast = showToast;
  showToast = (text) => { window.__toasts.push(text); };
  loadMarketBreadth = async () => {};
`;
const restore = `fetchApi = window.__origFetchApi; showToast = window.__origShowToast;`;

test("訪客按重新整理：不帶 refresh=1、不跳登入畫面、榜單照載", async () => {
  await app.evalIn(`(async () => { ${stub}
    authState.user = null; authState.error = ""; strategyState.scenario = "midBandDefense";
    try { await loadStrategyBoard({ notify: true, refresh: true }); } finally { ${restore} }
  })()`);
  const result = json(`({ calls: window.__swingCalls, toasts: window.__toasts, error: authState.error, loaded: strategyState.loaded,
    gateOpen: Boolean(el.loginGate) && !el.loginGate.hidden && el.loginGate.classList.contains("is-open") })`);
  assert.equal(result.calls.length, 1);
  assert.doesNotMatch(result.calls[0], /refresh=1/, "訪客不帶 refresh=1");
  assert.equal(result.loaded, true);
  assert.equal(result.error, "", "不能因為重新整理設 authState.error");
  assert.equal(result.gateOpen, false, "不跳登入畫面");
  assert.ok(result.toasts.some((t) => /重新掃描要登入/.test(t)), `toast 要講清楚沒重掃：${result.toasts.join(" | ")}`);
});

test("登入後按重新整理：帶 refresh=1 強制重掃，toast 是「已更新」", async () => {
  await app.evalIn(`(async () => { ${stub}
    authState.user = { id: "u1", username: "u1", displayName: "u1", role: "user" }; strategyState.scenario = "midBandDefense";
    try { await loadStrategyBoard({ notify: true, refresh: true }); } finally { ${restore} authState.user = null; }
  })()`);
  const result = json(`({ calls: window.__swingCalls, toasts: window.__toasts })`);
  assert.match(result.calls[0], /refresh=1/);
  assert.ok(result.toasts.includes("策略雷達已更新"));
});

test("一般載入（沒按重新整理）不論登入與否都不帶 refresh=1", async () => {
  await app.evalIn(`(async () => { ${stub}
    authState.user = null; strategyState.scenario = "strongContinuation";
    try { await loadStrategyBoard(); } finally { ${restore} }
  })()`);
  assert.doesNotMatch(json(`window.__swingCalls[0]`), /refresh=1/);
});
