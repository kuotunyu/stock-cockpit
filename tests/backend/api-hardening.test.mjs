// 低嚴重度硬化：共享資料 code 格式、displayName 上限、備註不外洩 userId、swing 重掃拒絕跨站導覽、
// JSON 回應不帶沒有 ACAO 的 CORS 標頭。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { bootServer } from "../helpers/test-server.mjs";

let srv;
before(async () => {
  srv = await bootServer({ routes: [] });
});
after(async () => {
  await srv.close();
});

test("備註與公司簡介：code 必須是 4～6 碼英數，否則 400", async () => {
  // cleanCode 會先去掉非英數（"23-30" → "2330" 是既有的正規化，不在這裡擋）；擋的是清完仍不合格式的。
  for (const code of ["AB", "A".repeat(200), "23-3"]) {
    const notes = await srv.api("/api/notes", { method: "POST", body: JSON.stringify({ code, text: "x" }) });
    assert.equal(notes.status, 400, `notes ${code}`);
    await notes.text();
    const company = await srv.api("/api/company", { method: "PUT", body: JSON.stringify({ code, summary: "x" }) });
    assert.equal(company.status, 400, `company ${code}`);
    await company.text();
  }
  const db = await srv.mod.loadDb();
  assert.equal(Object.keys(db.stockNotes || {}).length, 0, "不得留下任何鍵");
  assert.equal(Object.keys(db.companyProfiles || {}).length, 0);
});

test("備註回應不含 userId，改以 mine 表達「這是我的」", async () => {
  const created = await srv.api("/api/notes", { method: "POST", body: JSON.stringify({ code: "2330", text: "hello" }) });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.notes[0].userId, undefined);
  assert.equal(body.notes[0].mine, true);
  assert.ok(body.notes[0].userName, "顯示名要保留");

  const mine = await (await srv.api("/api/notes?code=2330")).json();
  assert.equal(mine.notes[0].mine, true);
  const anon = await (await srv.raw("/api/notes?code=2330")).json();
  assert.equal(anon.notes[0].userId, undefined);
  assert.equal(anon.notes[0].mine, false);
  const recent = await (await srv.raw("/api/notes/recent")).json();
  assert.ok(recent.notes.length >= 1);
  assert.ok(recent.notes.every((note) => note.userId === undefined));

  const removed = await srv.api(`/api/notes?code=2330&id=${body.notes[0].id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.ok((removedBody.notes || []).every((note) => note.userId === undefined));
});

test("admin 建帳：displayName 截到 64 字", async () => {
  const res = await srv.api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ username: "longname", password: "password123", displayName: "名".repeat(200) }),
  });
  assert.ok([200, 201].includes(res.status), `建帳應成功，實際 ${res.status}`);
  await res.text();
  const users = (await (await srv.api("/api/admin/users")).json()).users;
  assert.equal(users.find((u) => u.username === "longname").displayName.length, 64);
});

// Sec-Fetch-* 是 fetch 的禁用請求標頭（undici 會剝掉），要模擬瀏覽器的導覽請求得用 node:http 直接發。
function rawWithHeaders(path, headers) {
  const url = new URL(srv.baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: url.hostname,
      port: url.port,
      path,
      method: "GET",
      headers: { host: `${url.hostname}:${url.port}`, cookie: srv.cookie, ...headers },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("swing?refresh=1 由跨站導覽觸發 → 403 且不重算", async () => {
  const nav = await rawWithHeaders("/api/swing?refresh=1", { "sec-fetch-mode": "navigate", "sec-fetch-site": "none" });
  assert.equal(nav.status, 403, nav.text);
  assert.equal(JSON.parse(nav.text).code, "SWING_REFRESH_FORBIDDEN");
  const cross = await rawWithHeaders("/api/swing?refresh=1", { "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site" });
  assert.equal(cross.status, 403, cross.text);
});

test("JSON 回應不再帶沒有 ACAO 的 CORS 標頭", async () => {
  const res = await srv.raw("/api/health");
  assert.equal(res.headers.get("access-control-allow-methods"), null);
  assert.equal(res.headers.get("access-control-allow-headers"), null);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  await res.text();
});
