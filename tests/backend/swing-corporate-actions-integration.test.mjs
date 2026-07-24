// 波段公司行為的 scan-level 整合契約：
// 1) scan/inspect 必須真的載入 fundamentals-cache 的歷史公告；
// 2) 同日有完整官方公告時，官方公式優先於價差 heuristic；
// 3) 本機 archive 未涵蓋某次大缺口時，仍可降級估算；
// 4) 同日官方公告存在但公式欄位不完整時，不得靠 heuristic 冒充可精算並進入選股。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer, pollUntil } from "../helpers/test-server.mjs";
import {
  compactToday,
  fundamentalsRoutes,
  rocSlash,
  stockDayAllRow,
  surveillanceRoutes,
  tpexDailyCloseRow,
} from "../helpers/fixtures.mjs";

const COMPLETE = "9101";
const ARCHIVE_GAP = "9102";
const UNRESOLVED = "9103";
const GAP_INDEX = 105; // 120 根中的倒數第 15 根：一定落在「近期 21 根」窗內。
const MARKET_GAP_RATIO = 0.85;

function compactFromIso(iso) {
  return String(iso).replaceAll("-", "");
}

// 這組平滑趨勢在沒有公司行為污染時會穩定命中 midBandDefense，RR 也大於 1。
// 公司行為測試不能靠「剛好型態本來就不符合」得到排除的假綠燈。
function matchingRows() {
  const count = 120;
  const first = new Date(`${compactToday().slice(0, 4)}-${compactToday().slice(4, 6)}-${compactToday().slice(6, 8)}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - count + 1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    const mid = 100 + (0.02 * index) + (2 * Math.sin(index / 2));
    return {
      date: date.toISOString().slice(0, 10),
      open: mid - 0.3,
      high: mid + 1,
      low: mid - 1,
      close: mid + 0.3,
      volumeLots: 5_000 + ((index % 5) * 100),
      tradeValue: 500_000_000,
    };
  });
}

function withMarketGap(rows) {
  return rows.map((row, index) => {
    if (index < GAP_INDEX) return { ...row };
    return {
      ...row,
      open: row.open * MARKET_GAP_RATIO,
      high: row.high * MARKET_GAP_RATIO,
      low: row.low * MARKET_GAP_RATIO,
      close: row.close * MARKET_GAP_RATIO,
    };
  });
}

const pristineRows = matchingRows();
const rowsByCode = new Map([
  [COMPLETE, withMarketGap(pristineRows)],
  [ARCHIVE_GAP, withMarketGap(pristineRows)],
  [UNRESOLVED, withMarketGap(pristineRows)],
]);
const exDate = compactFromIso(pristineRows[GAP_INDEX].date);
const harmlessArchivedDate = compactFromIso(pristineRows[20].date);
const previousClose = pristineRows[GAP_INDEX - 1].close;

function twseHistoryPayload(url) {
  const code = url.searchParams.get("stockNo");
  const month = String(url.searchParams.get("date") || "").slice(0, 6);
  const source = rowsByCode.get(code) || [];
  const data = source
    .filter((row) => compactFromIso(row.date).startsWith(month))
    .map((row, index, monthRows) => {
      const globalIndex = source.indexOf(row);
      const prior = globalIndex > 0 ? source[globalIndex - 1] : null;
      const change = prior ? row.close - prior.close : 0;
      return [
        rocSlash(compactFromIso(row.date)),
        String(row.volumeLots * 1_000),
        String(Math.round(row.tradeValue)),
        row.open.toFixed(4),
        row.high.toFixed(4),
        row.low.toFixed(4),
        row.close.toFixed(4),
        change.toFixed(4),
        String(1_000 + index + monthRows.length),
      ];
    });
  return { stat: "OK", data };
}

const dataDir = await mkdtemp(join(tmpdir(), "stock1-swing-actions-"));
await writeFile(join(dataDir, "fundamentals-cache.json"), JSON.stringify({
  revenue: {},
  eps: {},
  valuation: {},
  dividends: {
    [COMPLETE]: {
      [exDate]: {
        kind: "除息",
        cashDividend: previousClose * (1 - MARKET_GAP_RATIO),
        stockRatio: 0,
        subscriptionRatio: 0,
        subscriptionPrice: 0,
        observedAt: "2026-01-01T00:00:00.000Z",
        revision: 1,
      },
    },
    [ARCHIVE_GAP]: {
      // 證明「archive 有資料」不等於完整涵蓋整段 K 線；這筆無害舊公告不能關掉
      // GAP_INDEX 那一天的 heuristic fallback。
      [harmlessArchivedDate]: {
        kind: "除息",
        cashDividend: 0,
        stockRatio: 0,
        subscriptionRatio: 0,
        subscriptionPrice: 0,
        observedAt: "2026-01-01T00:00:00.000Z",
        revision: 1,
      },
    },
    [UNRESOLVED]: {
      [exDate]: {
        kind: "除權",
        stockRatio: 0.15,
        // 刻意模擬舊 archive：沒有 subscriptionRatio/subscriptionPrice schema，
        // 官方公式不能確認；即使價格剛好有 >10.5% 缺口也只能視為 unresolved。
        observedAt: "2026-01-01T00:00:00.000Z",
        revision: 1,
      },
    },
  },
}), "utf8");

const latestRows = Object.fromEntries([...rowsByCode].map(([code, rows]) => [code, rows.at(-1)]));
const referenceRows = [COMPLETE, ARCHIVE_GAP, UNRESOLVED].map((code) => {
  const row = latestRows[code];
  const prior = rowsByCode.get(code).at(-2);
  return {
    ...stockDayAllRow({
      code,
      name: `整合${code}`,
      close: row.close,
      open: row.open,
      high: row.high,
      low: row.low,
      volume: row.volumeLots * 1_000,
    }),
    Change: String(row.close - prior.close),
  };
});

const { mod, mock } = await importServer({
  dataDir,
  routes: [
    ...surveillanceRoutes({
      reference: referenceRows,
      // 讓兩市場資料日對齊、reference coverage 為完整；零量 dummy 不會進候選池。
      tpexReference: [tpexDailyCloseRow({ code: "9999", name: "零量對照", volume: 0 })],
    }),
    ...fundamentalsRoutes({ twt48u: [], tpexExright: [] }),
    {
      match: /www\.twse\.com\.tw\/exchangeReport\/STOCK_DAY\?/,
      reply: twseHistoryPayload,
    },
    {
      match: /query1\.finance\.yahoo\.com\/v8\/finance\/chart/,
      reply: { chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } },
    },
  ],
});

after(async () => {
  // getRiskSets 的持久化是 fire-and-forget；等原子 rename 完成再移除臨時目錄，
  // 避免測試清理與背景寫檔互撞而製造無關的 ENOENT warning。
  await pollUntil(
    () => access(join(dataDir, "risk-cache.json")).then(() => true, () => false),
    { timeout: 500, interval: 10 },
  ).catch(() => {});
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

function scenarioWarnings(result) {
  return (result.scenarios || []).flatMap((scenario) => scenario.warns || []);
}

test("fixture control：未受公司行為污染時確實命中且 RR≥1", () => {
  const features = mod.computeSwingFeatures(pristineRows, [], { allowHeuristicFallback: true });
  const scenario = mod.classifySwingScenario(features);
  const plan = mod.buildSwingPlan(features);
  assert.equal(scenario?.key, "midBandDefense");
  assert.ok(plan.rr >= 1, `fixture RR=${plan.rr}，必須能通過 scan 的 RR gate`);
});

test("inspectSwingStock 會載入 fundamentals 歷史，同日完整官方事件優先於價差 heuristic", async () => {
  const result = await mod.inspectSwingStock(COMPLETE);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.verdict.key, "midBandDefense");
  const warnings = scenarioWarnings(result);
  assert.ok(warnings.includes("近期除權息(官方已還原)"), `warnings=${JSON.stringify(warnings)}`);
  assert.ok(!warnings.some((warning) => warning.includes("估算還原")), "同日已有完整官方事件，不得退回 heuristic");
});

test("inspectSwingStock 遇到未完整涵蓋歷史的 archive，仍以 heuristic 還原缺漏事件", async () => {
  const result = await mod.inspectSwingStock(ARCHIVE_GAP);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.verdict.key, "midBandDefense");
  const warnings = scenarioWarnings(result);
  assert.ok(warnings.includes("近期疑似權息跳空(估算還原)"), `warnings=${JSON.stringify(warnings)}`);
  assert.ok(!warnings.includes("近期除權息(官方已還原)"), "archive 其他日期有資料，不能冒充缺口當日的官方證據");
});

test("inspectSwingStock：同日官方事件公式欄位 unresolved 時不提供型態結論", async () => {
  const result = await mod.inspectSwingStock(UNRESOLVED);
  assert.equal(result.ok, false, "不完整官方事件不得由 >10.5% 價差 heuristic 冒充可精算事件");
  assert.equal(result.retryable, true);
  assert.match(result.error, /公司行為.*未完整/);
  assert.equal(result.verdict, undefined, "unresolved 不能留下可被 UI 當成選股結論的 verdict");
  const exDateSlash = mod.compactToSlashDate(exDate);
  assert.ok((result.warnings || []).some((warning) => warning.includes(exDateSlash)), `warnings=${JSON.stringify(result.warnings)}`);
});

test("scanSwingBoard：官方／heuristic 兩種可解事件入選，unresolved 事件排除並計入品質原因", async () => {
  const reference = await mod.getReferenceData();
  const latestDate = mod.resolveMarketCloseDate(reference);
  const body = await mod.scanSwingBoard(reference, latestDate, "", 240);
  const codes = body.picks.map((pick) => pick.code);

  assert.ok(codes.includes(COMPLETE), `完整官方事件的對照檔應入選；codes=${JSON.stringify(codes)}`);
  assert.ok(codes.includes(ARCHIVE_GAP), `archive 缺漏但 heuristic 可解的對照檔應入選；codes=${JSON.stringify(codes)}`);
  assert.ok(!codes.includes(UNRESOLVED), `公式欄位 unresolved 不得進榜；codes=${JSON.stringify(codes)}`);
  assert.equal(body.scanQuality.failureReasons["corporate-action-unresolved"], 1);
  assert.equal(body.scanQuality.failedCount, 1);
  assert.equal(body.matchedCount, 2);
});
