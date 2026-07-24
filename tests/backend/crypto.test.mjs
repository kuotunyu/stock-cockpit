// 密碼雜湊／token／cookie／AES-GCM 加解密。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

process.env.DATA_DIR = "ambient-data-dir-must-not-be-reused";
process.env.DB_PATH = "ambient-db-path-must-not-be-reused.json";
process.env.ADMIN_USERNAME = "ambient-admin-must-not-be-reused";
process.env.SESSION_MAX_AGE_MS = "1";
process.env.COOKIE_SECURE = "true";
process.env.PORT = "5174";
const { mod, dataDir } = await importServer();
assert.equal(process.env.DATA_DIR, dataDir);
assert.notEqual(dataDir, "ambient-data-dir-must-not-be-reused");
assert.equal(process.env.DB_PATH, undefined);
assert.equal(process.env.ADMIN_USERNAME, "admin");
assert.equal(process.env.SESSION_MAX_AGE_MS, undefined);
assert.equal(process.env.COOKIE_SECURE, undefined);
assert.equal(process.env.PORT, "0");
const { hashPassword, verifyPassword, hashToken, parseCookies, encryptJson, decryptJson } = mod;

// pbkdf2 210k 次很貴（~100ms/次）：整檔只算兩次 hash。
let hashA;
let hashB;
before(() => {
  hashA = hashPassword("correct-horse");
  hashB = hashPassword("correct-horse");
});

test("hashPassword→verifyPassword 往返", () => {
  assert.equal(verifyPassword("correct-horse", hashA), true);
  assert.equal(verifyPassword("wrong-horse", hashA), false);
});

test("同密碼兩次 hash 不同（隨機鹽），但都可驗證", () => {
  assert.notEqual(hashA, hashB);
  assert.equal(verifyPassword("correct-horse", hashB), true);
});

test("verifyPassword：格式不對的 storedHash 不炸、回 false", () => {
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", ""), false);
});

test("hashToken 決定性", () => {
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
});

test("parseCookies", () => {
  assert.deepEqual(parseCookies("sid=abc; foo=bar"), { sid: "abc", foo: "bar" });
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies("noequal"), {}); // 沒有 = 的片段忽略
  assert.deepEqual(parseCookies("a=1;;b=2"), { a: "1", b: "2" });
  assert.deepEqual(parseCookies("k=v%3Dx"), { k: "v=x" }); // decodeURIComponent
});

test("encryptJson→decryptJson 往返；IV 隨機（同 payload 兩次密文不同）", () => {
  const secret = { user: "admin", certPassword: "p@ss", nested: { a: 1 } };
  const enc1 = encryptJson(secret);
  const enc2 = encryptJson(secret);
  assert.equal(enc1.version, "aes-256-gcm-v1");
  assert.notEqual(enc1.data, enc2.data);
  assert.deepEqual(decryptJson(enc1), secret);
  assert.deepEqual(decryptJson(enc2), secret);
});

test("decryptJson：缺欄位 → null；密文被竄改 → 丟例外（GCM 驗證失敗）", () => {
  assert.equal(decryptJson(null), null);
  assert.equal(decryptJson({}), null);
  assert.equal(decryptJson({ iv: "x", tag: "y" }), null); // 缺 data
  const enc = encryptJson({ ok: true });
  const tampered = { ...enc, data: Buffer.from("tampered-bytes").toString("base64") };
  assert.throws(() => decryptJson(tampered)); // 特徵化：呼叫端（讀 broker 設定）自行 try/catch
});
