// 交易帳本 v1→v2 冷啟動遷移、備份、rev 與冪等持久化契約。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

test("loadDb：v1 交易帳本遷移前先留每日備份、rev 只遞增一次並持久化 v2", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "stock1-trades-migrate-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });
  await mkdir(join(dataDir, "backups"), { recursive: true });
  const legacyDb = {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    users: [{
      id: "u_trade",
      username: "trade-user",
      displayName: "Trade User",
      role: "user",
      passwordHash: "not-used-by-this-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    sessions: [],
    watchLists: { u_trade: { 1: [], 2: [], 3: [] } },
    priceAlerts: {},
    trades: {
      u_trade: {
        settings: { feeDiscount: 0.6, minFee: 20 },
        records: [{
          id: "legacy-trade",
          code: "2330",
          side: "buy",
          kind: "stock",
          date: "20260701",
          price: 100,
          shares: 1000,
          fee: 86,
          tax: 0,
        }],
      },
    },
    dataRevs: { u_trade: { trades: 5 } },
    brokerCredentials: {},
    swingSnapshots: {},
    swingVerification: {},
  };
  await writeFile(join(dataDir, "stock1-db.json"), `${JSON.stringify(legacyDb, null, 2)}\n`, "utf8");

  const { mod } = await importServer({ routes: [], dataDir });
  const loaded = await mod.loadDb();
  assert.equal(loaded.trades.u_trade.schemaVersion, 2);
  assert.equal(loaded.trades.u_trade.records[0].fee, 86);
  assert.equal(loaded.trades.u_trade.records[0].feeSource, "legacy");
  assert.equal(loaded.dataRevs.u_trade.trades, 6, "schema migration 必須讓舊分頁的 rev 失效");

  const persisted = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.equal(persisted.trades.u_trade.schemaVersion, 2);
  assert.equal(persisted.dataRevs.u_trade.trades, 6);
  const backups = (await readdir(join(dataDir, "backups"))).filter((name) => /^stock1-db-\d{8}\.json$/.test(name));
  assert.equal(backups.length, 1, "遷移寫入前必須先留一份不可覆寫的每日 rollback point");
  const backup = JSON.parse(await readFile(join(dataDir, "backups", backups[0]), "utf8"));
  assert.equal(backup.trades.u_trade.schemaVersion, undefined, "備份必須保留真正的 v1 原檔");
  assert.equal(backup.dataRevs.u_trade.trades, 5);

  const loadedAgain = await mod.loadDb();
  assert.equal(loadedAgain.dataRevs.u_trade.trades, 6, "同一份 v2 不得重複遷移或再 bump rev");
});
