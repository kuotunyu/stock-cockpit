// 官方除權除息「計算結果表」（TWSE TWT49U）：直接給除權息前收盤價與參考價，
// 兩者相除就是精確的還原因子。為什麼需要這條來源——2026-07-26 用真實 API 實測：
//   台積電 2026-06-11、鴻海 07-02、中華電 07-09 都有除息，但
//   (a) 本機「預告」歸檔完全沒有（預告表只有未來滾動窗，除息日一過就查不到），
//   (b) 跳空 -0.22%／-3.63%／-4.30% 全部遠低於 10.5% heuristic 門檻。
//   → 這三檔的均線在這條來源接上之前完全沒有還原。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

// 真實 payload 形狀（2026-07-26 從官方端點抄下來，欄位順序原樣保留）：
// 資料日期 / 代號 / 名稱 / 除權息前收盤價 / 除權息參考價 / 權值+息值 / 權息 / 漲停 / 跌停 / 開盤競價基準 / 減除股利參考價 / …
const row = (date, code, name, preClose, ref, value, kind) =>
  [date, code, name, preClose, ref, value, kind, "0", "0", ref, ref, `${code},${date}`, "", "", ""];

const JUNE = [
  row("115年06月11日", "2330", "台積電", "2,255.00", "2,248.99", "6.000035", "息"),
  row("115年06月01日", "2612", "中航", "57.70", "55.50", "2.200000", "息"),
];
const JULY = [
  row("115年07月02日", "2317", "鴻海", "248.00", "240.82", "7.171792", "息"),
  row("115年07月23日", "6944", "興普", "1,030.00", "779.23", "250.769231", "權息"),
  row("115年07月21日", "0050", "元大台灣50", "99.20", "98.60", "0.600000", "息"),
  // 兩個價格缺一就沒有比率可言，不可以留半筆讓下游以為官方確認過。
  row("115年07月28日", "9999", "缺價格", "", "", "1.0", "息"),
];

let calls = [];
let mod;
let mock;
let dataDir;
before(async () => {
  ({ mod, mock, dataDir } = await importServer({
    routes: [{
      match: /www\.twse\.com\.tw\/rwd\/zh\/exRight\/TWT49U/,
      reply: (url) => {
        const start = url.searchParams.get("startDate") || "";
        calls.push(start);
        if (start.startsWith("202606")) return { stat: "OK", data: JUNE };
        if (start.startsWith("202607")) return { stat: "OK", data: JULY };
        if (start.startsWith("202605")) throw new Error("上游 500");
        return { stat: "很抱歉，沒有符合條件的資料!" };
      },
    }],
  }));
});
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test("解析真實 payload 形狀：民國日期、千分位、ETF 六碼代號", () => {
  const byCode = mod.normalizeCorporateActionResultRows(JULY);
  assert.ok(byCode.has("0050"), "ETF 代號不可被四碼規則擋掉");
  assert.equal(byCode.get("6944")["20260723"].preClose, 1030, "千分位逗號要吃掉");
  assert.equal(byCode.get("6944")["20260723"].referencePrice, 779.23);
  assert.equal(byCode.get("6944")["20260723"].kind, "除權息", "官方只寫「權息」，要正規化成除權息");
  assert.equal(byCode.get("2317")["20260702"].kind, "除息");
  assert.ok(!byCode.has("9999"), "任一價格缺值就整筆丟掉，不留半筆");
});

test("補齊區間月份並歸檔；還原因子＝參考價 ÷ 除權息前收盤價", async () => {
  const result = await mod.ensureCorporateActionResults("20260601", "20260726");
  assert.equal(result.months, 2);
  assert.equal(result.degraded, false);

  // 台積電：本機預告歸檔沒有、跳空只有 -0.22% 也過不了 heuristic 門檻，只有這條來源查得到。
  const tsmc = mod.corporateActionResultFor("2330", "20260611");
  assert.ok(tsmc, "台積電的除息日必須查得到");
  assert.equal(tsmc.preClose, 2255);
  assert.equal(tsmc.referencePrice, 2248.99);
  assert.ok(Math.abs(mod.corporateActionResultRatio("2330", "20260611") - 2248.99 / 2255) < 1e-12);

  // 大額配股：因子明顯偏離 1，是最容易看出有沒有生效的樣本。
  assert.ok(Math.abs(mod.corporateActionResultRatio("6944", "20260723") - 779.23 / 1030) < 1e-12);
  assert.equal(mod.corporateActionResultRatio("0050", "20260721"), 98.6 / 99.2);

  assert.equal(mod.corporateActionResultFor("2330", "20260612"), null, "沒有事件的日期要回 null");
  assert.equal(mod.corporateActionResultRatio("1234", "20260611"), null, "沒有事件的代號要回 null");
});

test("過去月份抓過就不再打上游（結果表不會回頭改）", async () => {
  const before = calls.length;
  await mod.ensureCorporateActionResults("20260601", "20260630");
  assert.equal(calls.length, before, "已歸檔的過去月份不可重抓");
});

test("上游失敗只降級不拋錯——這條來源是增益，不該讓整頁掛掉", async () => {
  const result = await mod.loadCorporateActionResultMonth("202605");
  assert.equal(result.status, "unavailable");
  assert.ok(result.error, "要保留錯誤訊息供揭露");
  const range = await mod.ensureCorporateActionResults("20260501", "20260630");
  assert.equal(range.degraded, true, "區間內有月份抓不到就要標降級");
  assert.ok(mod.corporateActionResultFor("2330", "20260611"), "既有歸檔不受影響");
});

test("空月份是合法結果，不是錯誤", async () => {
  const result = await mod.loadCorporateActionResultMonth("202604");
  assert.notEqual(result.status, "unavailable", "官方回「沒有符合條件的資料」代表那個月真的沒有除權息");
});
