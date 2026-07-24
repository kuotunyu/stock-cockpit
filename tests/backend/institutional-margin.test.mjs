// 三大法人＋融資融券：官方回的是「陣列列」（欄位靠索引對位，最容易被上游改版打壞），
// 以及「收盤後才公布 → 往前找最近交易日」的 walk-back。全離線（fetch-mock 依日期參數回覆）。
// 快取注意：institutionalCache/marginCache 以 requestedDate 為 key → 每個測試用不同基準日。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";
import { t86Row, tpexInstiRow, twseMarginRow, tpexMarginRow, compactToday, rocSlash } from "../helpers/fixtures.mjs";

const slash = (compact) => `${compact.slice(0, 4)}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`;
const iso = (compact) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;

// 每個情境一個基準日（互不撞快取）
const INSTI_DIRECT = compactToday(-10);
const INSTI_WALK_REQ = compactToday(0);
const INSTI_WALK_HIT = compactToday(-2);
const INSTI_EMPTY = compactToday(-20);
const MARGIN_DIRECT = compactToday(-11);
const MARGIN_WALK_REQ = compactToday(-1);
const MARGIN_WALK_HIT = compactToday(-3);

let mod, mock;
before(async () => {
  ({ mod, mock } = await importServer({
    routes: [
      { match: /www\.twse\.com\.tw\/rwd\/zh\/fund\/T86/, reply: (url) => {
        const d = url.searchParams.get("date");
        if (d === INSTI_DIRECT) return { stat: "OK", date: d, data: [t86Row({ code: "2330" }), t86Row({ code: "1101", foreignNet: -50000 })] };
        if (d === INSTI_WALK_HIT) return { stat: "OK", date: d, data: [t86Row({ code: "2330", foreignNet: 2500000 })] };
        return { stat: "很抱歉，沒有符合條件的資料!", data: [] };
      } },
      { match: /3itrade_hedge_result/, reply: (url) => {
        const d = url.searchParams.get("d"); // ROC 斜線（例 115/06/24）
        if (d === rocSlash(INSTI_DIRECT)) return { tables: [{ date: d, data: [tpexInstiRow({ code: "5347" })] }] };
        return { tables: [{ data: [] }] };
      } },
      { match: /www\.twse\.com\.tw\/rwd\/zh\/marginTrading\/MI_MARGN/, reply: (url) => {
        const d = url.searchParams.get("date");
        if (d === MARGIN_DIRECT || d === MARGIN_WALK_HIT) {
          // 消費端規則：取「data 超過 50 列」的表，否則 tables[1] → 主表放 [1]。
          return { stat: "OK", tables: [{ data: [] }, { data: [twseMarginRow({ code: "2330" })] }] };
        }
        return { stat: "很抱歉，沒有符合條件的資料!", tables: [] };
      } },
      { match: /tpex\.org\.tw\/www\/zh-tw\/margin\/balance/, reply: (url) => {
        const d = url.searchParams.get("date"); // 西元斜線
        if (d === slash(MARGIN_DIRECT)) return { tables: [{ data: [tpexMarginRow({ code: "5347" })] }] };
        return { tables: [{ data: [] }] };
      } },
    ],
  }));
});

test("normalizeTwseInstitutionalRow：19 欄索引對位＋千分位解析", () => {
  const r = mod.normalizeTwseInstitutionalRow(t86Row({ code: "2330", name: "台積電", foreignNet: 1234567, trustNet: 500000, dealerNet: -200000, totalNet: 1534567 }), compactToday(-10));
  assert.equal(r.code, "2330");
  assert.equal(r.exchange, "TWSE");
  assert.equal(r.unit, "shares");
  assert.equal(r.foreignNet, 1234567, "千分位要解掉");
  assert.equal(r.trustNet, 500000);
  assert.equal(r.dealerNet, -200000);
  assert.equal(r.totalNet, 1534567);
  assert.equal(r.foreignBuy, 5000000);
});

test("normalizeTpexInstitutionalRow：24 欄索引對位（外資合計/自營合計欄位比 TWSE 多）", () => {
  const r = mod.normalizeTpexInstitutionalRow(tpexInstiRow({ code: "5347", foreignNet: 80000, trustNet: 20000, dealerNet: 5000, totalNet: 105000 }), compactToday(-10));
  assert.equal(r.exchange, "TPEx");
  assert.equal(r.foreignNet, 80000);
  assert.equal(r.foreignTotalNet, 80000);
  assert.equal(r.trustNet, 20000);
  assert.equal(r.dealerNet, 5000, "自營合計淨額在第 22 欄");
  assert.equal(r.totalNet, 105000);
});

test("normalizeTwseMarginRow／normalizeTpexMarginRow：餘額增減、資使用率、券資比", () => {
  const t = mod.normalizeTwseMarginRow(twseMarginRow({ code: "2330", marginPrev: 10000, marginBalance: 12000, marginLimit: 50000, shortPrev: 800, shortBalance: 1000 }), compactToday(-11));
  assert.equal(t.unit, "lots");
  assert.equal(t.marginChange, 2000, "融資增減＝今日−前日");
  assert.equal(t.marginUsagePct, (12000 / 50000) * 100, "TWSE 資使用率＝餘額/限額");
  assert.equal(t.shortChange, 200);
  assert.equal(t.shortMarginRatio, (1000 / 12000) * 100, "券資比＝券餘/資餘");
  const p = mod.normalizeTpexMarginRow(tpexMarginRow({ code: "5347", marginPrev: 5000, marginBalance: 6000, usagePct: 12.5, shortPrev: 300, shortBalance: 450 }), compactToday(-11));
  assert.equal(p.marginChange, 1000);
  assert.equal(p.marginUsagePct, 12.5, "TPEx 直接給百分比欄");
  assert.equal(p.shortMarginRatio, (450 / 6000) * 100);
});

test("getInstitutionalData：當日就有資料 → 直接用、雙市場合併、codes 過濾", async () => {
  const body = await mod.getInstitutionalData({ codes: ["2330", "5347"], dateCompact: INSTI_DIRECT });
  assert.equal(body.ok, true);
  assert.equal(body.date, iso(INSTI_DIRECT));
  assert.equal(body.recordCount, 2, "codes 只要了 2330/5347 → 1101 被濾掉");
  assert.ok(body.records["2330"] && body.records["5347"]);
  assert.equal(body.records["1101"], undefined);
  assert.deepEqual(body.warnings, [], "兩市場都成功不該有警告");
});

test("getInstitutionalData：當日未公布 → 往前找到 -2 天＋『已改用』警告", async () => {
  const body = await mod.getInstitutionalData({ codes: ["2330"], dateCompact: INSTI_WALK_REQ });
  assert.equal(body.ok, true);
  assert.equal(body.date, iso(INSTI_WALK_HIT), "要用實際找到資料的日期");
  assert.equal(body.requestedDate, iso(INSTI_WALK_REQ));
  assert.equal(body.records["2330"].foreignNet, 2500000);
  assert.ok(body.warnings.some((w) => w.includes("已改用")), `warnings 要註記改用舊資料：${body.warnings}`);
});

test("getInstitutionalData：連找 7 天都沒資料 → ok:false、空 records", async () => {
  const body = await mod.getInstitutionalData({ codes: ["2330"], dateCompact: INSTI_EMPTY });
  assert.equal(body.ok, false);
  assert.equal(body.recordCount, 0);
});

test("getMarginData：雙市場合併（TWSE 表取 tables[1]、TPEx tables[0]）", async () => {
  const body = await mod.getMarginData({ codes: ["2330", "5347"], dateCompact: MARGIN_DIRECT });
  assert.equal(body.ok, true);
  assert.equal(body.date, iso(MARGIN_DIRECT));
  assert.equal(body.records["2330"].marginBalance, 12000);
  assert.equal(body.records["5347"].marginBalance, 6000);
});

test("getMarginData：walk-back（TPEx 一路失敗只靠 TWSE 也要能出資料）", async () => {
  const body = await mod.getMarginData({ codes: ["2330"], dateCompact: MARGIN_WALK_REQ });
  assert.equal(body.ok, true);
  assert.equal(body.date, iso(MARGIN_WALK_HIT));
  assert.ok(body.warnings.some((w) => w.includes("已改用")));
  assert.ok(body.warnings.some((w) => w.includes("TPEx")), "TPEx 失敗要留警告");
});

test("同日期併發法人／融資券請求共用 single-flight，不重複 walk-back", async () => {
  const instDate = compactToday(-40);
  const beforeInst = mock.callsFor(/fund\/T86|3itrade_hedge_result/).length;
  await Promise.all([
    mod.getInstitutionalData({ codes: ["2330"], dateCompact: instDate }),
    mod.getInstitutionalData({ codes: ["5347"], dateCompact: instDate }),
  ]);
  assert.equal(mock.callsFor(/fund\/T86|3itrade_hedge_result/).length - beforeInst, 14, "7 天 × 2 市場只抓一輪");

  const marginDate = compactToday(-41);
  const beforeMargin = mock.callsFor(/marginTrading\/MI_MARGN|margin\/balance/).length;
  await Promise.all([
    mod.getMarginData({ codes: ["2330"], dateCompact: marginDate }),
    mod.getMarginData({ codes: ["5347"], dateCompact: marginDate }),
  ]);
  assert.equal(mock.callsFor(/marginTrading\/MI_MARGN|margin\/balance/).length - beforeMargin, 14, "7 天 × 2 市場只抓一輪");
});
