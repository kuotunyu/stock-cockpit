// D-30：驗證單要記下「這筆訊號成立當時，這檔是怎麼撮合的」。
// 處置期間是分盤集合競價（每 5 或 20 分鐘撮合一次），日 K 的最高／最低價只是幾十次撮合的
// 極值，掛在停損／目標的單未必真的撮得到——觸價判定隱含的「連續競價」前提在這些樣本上不成立。
// 本批刻意**不改判定口徑**（那要另外決策），只把事實記進樣本並讓它數得出來。
// 沒有這一欄的話，使用者就算在「更多→風險規則」關掉處置股，成績單也過濾不掉它們。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";

const { mod, mock, dataDir } = await importServer({ routes: [] });
after(async () => {
  mock.restore();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const pick = (code, surveillance) => ({
  code,
  name: `測試${code}`,
  scenario: { key: "midBandDefense" },
  score: 70,
  plan: { entry: 100, structuralStop: 95, target: 110, rr: 2 },
  surveillance,
});

const body = (picks) => ({
  asOf: "2026-07-24",
  formulaVersion: mod.SWING_FORMULA_VERSION,
  picks,
  provisional: false,
  coverage: { complete: true },
});

test("swingVerificationFillModel：只有處置才是分盤，間隔拿不到時仍要標成分盤", () => {
  assert.equal(mod.swingVerificationFillModel(null), "continuous");
  assert.equal(mod.swingVerificationFillModel({ kind: "attention", label: "注意" }), "continuous");
  assert.equal(mod.swingVerificationFillModel({ kind: "changed", label: "全額交割" }), "continuous",
    "全額交割是預收款券，撮合方式仍是連續競價");
  assert.equal(mod.swingVerificationFillModel({ kind: "disposition", interval: 5 }), "periodicCall5");
  assert.equal(mod.swingVerificationFillModel({ kind: "disposition", interval: 20 }), "periodicCall20");
  // 看板沒熱時拿不到間隔，但「是處置」這件事已經確定，不可退回 continuous。
  assert.equal(mod.swingVerificationFillModel({ kind: "disposition", interval: null }), "periodicCall");
});

test("建立驗證單時保存 surveillance 與 fillModel", async () => {
  const db = { swingVerification: {} };
  mod.recordSwingVerification(db, body([
    pick("1111", null),
    pick("2222", { kind: "disposition", label: "處置", interval: 20 }),
    pick("3333", { kind: "attention", label: "注意" }),
  ]));
  const list = db.swingVerification["20260724"];
  assert.equal(list.length, 3);
  const byCode = Object.fromEntries(list.map((entry) => [entry.code, entry]));

  assert.equal(byCode["1111"].surveillance, null);
  assert.equal(byCode["1111"].fillModel, "continuous");

  assert.deepEqual(byCode["2222"].surveillance, { kind: "disposition", label: "處置", interval: 20 });
  assert.equal(byCode["2222"].fillModel, "periodicCall20");

  assert.equal(byCode["3333"].surveillance.kind, "attention");
  assert.equal(byCode["3333"].fillModel, "continuous");
});

test("只保存判定用得到的欄位，不整包塞進不可回溯的歷史樣本", async () => {
  const db = { swingVerification: {} };
  mod.recordSwingVerification(db, body([
    pick("4444", { kind: "disposition", label: "處置", interval: 5, note: "分盤・預收", startSlash: "07/01", 巨大欄位: "x".repeat(500) }),
  ]));
  const entry = db.swingVerification["20260724"][0];
  assert.deepEqual(Object.keys(entry.surveillance).sort(), ["interval", "kind", "label"]);
});

test("成績單要數得出分盤樣本，但勝率口徑不變", async () => {
  const db = await mod.loadDb();
  db.swingVerification = {
    20260701: [
      // 三筆連續競價：2 勝 1 敗
      { code: "1111", scenario: "midBandDefense", status: "win", resultPct: 5, daysHeld: 3, entry: 100, stop: 95, target: 110, lastChecked: "20260703", formulaVersion: mod.SWING_FORMULA_VERSION, fillModel: "continuous" },
      { code: "2222", scenario: "midBandDefense", status: "win", resultPct: 4, daysHeld: 2, entry: 100, stop: 95, target: 110, lastChecked: "20260703", formulaVersion: mod.SWING_FORMULA_VERSION, fillModel: "continuous" },
      { code: "3333", scenario: "midBandDefense", status: "loss", resultPct: -5, daysHeld: 1, entry: 100, stop: 95, target: 110, lastChecked: "20260702", formulaVersion: mod.SWING_FORMULA_VERSION, fillModel: "continuous" },
      // 一筆分盤撮合，已結案
      { code: "4444", scenario: "midBandDefense", status: "loss", resultPct: -5, daysHeld: 1, entry: 100, stop: 95, target: 110, lastChecked: "20260702", formulaVersion: mod.SWING_FORMULA_VERSION, fillModel: "periodicCall20", surveillance: { kind: "disposition", label: "處置", interval: 20 } },
      // 一筆分盤撮合，還沒結案
      { code: "5555", scenario: "midBandDefense", status: "pending", resultPct: null, daysHeld: 1, entry: 100, stop: 95, target: 110, lastChecked: "20260702", formulaVersion: mod.SWING_FORMULA_VERSION, fillModel: "periodicCall5", surveillance: { kind: "disposition", label: "處置", interval: 5 } },
      // 舊紀錄完全沒有 fillModel 欄位 → 不得追溯改寫成分盤
      { code: "6666", scenario: "midBandDefense", status: "win", resultPct: 3, daysHeld: 2, entry: 100, stop: 95, target: 110, lastChecked: "20260703", formulaVersion: mod.SWING_FORMULA_VERSION },
    ],
  };
  await mod.saveDb(db);
  const summary = await mod.buildSwingVerificationSummary();
  const s = summary.scenarios.find((item) => item.scenario === "midBandDefense");

  assert.equal(summary.periodicCallCount, 2, "分盤樣本共 2 筆（含未結案）");
  assert.equal(s.periodicCallSamples, 2);
  assert.equal(s.periodicCallResolved, 1, "已結案的分盤樣本只有 1 筆");

  // 勝率口徑不變：5 筆結案（3 勝 2 敗），分盤那筆照樣計入。
  assert.equal(s.resolved, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 2);

  assert.match(summary.notes.join(" "), /分盤集合競價/, "必須明講這些樣本的撮合前提不同");
  assert.match(summary.notes.join(" "), /仍計入上面的勝率/, "也要說清楚目前沒有把它們排除");
});
