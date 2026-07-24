// 停牌/下市過濾（Phase 0 正確性修正）：
// getRiskSets 的 halted/delisted 名單、日期窗判斷、選股引擎前置過濾。
// 資料靜態、全檔共用一次 importServer；各情境用不同代號區隔（riskSourceMemory 行程內 1 小時內不重抓）。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import {
  compactToday, surveillanceRoutes,
  twtawuRow, tpexSpendiRow, suspendListingRow, tpexCmodeRow,
} from "../helpers/fixtures.mjs";

const o = {
  twtawu: [
    twtawuRow({ code: "9101", haltOff: -3, resumeOff: null }), // 停牌中（尚無恢復日）
    twtawuRow({ code: "9102", haltOff: -10, resumeOff: -1 }),  // 昨天已恢復 → 不算
    twtawuRow({ code: "9103", haltOff: -5, resumeOff: 3 }),    // 恢復日在未來 → 停牌中
    twtawuRow({ code: "9104", haltOff: 2, resumeOff: null }),  // 未來才停 → 今天還能交易
  ],
  tpexSpendi: [
    tpexSpendiRow({ code: "9201", haltOff: -7, resumeOff: null }),  // resume 空字串＝仍停牌
    tpexSpendiRow({ code: "9202", haltOff: -30, resumeOff: -20 }), // 早已恢復
  ],
  tpexCmode: [
    tpexCmodeRow({ code: "9301", altered: "", suspension: "Ｙ" }), // 停止交易旗標（全形Ｙ）
    tpexCmodeRow({ code: "9302", altered: "", suspension: "" }),  // 沒旗標 → 不算
    tpexCmodeRow({ code: "9303", altered: "Ｙ", suspension: "" }), // 上櫃全額交割
    tpexCmodeRow({ code: "9304", altered: "N", suspension: "" }),  // 非 Y 不得誤收
    tpexCmodeRow({ code: "9305", altered: "Y", suspension: "", dateOff: -1 }), // 非基準日不得誤收
  ],
  suspendListing: [
    suspendListingRow({ code: "9401", dateOff: -100 }),  // 100 天前下市 → 排除
    suspendListingRow({ code: "9402", dateOff: -1200 }), // 3 年多前下市 → 代號可能已回收，不排除
    suspendListingRow({ code: "9403", dateOff: 30 }),    // 未來才下市 → 目前仍可交易
  ],
};

let mod, mock;
before(async () => {
  ({ mod, mock } = await importServer({ routes: surveillanceRoutes(o) }));
});

test("getRiskSets：TWSE 停牌日期窗（含已恢復的歷史列要濾掉）", async () => {
  const today = compactToday(0);
  const isoToday = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  const [risk, sameRisk] = await Promise.all([mod.getRiskSets(today), mod.getRiskSets(isoToday)]);
  assert.equal(risk, sameRisk, "同日期不同格式必須正規化並共用整組 single-flight");
  assert.equal(mock.calls.length, 10, "六個風險標示源＋四個停牌/下市源只抓一輪");
  assert.ok(risk.halted.has("9101"), "無恢復日 → 停牌中");
  assert.ok(!risk.halted.has("9102"), "昨天已恢復 → 不在名單");
  assert.ok(risk.halted.has("9103"), "恢復日在未來 → 停牌中");
  assert.ok(!risk.halted.has("9104"), "未來才停牌 → 今天不算");
  // 停牌起日夾帶給技術頁顯示「自 MM/DD」
  assert.equal(risk.halted.get("9101"), compactToday(-3));
});

test("getRiskSets：TPEx 停牌（resume 空字串）＋停止交易旗標（全形Ｙ）", async () => {
  const risk = await mod.getRiskSets(compactToday(0));
  assert.ok(risk.halted.has("9201"), "DateOfResumedTrading 空字串 → 停牌中");
  assert.ok(!risk.halted.has("9202"), "已恢復 → 不在名單");
  assert.ok(risk.halted.has("9301"), "SuspensionOfTrading=Ｙ → 停牌");
  assert.ok(!risk.halted.has("9302"), "無旗標 → 不算");
});

test("getRiskSets：TPEx 全額交割精確接受 Ｙ/Y 且限定資料基準日", async () => {
  const risk = await mod.getRiskSets(compactToday(0));
  assert.equal(risk.surveillance.get("9303")?.kind, "changed");
  assert.ok(!risk.surveillance.has("9304"), "非 Y 值不得誤判全額交割");
  assert.ok(!risk.surveillance.has("9305"), "非基準日資料不得誤收");
});

test("getRiskSets：下市名單只取近兩年（避免誤殺回收代號）", async () => {
  const risk = await mod.getRiskSets(compactToday(0));
  assert.ok(risk.delisted.has("9401"), "100 天前下市 → 排除");
  assert.ok(!risk.delisted.has("9402"), "3 年多前下市 → 不排除");
  assert.ok(!risk.delisted.has("9403"), "未來才下市 → 目前仍可交易");
  // 停牌/下市不影響既有 surveillance 標示
  assert.ok(!risk.surveillance.has("9101"));
});

test("preselectQuotes / preselectSwingQuotes：停牌與下市股被硬排除", async () => {
  const risk = await mod.getRiskSets(compactToday(0));
  const quote = (code, name) => [code, {
    code, name, exchange: "TWSE",
    price: 100, previousClose: 98, high: 101, low: 97,
    volumeLots: 5000, rawDate: compactToday(0),
  }];
  const reference = {
    byCode: new Map([
      quote("9101", "停牌檔"),
      quote("2330", "台積電"),
      quote("9401", "下市檔"),
    ]),
  };
  const picks = mod.preselectQuotes(reference, risk, compactToday(0));
  assert.deepEqual(picks.map((q) => q.code), ["2330"], "隔日沖候選只剩可交易的");
  const swings = mod.preselectSwingQuotes(reference, risk, compactToday(0));
  assert.deepEqual(swings.map((q) => q.code), ["2330"], "波段候選只剩可交易的");
});

test("preselectQuotes：隔日沖候選只接受基準日報價", () => {
  const today = compactToday(0);
  const quote = (code, rawDate) => [code, {
    code, name: code, exchange: "TWSE",
    price: 100, previousClose: 98, high: 101, low: 97,
    volumeLots: 5000, rawDate,
  }];
  const reference = {
    byCode: new Map([
      quote("2330", today),
      quote("2317", compactToday(-1)),
      quote("2454", ""),
    ]),
  };
  const risk = { halted: new Map(), delisted: new Map() };
  assert.deepEqual(
    mod.preselectQuotes(reference, risk, today).map((item) => item.code),
    ["2330"],
    "落後日與日期不明的報價都不可冠上今日訊號日",
  );
});
