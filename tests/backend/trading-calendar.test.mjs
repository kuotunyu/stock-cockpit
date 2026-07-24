// 下一交易日解析：官方實際交易日優先、長假與臨時休市、歷史共識 fallback。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer({ routes: [] }));
});

test("FMTQIK 決定訊號後第一個實際交易日", () => {
  const resolved = mod.resolveNextTradingDate("20260703", {
    tradingDays: ["20260701", "20260702", "20260703", "20260706", "20260707"],
    holidayRows: [],
  });
  assert.equal(resolved.date, "20260706");
  assert.equal(resolved.source, "TWSE FMTQIK");
});

test("春節長假依開休市表跳到開始交易日", () => {
  const closed = ["20260212", "20260213", "20260216", "20260217", "20260218", "20260219", "20260220"]
    .map((date) => ({ date, name: "農曆除夕及春節", description: "依規定放假" }));
  closed.push({ date: "20260223", name: "農曆春節後開始交易日", description: "開始交易" });
  assert.equal(mod.nextScheduledTradingDate("20260211", closed), "20260223");
});

test("臨時休市由 FMTQIK 缺日證據修正", () => {
  const resolved = mod.resolveNextTradingDate("20260709", {
    tradingDays: ["20260709", "20260713"],
    holidayRows: [],
  });
  assert.equal(resolved.scheduledDate, "20260710");
  assert.equal(resolved.date, "20260713", "排定 7/10 開市但實際序列缺席 → 取下一個實際交易日");
});

test("FMTQIK 未涵蓋舊月份時，多檔官方歷史共識可修正臨時休市", () => {
  const resolved = mod.resolveNextTradingDate("20260601", {
    tradingDays: ["20260701", "20260702"],
    holidayRows: [],
    candidateDays: ["20260603", "20260603", "20260603", "20260604"],
  });
  assert.equal(resolved.scheduledDate, "20260602");
  assert.equal(resolved.date, "20260603");
  assert.equal(resolved.source, "official history consensus");
});

