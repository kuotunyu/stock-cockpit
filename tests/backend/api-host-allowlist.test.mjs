// Host 白名單：DNS rebinding 的攻擊頁會帶著別的 Host 打進 127.0.0.1，必須 421（Misdirected Request）。
// fetch（undici）不允許自訂 Host header，所以用 node:http 直接發。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { bootServer } from "../helpers/test-server.mjs";

process.env.ALLOWED_HOSTS = "phone.local, tablet.lan:5174";
let srv;
before(async () => {
  srv = await bootServer({ routes: [] });
});
after(async () => {
  await srv.close();
  delete process.env.ALLOWED_HOSTS;
});

function rawRequest(path, { host, method = "GET", body = "", headers = {} } = {}) {
  const url = new URL(srv.baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: url.hostname,
      port: url.port,
      path,
      method,
      headers: { ...(host === undefined ? {} : { host }), ...headers },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("陌生 Host：唯讀 API、health、靜態首頁都 421，且不得發 cookie", async () => {
  for (const path of ["/api/notes/recent", "/api/health", "/"]) {
    const res = await rawRequest(path, { host: "evil.tld:5174" });
    assert.equal(res.status, 421, `${path} 應 421`);
    assert.ok(res.text.includes("HOST_NOT_ALLOWED"), `${path} 要帶 code`);
  }
  const login = await rawRequest("/api/auth/login", {
    host: "evil.tld:5174",
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://evil.tld:5174" },
    body: JSON.stringify({ username: "admin", password: "test-admin-pw" }),
  });
  assert.equal(login.status, 421);
  assert.ok(!login.headers["set-cookie"], "421 不得發 cookie");
});

test("缺 Host header 也 421", async () => {
  // node:http 遇到空的 host 會自動補回預設值，所以改用 raw socket 送一個沒有 Host 的 HTTP/1.1 請求。
  const url = new URL(srv.baseUrl);
  const statusLine = await new Promise((resolve, reject) => {
    const socket = netConnect({ host: url.hostname, port: Number(url.port) }, () => {
      socket.write("GET /api/health HTTP/1.1\r\nConnection: close\r\n\r\n");
    });
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { text += chunk; });
    socket.on("end", () => resolve(text.split("\r\n")[0]));
    socket.on("error", reject);
  });
  // Node 的 http.Server 預設 requireHostHeader=true，HTTP/1.1 沒帶 Host 會在進 handler 之前就被 400 掉；
  // 兩種結果都是 fail-closed，這裡釘的是「絕不能 200」。
  assert.match(statusLine, /^HTTP\/1\.1 (421|400)/, statusLine);
});

test("loopback 與 ALLOWED_HOSTS 放行（port 不比對、大小寫不敏感）", async () => {
  const url = new URL(srv.baseUrl);
  const hosts = [
    `127.0.0.1:${url.port}`,
    `localhost:${url.port}`,
    "localhost",
    "[::1]:9999",
    "phone.local",
    "PHONE.LOCAL:5180",
    "tablet.lan:9",
  ];
  for (const host of hosts) {
    const res = await rawRequest("/api/health", { host });
    assert.equal(res.status, 200, `${host} 應放行`);
  }
});

test("OPTIONS 也要先過 Host 白名單", async () => {
  const res = await rawRequest("/api/health", { host: "evil.tld", method: "OPTIONS" });
  assert.equal(res.status, 421);
});
