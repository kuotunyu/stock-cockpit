// D-44：上市注意股端點在沒有當日公布時，回的**不是空陣列，而是一列所有欄位都空白的哨兵**。
//
// 2026-07-26 實測 `openapi.twse.com.tw/v1/announcement/notice`：
//   [{"Number":"0","Code":"","Name":"","NumberOfAnnouncement":"0","TradingInfoForAttention":"","Date":"","ClosingPrice":"0","PE":"0"}]
// 舊寫法用 /^\d{4}$/ 過濾代號，哨兵被靜默濾掉 → 變成「今天沒有任何上市注意股」這個**事實陳述**。
//
// 這不是假想問題。本機 45 天快照裡 11 個日子共 299 筆注意股：**上市 0 筆、上櫃 299 筆**
// （兩份官方 4 碼清單零重疊，分類可靠）。上市 1,092 檔／上櫃 889 檔，連續 11 天上市掛零
// 而上櫃每天 16~39 檔，機率上不可能——同期 `/announcement/notetrans` 還回著
// 「115年7月23日至115年7月24日連續二次」，證明上市那兩天確實公布過注意資訊。
// 官方對這支端點的說明就是「集中市場**當日**公布注意股票」，當日之外會清空。
//
// 同一類陷阱這個專案已經記錄過三次（逐月歷史的 X0.00、MIS 的 0.0000、整批收盤的
// Change:"0.0000"）：上游用「看得像資料的東西」表達「沒有資料」。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { surveillanceRoutes, stockDayAllRow, tpexDailyCloseRow } from "../helpers/fixtures.mjs";

// 官方哨兵列的真實形狀（欄位順序與值原樣抄下）
const SENTINEL = {
  Number: "0", Code: "", Name: "", NumberOfAnnouncement: "0",
  TradingInfoForAttention: "", Date: "", ClosingPrice: "0", PE: "0",
};
const REAL = {
  Number: "1", Code: "2330", Name: "台積電", NumberOfAnnouncement: "2",
  TradingInfoForAttention: "當日週轉率達 10.03%(第六款)", Date: "1150724",
  ClosingPrice: "1180.00", PE: "31.20",
};

const { mod, mock, dataDir } = await importServer({
  routes: [
    ...surveillanceRoutes({
      reference: [stockDayAllRow({ code: "2330", name: "台積電", close: 1180 })],
      tpexReference: [tpexDailyCloseRow({ code: "5536", name: "聖暉", close: 300 })],
      twseNotice: [SENTINEL],   // 就是實機那一列
      tpexWarning: [{ Date: "1150724", SecuritiesCompanyCode: "5536", CompanyName: "聖暉", TradingInformation: "當日週轉率達 11.96%(第六款)", ClosePrice: "300.00", PriceEarningRatio: "40.00" }],
    }),
  ],
});
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test("全空白的哨兵列不是「零檔注意股」", () => {
  assert.equal(mod.twseNoticeRowsOrNull([SENTINEL]), null, "回 null＝拿不到，讓呼叫端走 last-good＋警告");
  assert.equal(mod.twseNoticeRowsOrNull([SENTINEL, { ...SENTINEL, Number: "1" }]), null, "多列全空也一樣");
});

test("真正的空陣列要被尊重（RWD 版就是這樣回）", () => {
  const empty = mod.twseNoticeRowsOrNull([]);
  assert.ok(Array.isArray(empty) && empty.length === 0, "零列＝官方明確表示今天沒有，不可當成故障");
});

test("有內容時原樣回傳，不得產生假警告", () => {
  const rows = mod.twseNoticeRowsOrNull([REAL]);
  assert.ok(Array.isArray(rows) && rows.length === 1, "正常資料不可被擋");
  assert.equal(rows[0].Code, "2330");
  // 天天亮的警告等於沒有警告——這條是防止修法過當的反向守衛。
  const mixed = mod.twseNoticeRowsOrNull([SENTINEL, REAL]);
  assert.ok(Array.isArray(mixed) && mixed.length === 1, "混雜時保留有代號的那些");
  assert.equal(mixed[0].Code, "2330");
});

test("非陣列（上游改版或錯誤頁）視為拿不到", () => {
  assert.equal(mod.twseNoticeRowsOrNull(null), null);
  assert.equal(mod.twseNoticeRowsOrNull({ stat: "很抱歉" }), null);
  assert.equal(mod.twseNoticeRowsOrNull("<!DOCTYPE html>"), null);
});

test("端點回哨兵時，getRiskSets 要亮警告而不是靜默少一個市場", async () => {
  const risk = await mod.getRiskSets();
  const text = (risk.warnings || []).join(" ");
  assert.match(text, /TWSE 注意股/, `要點名是哪個來源：${text}`);
  // 不可憑空增減資料：上櫃那一邊照常標示
  assert.equal(risk.surveillance.get("5536")?.kind, "attention", "上櫃注意股不受影響");
  assert.equal(risk.surveillance.has("2330"), false, "沒有名單就不該無中生有");
});

test("注意股的 Date 是公布日、不是期間——所以不給它加日期窗是對的", async () => {
  // D-44 原記錄說「沒有期間欄位」不精確：官方**有** Date 欄位，只是語意是公布日。
  // 對照組：處置股給的是 DispositionPeriod "1150727~1150807"（真正的期間）。
  const board = await mod.getSurveillanceBoard();
  const attention = [...(board.attention || []), ...(board.notice || [])];
  const row = attention.find((item) => item.code === "5536");
  assert.ok(row, `上櫃注意股要出現在看板（實際 ${JSON.stringify(attention.map((r) => r.code))}）`);
  assert.equal(row.noticeDate, "20260724", "公布日要保留下來，否則分不出名單是今天的還是沿用的");
  assert.equal(row.period ?? null, null, "注意股沒有期間，不該長出一個");

  // 看板走的是另一條 fetcher（survFetchRecords），哨兵在這裡也必須變成警告而不是零列。
  // 兩條路徑都要守：只釘 getRiskSets 的話，看板那邊靜默回空不會被抓到。
  const boardText = (board.warnings || []).join(" ");
  assert.match(boardText, /TWSE 注意/, `看板也要點名抓不到的來源：${boardText}`);
  assert.equal(attention.some((item) => item.market === "TWSE"), false, "拿不到就不該無中生有");
});
