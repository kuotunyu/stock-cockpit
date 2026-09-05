// PWA 登入到期：iOS 加到主畫面、兩週後再開，/api/auth/me 401 → 以前畫面靜靜變成未登入模式
//（庫存變「需要登入」、提醒不再同步），沒有任何地方說「到期」。曾經登入過（本機旗標）就要講出來並開登入閘；
// 從沒登入過的 401 維持安靜（朋友第一次開頁不該被登入卡擋住）。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppWindow } from "../helpers/dom-harness.mjs";

let app;
before(async () => {
  app = await createAppWindow();
});
after(() => app.cleanup());

test("登入成功寫旗標、登出清旗標", async () => {
  const result = JSON.parse(await app.evalIn(`(async () => {
    const orig = fetchApi;
    fetchApi = async () => ({ ok: true });
    localStorage.removeItem("stock1.hadSession.v1");
    activateAuthenticatedUser({ id: "u1", username: "me", role: "user" });
    const afterLogin = localStorage.getItem("stock1.hadSession.v1");
    await logout();
    const afterLogout = localStorage.getItem("stock1.hadSession.v1");
    fetchApi = orig;
    return JSON.stringify({ afterLogin, afterLogout });
  })()`));
  assert.deepEqual(result, { afterLogin: "1", afterLogout: null });
});

test("旗標在＋/me 401 → 訊息講「登入已到期」、開登入閘、toast 說明同步暫停；旗標不在的 401 不開閘", async () => {
  const result = JSON.parse(await app.evalIn(`(async () => {
    const orig = fetchApi;
    fetchApi = async () => { throw Object.assign(new Error("需要先登入"), { status: 401 }); };
    const gate = document.getElementById("loginGate");
    localStorage.setItem("stock1.hadSession.v1", "1");
    document.getElementById("toastStack").replaceChildren();
    const ok = await loadCurrentUser();
    const expired = {
      ok, gateOpen: !gate.hidden,
      message: document.getElementById("loginMessage").textContent,
      toast: document.getElementById("toastStack").textContent,
      flag: localStorage.getItem("stock1.hadSession.v1"),
    };
    closeDialogLayer(gate);
    localStorage.removeItem("stock1.hadSession.v1");
    document.getElementById("toastStack").replaceChildren();
    const quietOk = await loadCurrentUser();
    const quiet = { ok: quietOk, gateOpen: !gate.hidden, toast: document.getElementById("toastStack").textContent };
    fetchApi = orig;
    return JSON.stringify({ expired, quiet });
  })()`));
  assert.equal(result.expired.ok, false);
  assert.equal(result.expired.gateOpen, true, "曾登入過的人要看到登入閘，不是靜靜變成未登入模式");
  assert.match(result.expired.message, /登入已到期/);
  assert.match(result.expired.toast, /暫停同步/);
  assert.equal(result.expired.flag, null, "講過一次就清掉旗標，重整不重複吵");
  assert.deepEqual(result.quiet, { ok: false, gateOpen: false, toast: "" }, "從沒登入過的 401 維持安靜");
});
