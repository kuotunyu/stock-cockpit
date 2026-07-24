// 漏開 App 的整合回歸：advanceSwingVerification 必須抓官方月 K，依 D1→D2 重放。
import test from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

const D0 = "20260706";
const D1 = "20260707";
const D2 = "20260708";
const roc = (day) => `${Number(day.slice(0, 4)) - 1911}/${day.slice(4, 6)}/${day.slice(6, 8)}`;

const { mod } = await importServer({
  routes: [
    { match: /openapi\.twse\.com\.tw\/v1\/exchangeReport\/FMTQIK/, reply: [D0, D1, D2].map((day) => ({ Date: roc(day) })) },
    { match: /openapi\.twse\.com\.tw\/v1\/holidaySchedule\/holidaySchedule/, reply: [] },
    { match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/, reply: (url) => {
      if (url.searchParams.get("stockNo") !== "2330" || !String(url.searchParams.get("date")).startsWith("202607")) {
        return { stat: "OK", data: [] };
      }
      return {
        stat: "OK",
        data: [
          [roc(D1), "1,000,000", "96,000,000", "100", "103", "94", "96", "-4", "1,000"],
          [roc(D2), "1,000,000", "111,000,000", "100", "112", "100", "111", "15", "1,000"],
        ],
      };
    } },
  ],
});

test("D1 先停損、D2 才達標：批次補驗仍結案為 D1 loss", async () => {
  const db = await mod.loadDb();
  db.swingVerification = {
    [D0]: [{
      code: "2330", name: "台積電", scenario: "midBandDefense",
      entry: 100, stop: 95, target: 110, rr: 2, score: 80,
      formulaVersion: mod.SWING_FORMULA_VERSION,
      status: "pending", resolvedAt: null, resultPct: null, daysHeld: 0, lastChecked: D0,
    }],
  };
  const reference = {
    coverageComplete: true,
    markets: { twse: { asOf: D2 }, tpex: { asOf: D2 } },
    byCode: new Map([["2330", {
      code: "2330", name: "台積電", exchange: "TWSE", rawDate: D2,
      open: 100, high: 112, low: 100, price: 111,
    }]]),
  };
  await mod.advanceSwingVerification(reference, D2);
  const entry = db.swingVerification[D0][0];
  assert.equal(entry.status, "loss");
  assert.equal(entry.resolvedAt, D1);
  assert.equal(entry.daysHeld, 1);
  assert.equal(entry.dataGap, undefined);
});
