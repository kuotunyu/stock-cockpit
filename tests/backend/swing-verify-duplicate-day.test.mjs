// 波段驗證重放的「前一交易日」是怎麼取的。
//
// replaySwingVerificationHistory 收到的 rows 來自 advanceSwingVerification 的
// `rows = [...history, ...directRows]`——官方逐檔月歷史「＋」整批收盤那一列，中間沒有去重。
// 官方當月歷史在收盤後就會長出當日 K，於是同一天會同時出現兩列。
// byDate 用 Map 建（後者覆蓋前者）→ 取到整批收盤那列；
// 而公司行動比率是用 `rows[rows.indexOf(row) - 1]` 取「前一格」→ 剛好是同一天的歷史列。
// 結果比率變成「今天的昨收 ÷ 今天的收盤」＝ 1 ÷ (1＋當日漲跌幅)，
// 在完全沒有除權息的日子把 entry／停損／目標整組乘上一個假比率，而且會落盤。
//
// 同一份程式碼裡的 appendTodayCloseBar 早就有 `quoteDate <= latestHistDate → 不補` 的護欄，
// 這條路徑偏偏沒用上。
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { importServer } from "../helpers/test-server.mjs";

let mod;
before(async () => {
  ({ mod } = await importServer());
});

const historyBar = (compact, { open, high, low, close, previousClose }) => ({
  date: `${compact.slice(0, 4)}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`,
  rawDate: compact,
  code: "2330", name: "台積電", exchange: "TWSE",
  open, high, low, close, previousClose,
  exchangePreviousClose: previousClose, exchangeCorporateActionMark: false,
  change: null, volumeShares: 1e6, volumeLots: 1000, tradeValue: 1e8, transactions: 10,
  source: "TWSE STOCK_DAY",
});

// 整批收盤那一列（normalizeDailyTwse 的形狀：previousClose = close − change）
const quoteRow = (compact, { open, high, low, price, previousClose }) => ({
  code: "2330", name: "台積電", exchange: "TWSE",
  rawDate: compact, asOf: `${compact.slice(0, 4)}/${compact.slice(4, 6)}/${compact.slice(6, 8)}`,
  open, high, low, price, previousClose,
});

const pendingEntry = () => ({
  code: "2330", scenario: "midBandDefense", status: "pending",
  entry: 100, stop: 95, target: 108,
  lastChecked: "20260601", daysHeld: 0,
});

const calendar = { tradingDays: ["20260601", "20260602"], holidayRows: [] };

test("同一天同時有官方歷史與整批收盤兩列時，不得把當日漲跌幅當成公司行動", () => {
  const entry = pendingEntry();
  // 06/02 純上漲 3%，沒有任何除權息。歷史列與整批收盤列講的是同一天、同一組數字。
  const rows = [
    historyBar("20260602", { open: 101, high: 104, low: 100, close: 103, previousClose: 100 }),
    quoteRow("20260602", { open: 101, high: 104, low: 100, price: 103, previousClose: 100 }),
  ];
  mod.replaySwingVerificationHistory(entry, rows, "20260602", calendar);

  assert.equal(entry.entry, 100, `進場價不可被動過（實際 ${entry.entry}）`);
  assert.equal(entry.stop, 95, `停損不可被動過（實際 ${entry.stop}）`);
  assert.equal(entry.target, 108, `目標不可被動過（實際 ${entry.target}）`);
  assert.ok(
    !entry.corporateActions || entry.corporateActions.length === 0,
    `不得憑空記下公司行動：${JSON.stringify(entry.corporateActions)}`,
  );
});

test("下跌日更危險：假比率會把停損上修到當日最低價之上，當場記出不存在的停損", () => {
  const entry = pendingEntry();
  // 06/02 下跌 3%：最低 96.5，從頭到尾沒有碰到真正的停損 95，這筆應該繼續 pending。
  const rows = [
    historyBar("20260602", { open: 99, high: 99.5, low: 96.5, close: 97, previousClose: 100 }),
    quoteRow("20260602", { open: 99, high: 99.5, low: 96.5, price: 97, previousClose: 100 }),
  ];
  mod.replaySwingVerificationHistory(entry, rows, "20260602", calendar);

  assert.equal(entry.status, "pending", `最低價 96.5 沒碰到停損 95，不該結案（實際 ${entry.status} / ${entry.resultPct}）`);
  assert.equal(entry.stop, 95);
});

test("真正的除權息（前後兩個不同交易日）仍要正確吸收跳空", () => {
  const entry = pendingEntry();
  // 06/01 收 100；06/02 除息 5 元 → 官方昨收（＝參考價）95，當天相對參考價收平盤。
  // 沒有這道調整，low 95 <= stop 95 會被記成假停損，而投資人同時領到 5 元現金股利。
  const rows = [
    historyBar("20260601", { open: 100, high: 101, low: 99, close: 100, previousClose: 99 }),
    historyBar("20260602", { open: 95, high: 96, low: 95, close: 95.5, previousClose: 95 }),
  ];
  mod.replaySwingVerificationHistory(entry, rows, "20260602", { tradingDays: ["20260602"], holidayRows: [] });

  assert.ok(Math.abs(entry.entry - 95) < 1e-6, `進場價要跟著搬到除息後尺度（實際 ${entry.entry}）`);
  assert.ok(Math.abs(entry.stop - 90.25) < 1e-6, `停損 95 × 0.95 = 90.25（實際 ${entry.stop}）`);
  assert.equal(entry.status, "pending", "調整後 low 95 高於停損 90.25，不該結案");
  assert.equal(entry.corporateActions?.length, 1, "真的有事件就要留下稽核紀錄");
});

// 這條分辨的是「按日期收斂」與「相鄰性檢查」兩道修法各自的作用：
// 光靠相鄰性檢查會讓同日重複列的那天 gap=0 而整個跳過，於是真的除權息也一起被漏掉，
// 假停損就又回來了。必須先收斂成每天一列，前一格才會是真正的前一交易日。
test("同日重複列的那天如果真的除權息，仍然要正確吸收（不能被相鄰性檢查一起擋掉）", () => {
  const entry = pendingEntry();
  const rows = [
    historyBar("20260601", { open: 100, high: 101, low: 99, close: 100, previousClose: 99 }),
    // 06/02 除息 5 元：官方昨收（＝參考價）95。歷史與整批收盤同時有這一天。
    historyBar("20260602", { open: 95, high: 96, low: 95, close: 95.5, previousClose: 95 }),
    quoteRow("20260602", { open: 95, high: 96, low: 95, price: 95.5, previousClose: 95 }),
  ];
  mod.replaySwingVerificationHistory(entry, rows, "20260602", { tradingDays: ["20260602"], holidayRows: [] });

  assert.ok(Math.abs(entry.entry - 95) < 1e-6, `進場價要搬到除息後尺度（實際 ${entry.entry}）`);
  assert.ok(Math.abs(entry.stop - 90.25) < 1e-6, `停損 95 × 0.95 = 90.25（實際 ${entry.stop}）`);
  assert.equal(entry.status, "pending", "調整後 low 95 高於停損 90.25，不該記成停損");
});

test("缺月造成的非相鄰配對也不得被當成公司行動", () => {
  const entry = pendingEntry();
  // getStockHistory 的 .catch(() => []) 會把抓失敗的月份吞成空陣列，
  // 於是 4/30 與 6/02 被直接接起來，兩者的「昨收 vs 收盤」本來就對不上。
  const rows = [
    historyBar("20260430", { open: 80, high: 81, low: 79, close: 80, previousClose: 79 }),
    historyBar("20260602", { open: 100, high: 101, low: 99, close: 100, previousClose: 100 }),
  ];
  mod.replaySwingVerificationHistory(entry, rows, "20260602", { tradingDays: ["20260602"], holidayRows: [] });
  assert.equal(entry.entry, 100, `隔了一個月的兩根不能拿來推公司行動（實際 ${entry.entry}）`);
  assert.ok(!entry.corporateActions || entry.corporateActions.length === 0);
});
