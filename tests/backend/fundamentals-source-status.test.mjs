// 基本面來源狀態：fetchFundamentalsSource 以前 catch 全吞、回舊值不帶狀態，
// 「來源這輪掛了、顯示的是幾小時前的快取」在畫面上看起來跟新鮮資料一模一樣。
// 現在三態 fresh／stale／unavailable，buildFundamentals 對 stale 發 warning 並回 sourceStatus。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { revenueRow, twseCompanyProfileRow } from "../helpers/fixtures.mjs";

const o = { fail: false, twseRevenue: [revenueRow({ code: "2330", ymOff: -1, revenue: 416975163, yoy: 30.09, mom: 1.52 })] };
const routes = [
  { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap05_L/, reply: () => { if (o.fail) throw new Error("boom 503"); return o.twseRevenue; } },
  { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap05_O/, reply: () => { if (o.fail) throw new Error("boom 503"); return []; } },
  { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap14_L/, reply: () => [] },
  { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap14_O/, reply: () => [] },
  { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/BWIBBU_ALL/, reply: () => [] },
  { match: /tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_peratio_analysis/, reply: () => [] },
  { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/TWT48U_ALL/, reply: () => [] },
  { match: /tpex\.org\.tw\/openapi\/v1\/tpex_exright_prepost/, reply: () => [] },
  { match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/, reply: () => [twseCompanyProfileRow({ code: "2330", name: "台積電", shares: 25932070992 })] },
  { match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/, reply: () => [] },
];

let mod;
before(async () => {
  ({ mod } = await importServer({ routes }));
});

test("第一次成功 → fresh；來源失敗但快取在 → stale 且 buildFundamentals 發 warning、回 sourceStatus", async () => {
  const first = await mod.getMonthlyRevenue();
  assert.ok(first.get("2330"));
  assert.equal(mod.fundamentalsSourceState("revenue").status, "fresh");
  assert.equal(mod.fundamentalsSourceState("eps").status, "unknown", "還沒抓過");

  o.fail = true;
  mod.resetFundamentalsSourceCacheForTest({ expireOnly: true });
  const second = await mod.getMonthlyRevenue();
  assert.ok(second.get("2330"), "失敗時沿用舊值，畫面不會空掉");
  const state = mod.fundamentalsSourceState("revenue");
  assert.equal(state.status, "stale");
  assert.ok(state.error, "要記下失敗原因");

  const body = await mod.buildFundamentals("2330");
  assert.equal(body.sourceStatus.revenue, "stale");
  assert.ok(body.revenue?.latest, "資料仍在");
  assert.ok(body.warnings.some((w) => w.includes("月營收來源這輪更新失敗") && w.includes("最近一次成功")), body.warnings.join(" | "));
});

test("一開始就失敗且沒有快取 → unavailable，回空 Map", async () => {
  o.fail = true;
  mod.resetFundamentalsSourceCacheForTest();
  const map = await mod.getMonthlyRevenue();
  assert.equal(map.size, 0);
  assert.equal(mod.fundamentalsSourceState("revenue").status, "unavailable");
});
