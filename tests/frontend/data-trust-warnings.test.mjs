// D-06：後端 /api/quotes 回的資料降級警告（兩市場收盤日未對齊、沿用 last-good…）
// 以前 dataState 連 warnings 欄位都沒有，主報價畫面完全不顯示，使用者不知道自己在看舊價。
// 同一批 warnings 在隔日沖摘要與策略雷達有渲染，所以這是漏接不是產品決定。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const json = (expr) => JSON.parse(app.evalIn(`JSON.stringify(${expr})`));

test('行情正常與風險公告缺漏分開命名，不互相掩蓋',()=>{
  app.evalIn(`dataState.error='';marketState.error='';sourceState.error='';dataState.warnings=[];dataState.degraded=false;dataState.fallbackCount=0;
    state.screen='overnight';overnightState.warnings=['TWSE 注意股抓取失敗'];overnightState.groups={};overnightState.loaded=true;overnightState.loading=false;overnightState.error='';state.overnightView='overview';renderOvernightGroups();`);
  const host=app.doc.createElement('div');host.innerHTML=app.evalIn('renderDataTrustCompact()');
  assert.match(host.textContent,/行情來源狀態.*本批行情可用/s);
  assert.match(app.doc.querySelector('#overnightGroups').textContent,/注意／處置標記部分缺漏.*查無標記不代表沒有風險/s);
  app.evalIn(`overnightState.warnings=[];dataState.warnings=['收盤資料沿用 last-good'];dataState.degraded=true;renderOvernightGroups();`);
  host.innerHTML=app.evalIn('renderDataTrustCompact()');
  assert.match(host.textContent,/資料降級/);
  assert.doesNotMatch(app.doc.querySelector('#overnightGroups').textContent,/標記部分缺漏/);
  app.evalIn(`dataState.warnings=[];dataState.degraded=false;`);
});

test("dataState 具備 warnings／degraded 欄位（與其他 state 一致）", () => {
  const shape = json(`({
    hasWarnings: Array.isArray(dataState.warnings),
    hasDegraded: typeof dataState.degraded === "boolean",
  })`);
  assert.equal(shape.hasWarnings, true);
  assert.equal(shape.hasDegraded, true);
});

test("有降級警告時，資料可信度不得顯示「資料正常」，且警告要出現在畫面上", () => {
  const result = json(`(() => {
    const prev = {
      warnings: dataState.warnings, degraded: dataState.degraded,
      error: dataState.error, fallbackCount: dataState.fallbackCount,
      marketError: marketState.error, sourceError: sourceState.error,
    };
    // harness 沒路由 /api/markets，marketState.error 會讓 tone 恆為 warn——那是測試環境噪音，
    // 這裡要驗的是 warnings/degraded 對 tone 的影響，先把其他來源清乾淨。
    marketState.error = "";
    sourceState.error = "";
    dataState.error = "";
    dataState.fallbackCount = 0;
    dataState.degraded = true;
    dataState.warnings = ["上市與上櫃整批收盤資料日尚未對齊（上市 07/25、上櫃 07/24）"];
    const tone = getDataTrustTone();
    const host = document.createElement("div");
    host.innerHTML = renderDataTrustCompact();
    const text = host.textContent;
    marketState.error = prev.marketError; sourceState.error = prev.sourceError;
    Object.assign(dataState, prev);
    return { tone, text, injected: host.querySelectorAll("img, script, [onerror]").length };
  })()`);
  assert.notEqual(result.tone, "good", "後端已明說降級，不能還顯示資料正常");
  assert.ok(result.text.includes("尚未對齊"), `警告要顯示出來，實際：${result.text}`);
  assert.equal(result.injected, 0, "警告字串來自伺服器，必須跳脫");
});

test("沒有警告時維持原本判定，不得無故變成部分備援", () => {
  const tone = app.evalIn(`(() => {
    const prev = {
      warnings: dataState.warnings, degraded: dataState.degraded,
      error: dataState.error, fallbackCount: dataState.fallbackCount,
      marketError: marketState.error, sourceError: sourceState.error,
    };
    // harness 沒路由 /api/markets，marketState.error 會讓 tone 恆為 warn——那是測試環境噪音，
    // 這裡要驗的是 warnings/degraded 對 tone 的影響，先把其他來源清乾淨。
    marketState.error = "";
    sourceState.error = "";
    dataState.error = "";
    dataState.fallbackCount = 0;
    dataState.degraded = false;
    dataState.warnings = [];
    const result = getDataTrustTone();
    marketState.error = prev.marketError; sourceState.error = prev.sourceError;
    Object.assign(dataState, prev);
    return result;
  })()`);
  assert.equal(tone, "good");
});

test("警告過多時只列前兩則，其餘收進 title 不洗版", () => {
  const result = json(`(() => {
    const prev = { warnings: dataState.warnings, degraded: dataState.degraded, error: dataState.error };
    dataState.error = "";
    dataState.degraded = true;
    dataState.warnings = ["警告一", "警告二", "警告三", "警告四"];
    const host = document.createElement("div");
    host.innerHTML = renderDataTrustCompact();
    const node = host.querySelector(".data-trust-warning");
    const out = { text: node ? node.textContent : "", title: node ? node.getAttribute("title") : "" };
    Object.assign(dataState, prev);
    return out;
  })()`);
  assert.ok(result.text.includes("警告一") && result.text.includes("警告二"));
  assert.ok(result.text.includes("另有 2 則"), `實際：${result.text}`);
  assert.ok(result.title.includes("警告四"), "完整內容要留在 title");
});
