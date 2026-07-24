// 公司主檔共用 loader：發行股數與公司 meta 並發讀取時，每個市場端點只抓一次。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { importServer } from "../helpers/test-server.mjs";
import { twseCompanyProfileRow, tpexCompanyProfileRow } from "../helpers/fixtures.mjs";

let releaseRows;
const gate = new Promise((resolve) => { releaseRows = resolve; });
const { mod, mock, dataDir } = await importServer({
  routes: [
    {
      match: /openapi\.twse\.com\.tw\/v1\/opendata\/t187ap03_L/,
      reply: async () => {
        await gate;
        return [twseCompanyProfileRow({ code: "2330", name: "台積電", shares: 25932070992 })];
      },
    },
    {
      match: /tpex\.org\.tw\/openapi\/v1\/mopsfin_t187ap03_O/,
      reply: async () => {
        await gate;
        return [tpexCompanyProfileRow({ code: "5347", name: "世界", shares: 792361000 })];
      },
    },
  ],
});

after(async () => {
  releaseRows();
  mock.restore();
  await rm(dataDir, { recursive: true, force: true });
});

test("getIssuedShares／getCompanyMeta 共用 single-flight", async () => {
  const pending = Promise.all([
    mod.getIssuedShares(), mod.getCompanyMeta(), mod.getIssuedShares(), mod.getCompanyMeta(),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(mock.callsFor(/t187ap03_L/).length, 1);
    assert.equal(mock.callsFor(/mopsfin_t187ap03_O/).length, 1);
  } finally {
    releaseRows();
  }
  const [shares, meta] = await pending;
  assert.equal(shares.get("2330"), 25932070992);
  assert.equal(shares.get("5347"), 792361000);
  assert.deepEqual(meta.get("2330"), { industry: "半導體業", shortName: "台積電" });
  assert.deepEqual(meta.get("5347"), { industry: "半導體業", shortName: "世界" });
  await Promise.all([mod.getIssuedShares(), mod.getCompanyMeta()]);
  assert.equal(mock.callsFor(/t187ap03_L/).length, 1);
  assert.equal(mock.callsFor(/mopsfin_t187ap03_O/).length, 1);
});

