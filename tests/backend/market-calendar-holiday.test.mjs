// 市場時段 metadata：平日國定假日必須明確回 stockTradingDay=false，前端才不會誤判盤中。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";

const today = compactToday();
const rocToday = `${Number(today.slice(0, 4)) - 1911}${today.slice(4)}`;
const { mod } = await importServer({ routes: [] });

test("buildStockMarketCalendarStatus：官方休市、實際交易日、未知三態", () => {
  const closed = mod.buildStockMarketCalendarStatus({
    tradingDays: [],
    holidayRows: [{ date: today, name: "國定假日", description: "休市" }],
    sources: { holidays: { status: "fresh" }, sessions: { status: "fresh" } },
    degraded: false,
  }, today);
  assert.equal(closed.stockTradingDay, false);
  assert.equal(closed.holidayName, "國定假日");
  assert.equal(closed.confidence, "official-holiday");

  const open = mod.buildStockMarketCalendarStatus({
    tradingDays: [today], holidayRows: [],
    sources: { holidays: { status: "unavailable" }, sessions: { status: "fresh" } },
  }, today);
  assert.equal(open.stockTradingDay, true);
  assert.equal(open.confidence, "actual-session");

  const weekday = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 1, Number(today.slice(6, 8)))).getUTCDay();
  const unknown = mod.buildStockMarketCalendarStatus({
    tradingDays: [], holidayRows: [],
    sources: { holidays: { status: "unavailable" }, sessions: { status: "unavailable" } },
  }, today);
  assert.equal(unknown.stockTradingDay, weekday === 0 || weekday === 6 ? false : null);
  assert.equal(rocToday.length, 7); // fixture sanity：民國日期格式
});
