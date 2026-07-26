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

// 這條原本斷言相反的事（「stat 非 OK ＝ 那個月真的沒有除權息」）——那是我當時的假設，
// 沒有量過。2026-07-26 實測 10 個抽樣月份（2010-02 到 2026-06，含只有 1 筆的 2011-02、
// 2012-02 淡月）**全部**是 stat:"OK" 且帶 data；stat 非 OK 只出現在超出範圍的查詢
// （20260901~20260931 → {"stat":"很抱歉，沒有符合條件的資料!"}，而且完全沒有 data 欄位）。
// 把它當成「抓成功、零筆」會讓那個月被寫成 ok/0 rows、covered 翻成 true，
// 再配合封月邏輯就是一個永遠補不回來的空月。
test("stat 非 OK 是抓取失敗，不可當成「這個月沒有除權息」", async () => {
  const result = await mod.loadCorporateActionResultMonth("202604");
  assert.equal(result.status, "unavailable", "stat 非 OK 要走失敗路徑，5 分鐘後自然重試");
  assert.equal(
    mod.corporateActionResultMonthCovered("20260415"), false,
    "沒抓到的月份不得宣稱查得過——否則該月的 X 標記會被誤判成「查了但沒有比率」",
  );
});

// ---- 封月：只有「該月結束之後才抓的那一份」才是永久真相 ----
// TWT49U 只公布到約 T+1（2026-07-26 查 202607，最後一列是 115年07月27日），
// 所以當月抓的必然是半成品。舊寫法用 `month < currentMonth` 判斷可不可以吃歸檔，
// 於是「7 月 3 日抓的 7 月」一跨到 8 月就被鎖成永久真相——7 月 4 日之後的除權息
// 再也補不回來，而且 covered 照樣回 true，完全不可觀測。
test("當月抓的半成品不得因為跨月就變成永久真相", () => {
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 7 * 3600e3).toISOString(); // 超過 6 小時 TTL

  assert.equal(
    mod.corporateActionResultMonthUsable({ status: "ok", sealed: true, observedAt: old }), true,
    "封月的資料完整且不會再變，多久以前抓的都算數",
  );
  assert.equal(
    mod.corporateActionResultMonthUsable({ status: "ok", sealed: false, observedAt: old }), false,
    "未封月＋過期 → 必須回抓，不可沿用半成品",
  );
  assert.equal(
    mod.corporateActionResultMonthUsable({ status: "ok", sealed: false, observedAt: fresh }), true,
    "未封月但還新鮮 → 不必每次都打上游",
  );
  assert.equal(
    mod.corporateActionResultMonthUsable({ status: "ok", observedAt: old }), false,
    "既有歸檔沒有 sealed 欄位 → 一律當未封月重抓一次，把舊資料裡的半成品洗掉",
  );
  assert.equal(mod.corporateActionResultMonthUsable({ status: "unavailable", sealed: true }), false);
  assert.equal(mod.corporateActionResultMonthUsable(null), false);
});

test("stat 非 OK 的回應不是空月份", () => {
  // 實測形狀：HTTP 200、stat 是一句中文抱歉、而且完全沒有 data 欄位。
  assert.equal(mod.corporateActionResultPayloadRows({ stat: "很抱歉，沒有符合條件的資料!" }), null);
  assert.deepEqual(mod.corporateActionResultPayloadRows({ stat: "OK", data: [] }), [], "stat OK 帶空陣列才是真的空月份");
  assert.equal(mod.corporateActionResultPayloadRows({ data: [] }), null, "沒有 stat 也不能當成功");
});

// ---- 月份數上限：要從新的那一端留 ----
test("超過月份上限時砍掉最舊的、保留最近的，而且要算降級", async () => {
  const before = calls.length;
  const max = mod.CORPORATE_ACTION_RESULT_MAX_MONTHS;
  // 刻意給一個超過上限的區間（上限 30 → 要 36 個月）
  const range = await mod.ensureCorporateActionResults("20230801", "20260731");
  assert.equal(range.months, max, "實際請求的月份數壓在上限");
  assert.ok(range.truncated > 0, `要回報被砍掉幾個月（實際 ${range.truncated}）`);
  assert.equal(range.degraded, true, "被上限砍掉等同沒抓到，揭露不能說「一切正常」");

  // 2023-08 ~ 2026-07 共 36 個月，上限 30 → 保留 2024-02 ~ 2026-07，砍掉最舊的 6 個。
  // （202605~202607 這幾個月前面的測試已經抓過／已記失敗，不會再打上游，所以不看它們。）
  const requested = calls.slice(before).map((start) => start.slice(0, 6));
  assert.ok(requested.includes("202402"), "保留區間的最舊邊界要被請求");
  assert.ok(!requested.includes("202308"), "被砍掉的要是最舊的那幾個月，不是最近的");
  assert.ok(!requested.includes("202401"), "202401 落在被砍掉的那一段");
});
