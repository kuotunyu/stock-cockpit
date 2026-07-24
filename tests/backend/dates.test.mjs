// 日期工具：ROC（民國）與西元互轉、跨月／跨年運算、天數差。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { importServer, SERVER_PATH } from "../helpers/test-server.mjs";

const { mod } = await importServer();
const {
  toTaipeiCompactDate, toCompactDate, compactToIsoDate, compactToSlashDate,
  compactToRocSlashDate, addMonthsCompact, addDaysCompact, compactDaysDiff,
} = mod;

test("toCompactDate：民國 7 碼 +1911", () => {
  assert.equal(toCompactDate("1150612"), "20260612");
  assert.equal(toCompactDate("1150101"), "20260101");
});

test("toCompactDate：ISO／斜線／民國斜線／Date 物件", () => {
  assert.equal(toCompactDate("2026-06-12"), "20260612");
  assert.equal(toCompactDate("2026/06/12"), "20260612");
  assert.equal(toCompactDate("115/06/12"), "20260612");
  assert.equal(toCompactDate(new Date("2026-06-11T16:00:00Z")), "20260612");
  assert.equal(toCompactDate("20260612"), "20260612"); // 已是 compact → 原樣
});

test("toTaipeiCompactDate：台北午夜與跨年邊界", () => {
  assert.equal(toTaipeiCompactDate("2026-07-12T15:59:59Z"), "20260712");
  assert.equal(toTaipeiCompactDate("2026-07-12T16:00:00Z"), "20260713");
  assert.equal(toTaipeiCompactDate("2026-12-31T16:00:00Z"), "20270101");
  assert.equal(toTaipeiCompactDate("not-a-date"), "");
});

test("台北日期與純日曆位移不受主機 TZ 影響", () => {
  const moduleUrl = pathToFileURL(SERVER_PATH).href;
  const script = `
    process.env.STOCK1_SKIP_LISTEN = "1";
    const mod = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify({
      day: mod.toTaipeiCompactDate("2026-07-12T16:30:00Z"),
      next: mod.addDaysCompact("20260713", 1),
      month: mod.addMonthsCompact("20261231", 1),
    }));
  `;
  for (const TZ of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ }, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(child.status, 0, `${TZ}: ${child.stderr}`);
    assert.deepEqual(JSON.parse(child.stdout), { day: "20260713", next: "20260714", month: "20270101" }, TZ);
  }
});

test("toCompactDate：無效輸入不炸（特徵化）", () => {
  // 只固定「不丟例外、不回合法日期」的行為，避免過度指定實作細節。
  for (const bad of ["", null, undefined, "abc"]) {
    const out = toCompactDate(bad);
    assert.ok(!/^\d{8}$/.test(String(out ?? "")) || bad === undefined,
      `無效輸入 ${JSON.stringify(bad)} 不應該變出合法日期（got ${out}）`);
  }
});

test("compactTo* 轉換", () => {
  assert.equal(compactToIsoDate("20260612"), "2026-06-12");
  assert.equal(compactToSlashDate("20260612"), "2026/06/12");
  assert.equal(compactToRocSlashDate("20260612"), "115/06/12");
});

test("addDaysCompact：跨月／跨年／閏年", () => {
  assert.equal(addDaysCompact("20261231", 1), "20270101");
  assert.equal(addDaysCompact("20260301", -1), "20260228"); // 2026 非閏年
  assert.equal(addDaysCompact("20240301", -1), "20240229"); // 2024 閏年
});

test("addMonthsCompact：回目標月份 1 號（供 STOCK_DAY 逐月分頁用），含跨年", () => {
  // 設計行為：無論輸入哪一天，一律回該月 1 號（YYYYMM01）。
  assert.equal(addMonthsCompact("20251215", 2), "20260201");
  assert.equal(addMonthsCompact("20260115", -2), "20251101");
  assert.equal(addMonthsCompact("20260115", 0), "20260101");
});

test("compactDaysDiff：正負與無效", () => {
  assert.equal(compactDaysDiff("20260702", "20260704"), 2);
  assert.equal(compactDaysDiff("20260704", "20260702"), -2);
  assert.equal(compactDaysDiff("20260702", "20260702"), 0);
  assert.equal(compactDaysDiff("", "20260702"), null);
  assert.equal(compactDaysDiff("20260702", "garbage"), null);
});

test("compactDaysDiff：接受民國輸入（內部先正規化）", () => {
  assert.equal(compactDaysDiff("1150612", "1150626"), 14);
});
