// 兩條「壞掉時沒有徵兆」的缺陷，來自 2026-07-27 的多維度體檢。
//
// P5 parseCookies：裸 `%` 會讓 decodeURIComponent 丟 URIError。這個函式被 getAuthContext
//    在**每一支 API 之前**呼叫，所以一顆解不開的 cookie 會讓整個 /api/* 回 500。
//    而 cookie 綁 host 不綁 port——同機任何其他 localhost 專案寫過一次就會波及。
//
// P4 除權息歸檔上限：TWT48U_ALL 是滾動未來窗，除息日一過就查不到，被淘汰＝永久消失。
//    12 筆對月配息 ETF（一年 12 筆）只夠一年，而消費端要的窗是 13 個月到 5 年。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

// ---- P5 ----

test("解不開的 cookie 只跳過那一筆，不得讓整個請求爆掉", () => {
  // 「100%」是真實會出現的值（折扣、進度、任何百分比）。裸 % 後面不是兩個十六進位字元。
  const cookies = mod.parseCookies("sid=abc123; promo=100%; theme=dark");
  assert.equal(cookies.sid, "abc123", "壞掉那顆不該拖累同一個 header 裡的其他 cookie");
  assert.equal(cookies.theme, "dark", "壞掉那顆之後的 cookie 也要照常解析");
  assert.equal("promo" in cookies, false, "解不開的等同沒有這個 cookie");
});

test("整串都解不開時回空物件，而不是丟例外", () => {
  assert.doesNotThrow(() => mod.parseCookies("a=%; b=%zz; c=%E0%A4%A"));
  assert.deepEqual(mod.parseCookies("a=%; b=%zz"), {});
});

test("key 解不開也要擋住（不是只有 value 會壞）", () => {
  const cookies = mod.parseCookies("%=x; sid=ok");
  assert.equal(cookies.sid, "ok");
});

test("正常的百分比編碼仍要正確解出來（防線不可過度收緊）", () => {
  const cookies = mod.parseCookies("name=%E5%8F%B0%E7%A9%8D%E9%9B%BB; sid=abc");
  assert.equal(cookies.name, "台積電", "合法的 UTF-8 編碼不可被誤擋");
  assert.equal(cookies.sid, "abc");
});

// ---- P4 ----

test("除權息歸檔上限要與官方計算結果表對齊，月配息 ETF 兩年才夠", () => {
  assert.equal(mod.DIVIDEND_HISTORY_MAX_EVENTS_PER_CODE, 40);
  // 月配息 ETF 一年 12 筆；消費端（corporateActionHistoryForCode）要的窗是 13 個月到 5 年。
  assert.ok(mod.DIVIDEND_HISTORY_MAX_EVENTS_PER_CODE >= 24,
    "12 筆只夠一年，而 TWT48U_ALL 是滾動窗、被淘汰就永久拿不回來");
});

test("超過上限時淘汰最舊的，保留最新的 40 筆", async () => {
  // 造 45 個月的月配息事件（0056 這類）。
  const events = [];
  for (let i = 0; i < 45; i += 1) {
    const year = 2023 + Math.floor(i / 12);
    const month = String((i % 12) + 1).padStart(2, "0");
    events.push({
      exDate: `${year}${month}15`, kind: "除息", cashDividend: 0.1,
      stockRatio: null, subscriptionRatio: null, subscriptionPrice: null, source: "TWSE",
    });
  }
  await mod.appendDividendHistory(new Map([["0056", events]]), { successfulSources: ["TWSE"] });
  const kept = mod.corporateActionHistoryForCode("0056");
  assert.equal(kept.length, 40, "保留 40 筆");
  // 淘汰的是最舊的：45 筆從 202301 起，留下的第一筆應該是第 6 個月。
  assert.equal(kept[0].exDate, "20230615", `最舊的要先被淘汰（實際 ${kept[0].exDate}）`);
  assert.equal(kept.at(-1).exDate, "20260915", "最新的必須留著");
});
