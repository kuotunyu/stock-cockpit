// 基本面（Phase A）：欄位映射、民國轉換、雙市場欄名差異、除息日期窗、歷史快照累積。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { importServer, pollUntil } from "../helpers/test-server.mjs";
import {
  compactToday, rocYearMonth, fundamentalsRoutes,
  revenueRow, epsRowTwse, epsRowTpex, bwibbuRow, peratioRow, twt48uRow, exrightPrepostRow,
  twseCompanyProfileRow, tpexCompanyProfileRow,
} from "../helpers/fixtures.mjs";

const o = {
  twseRevenue: [revenueRow({ code: "2330", ymOff: -1, revenue: 416975163, yoy: 30.09, mom: 1.52 })],
  tpexRevenue: [revenueRow({ code: "5347", ymOff: -1, revenue: 4241870, yoy: 19.47 })],
  twseEps: [epsRowTwse({ code: "2330", quarter: 1, eps: 22.08 })],
  tpexEps: [epsRowTpex({ code: "5347", quarter: 1, eps: 1.22 })],
  bwibbu: [
    bwibbuRow({ code: "2330", pe: 33.68, dividendYield: 0.88, pbr: 11.03 }),
    bwibbuRow({ code: "9998", pe: null }), // 虧損股：官方 PE 給空字串
  ],
  tpexPeratio: [peratioRow({ code: "5347", pe: 49.28, dps: 4.47 })],
  twt48u: [
    {
      ...twt48uRow({ code: "2330", exOff: 10, kind: "權息", cash: 4.5, stockRatio: 0.2 }),
      SubscriptionRatio: "0.1",
      SubscriptionPricePerShare: "30",
    },
    twt48uRow({ code: "2330", exOff: -3, cash: 9 }), // 過去的除息要濾掉
  ],
  tpexExright: [{
    ...exrightPrepostRow({ code: "5347", exOff: 4, kind: "除權息", cash: 4.47, stockRatio: 0.05 }),
    SubscriptionRatioToNewSharesIssued: "0.08",
    SubscriptionPricePerShare: "18",
  }],
  twseCompanyMeta: [twseCompanyProfileRow({ code: "2330", name: "台積電", shares: 25932070992 })],
  tpexCompanyMeta: [tpexCompanyProfileRow({ code: "5347", name: "世界", shares: 1629830000 })],
};

let mod;
let dataDir;
before(async () => {
  ({ mod, dataDir } = await importServer({ routes: fundamentalsRoutes(o) }));
});

test("buildFundamentals：上市欄位映射＋民國年月/年度轉換", async () => {
  const f = await mod.buildFundamentals("2330");
  assert.equal(f.ok, true);
  assert.equal(f.revenue.latest.yearMonth, mod.rocYearMonthToIso(rocYearMonth(-1)));
  assert.equal(f.revenue.latest.revenue, 416975163);
  assert.ok(Math.abs(f.revenue.latest.yoy - 30.09) < 0.01);
  assert.equal(f.eps.latest.eps, 22.08);
  assert.equal(f.eps.latest.period, `${compactToday().slice(0, 4)}Q1`);
  assert.equal(f.valuation.pe, 33.68);
  assert.equal(f.valuation.dps, null, "TWSE 版沒有每股股利欄");
  // 除權息：只留今天以後，並保留 TWSE 參考價公式需要的全部官方欄位。
  assert.equal(f.dividends.length, 1);
  assert.equal(f.dividends[0].exDate, compactToday(10));
  assert.equal(f.dividends[0].kind, "除權息");
  assert.equal(f.dividends[0].cashDividend, 4.5);
  assert.equal(f.dividends[0].stockRatio, 0.2);
  assert.equal(f.dividends[0].subscriptionRatio, 0.1);
  assert.equal(f.dividends[0].subscriptionPrice, 30);
  assert.equal(f.shortName, "台積電");
  assert.equal(f.industry, "半導體業");
  assert.deepEqual(f.warnings, []);
});

test("buildFundamentals：上櫃欄名差異（SecuritiesCompanyCode／基本每股盈餘／DividendPerShare／拼錯的 Rrights）", async () => {
  const f = await mod.buildFundamentals("5347");
  assert.equal(f.revenue.latest.revenue, 4241870);
  assert.ok(Math.abs(f.revenue.latest.yoy - 19.47) < 0.01);
  assert.equal(f.eps.latest.eps, 1.22);
  assert.equal(f.valuation.pe, 49.28);
  assert.equal(f.valuation.dps, 4.47, "TPEx 版多每股股利");
  assert.equal(f.shortName, "世界");
  assert.equal(f.industry, "半導體業");
  assert.equal(f.dividends[0].exDate, compactToday(4));
  assert.equal(f.dividends[0].kind, "除權息");
  assert.equal(f.dividends[0].stockRatio, 0.05);
  assert.equal(f.dividends[0].subscriptionRatio, 0.08);
  assert.equal(f.dividends[0].subscriptionPrice, 18);
});

test("虧損股 PE 空值 → null；查無此檔 → 各維度 null/空（仍 ok:true）", async () => {
  const loss = await mod.buildFundamentals("9998");
  assert.equal(loss.valuation.pe, null);
  assert.ok(Number.isFinite(loss.valuation.pbr));
  const none = await mod.buildFundamentals("1234");
  assert.equal(none.ok, true);
  assert.equal(none.revenue, null);
  assert.equal(none.eps, null);
  assert.equal(none.valuation, null);
  assert.deepEqual(none.dividends, []);
});

test("歷史快照：官方「只回最新一期」的營收/EPS 會累積寫進 fundamentals-cache.json", async () => {
  const f = await mod.buildFundamentals("2330");
  // API 回傳裡就有 history（含這次剛累積的第一期）
  assert.equal(f.revenue.history.length, 1);
  assert.equal(f.revenue.history[0].period, f.revenue.latest.yearMonth);
  assert.equal(f.eps.history[0].period, f.eps.latest.period);
  // 磁碟持久化是 fire-and-forget → 輪詢等檔案落地
  const file = await pollUntil(async () => {
    try {
      return JSON.parse(await readFile(join(dataDir, "fundamentals-cache.json"), "utf8"));
    } catch {
      return null;
    }
  });
  assert.ok(file.revenue["2330"], "營收快照要有 2330");
  assert.ok(file.eps["2330"], "EPS 快照要有 2330");
  assert.ok(file.revenue["5347"], "上櫃檔也要進快照");
  // 除權息歸檔：公告只在未來滾動窗出現，見一筆存一筆（給日後官方還原權息用）
  assert.ok(file.dividends["2330"]?.[compactToday(10)], "2330 的未來除息公告要被歸檔");
  assert.equal(file.dividends["2330"][compactToday(10)].cashDividend, 4.5);
  assert.equal(file.dividends["2330"][compactToday(10)].stockRatio, 0.2);
  assert.equal(file.dividends["2330"][compactToday(10)].subscriptionRatio, 0.1);
  assert.equal(file.dividends["2330"][compactToday(10)].subscriptionPrice, 30);
  assert.ok(file.dividends["5347"]?.[compactToday(4)], "上櫃除息也要歸檔");
  assert.equal(file.dividends["5347"][compactToday(4)].subscriptionRatio, 0.08);
  assert.equal(file.dividends["5347"][compactToday(4)].subscriptionPrice, 18);
  assert.ok(
    file.dividends["2330"]?.[compactToday(-3)],
    "上游仍回傳的過去事件也要先歸檔，否則未來做日 K 還原時歷史證據會永久遺失",
  );
  assert.equal(file.dividends["2330"][compactToday(-3)].cashDividend, 9);
  assert.ok(
    f.dividends.every((item) => item.exDate >= compactToday()),
    "過去事件只供歷史還原，不可重新出現在基本面 future UI",
  );
});
