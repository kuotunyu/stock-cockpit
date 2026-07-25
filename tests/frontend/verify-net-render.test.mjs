// D-20 前端：驗證／回測面板的百分比要「毛值照舊、旁邊並陳淨值」。
// 毛值不動是刻意的——既有的視覺習慣與歷史快照都建立在它上面；淨值用較低調的樣式跟在後面，
// 讓使用者看得到「還有一個扣掉成本的數字」，但不搶走原本的閱讀焦點。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

const probe = (expr) => JSON.parse(app.evalIn(`JSON.stringify((() => {
  const host = document.createElement("div");
  host.innerHTML = ${expr};
  return { text: host.textContent, html: host.innerHTML, netNodes: host.querySelectorAll(".verify-net").length };
})())`));

test("有淨值時毛淨並陳，毛值維持在前", () => {
  const result = probe("formatGrossWithNet(0.35, -0.12)");
  assert.equal(result.netNodes, 1, "淨值要有自己的元素才能套低調樣式");
  assert.match(result.text, /0\.35/, "毛值必須保留");
  assert.match(result.text, /0\.12/, "淨值要顯示出來");
  assert.match(result.text, /淨/, "要標明哪個是淨值");
  assert.ok(result.text.indexOf("0.35") < result.text.indexOf("0.12"), "毛值在前、淨值在後");
});

test("淨值缺值時只顯示毛值，不得留下空的「淨」字", () => {
  for (const missing of ["null", "undefined", "NaN", '"abc"']) {
    const result = probe(`formatGrossWithNet(1.2, ${missing})`);
    assert.equal(result.netNodes, 0, `${missing} 不該產生淨值節點`);
    assert.doesNotMatch(result.text, /淨/, `${missing} 不該留下「淨」字`);
    assert.match(result.text, /1\.2/);
  }
});

test("毛值本身缺值時仍照既有格式退回 --", () => {
  const result = probe("formatGrossWithNet(null, null)");
  assert.match(result.text, /--/, "沿用 formatSignedPercent 的缺值表示");
  assert.equal(result.netNodes, 0);
});

test("淨值標題要說明扣了什麼，避免使用者誤以為是另一種報酬", () => {
  const title = app.evalIn(`(() => {
    const host = document.createElement("div");
    host.innerHTML = formatGrossWithNet(2, 1.53);
    return host.querySelector(".verify-net").getAttribute("title");
  })()`);
  assert.match(title, /手續費/);
  assert.match(title, /證交稅/);
});
