// 發布紀錄的 inputEvidence 與擷取清單的 outcomes 是同一份 260 列證據（實機逐位元組相同，每策略每天 177 KB），
// 而 server.mjs／app.js 沒有任何地方讀 publication.inputEvidence。單一副本留在 verificationCaptures[id].outcomes；
// 舊資料在 loadDb 時只有「與擷取清單逐位元組相同」的才剝掉（不同就保留，不猜）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { readCaptureOutcomes } from "../../verification-evidence.mjs";

const evidence = (n) => Array.from({ length: n }, (_, i) => ({ code: String(2330 + i), exchange: "TWSE", candidateRank: i + 1, outcome: "selected", observedAt: "2026-09-07T05:30:00.000Z" }));

// 先把一份「舊格式」DB 寫進臨時目錄：formal 的 inputEvidence 與 outcomes 相同、另一筆刻意不同。
const dataDir = await mkdtemp(join(tmpdir(), "stock1-dedupe-"));
const same = evidence(3);
const legacy = {
  verificationPublications: {
    current: { '{"strategy":"overnight","tradeDate":"2026-09-07"}': "cap-same" },
    captures: {
      "cap-same": { captureId: "cap-same", strategy: "overnight", tradeDate: "2026-09-07", kind: "formal", complete: true, inputFingerprint: "fp-1", inputEvidence: same, signals: [] },
      "cap-diff": { captureId: "cap-diff", strategy: "overnight", tradeDate: "2026-09-04", kind: "correction", complete: true, inputFingerprint: "fp-2", inputEvidence: evidence(2), signals: [] },
      "cap-orphan": { captureId: "cap-orphan", strategy: "swing", tradeDate: "2026-09-03", kind: "formal", complete: true, inputFingerprint: "fp-3", inputEvidence: evidence(1), signals: [] },
    },
  },
  verificationCaptures: {
    "cap-same": { captureId: "cap-same", strategy: "overnight", tradeDate: "2026-09-07", kind: "formal", fullRecord: true, canonical: true, inputFingerprint: "fp-1", candidates: [], outcomes: structuredClone(same), issued: [] },
    "cap-diff": { captureId: "cap-diff", strategy: "overnight", tradeDate: "2026-09-04", kind: "correction", fullRecord: true, canonical: true, inputFingerprint: "fp-2", candidates: [], outcomes: evidence(3), issued: [] },
  },
  swingSnapshots: { "20260907:all": { asOf: "2026-09-07", body: { formulaVersion: "swing-v22-net-rr-rank-tpex-exright", publication: { captureId: "cap-same", inputEvidence: structuredClone(same), signals: [] } } } },
};
await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify(legacy, null, 2));
const { mod } = await importServer({ routes: [], dataDir });

test("loadDb 遷移：與擷取清單相同的 inputEvidence 剝掉（含 swingSnapshots 內嵌的發布副本），不同或沒有擷取清單的保留，並落盤", async () => {
  const db = await mod.loadDb();
  const pubs = db.verificationPublications.captures;
  assert.equal(pubs["cap-same"].inputEvidence, undefined, "逐位元組相同 → 剝掉");
  assert.equal(pubs["cap-same"].inputEvidenceRef, "verificationCaptures.outcomes");
  assert.deepEqual(pubs["cap-diff"].inputEvidence, evidence(2), "與擷取清單不同 → 保留，不猜哪份對");
  assert.deepEqual(pubs["cap-orphan"].inputEvidence, evidence(1), "沒有擷取清單 → 保留");
  assert.deepEqual(readCaptureOutcomes(db.verificationCaptures["cap-same"]), same, "單一副本在擷取清單（載入時已壓成 outcomesBlob）");
  assert.equal(db.swingSnapshots["20260907:all"].body.publication.inputEvidence, undefined, "7 天快取裡的發布副本也剝掉");
  await mod.flushPersistence();
  const disk = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.equal(disk.verificationPublications.captures["cap-same"].inputEvidence, undefined, "遷移要落盤，不然每次啟動重做");
});

test("publishVerification：新發布不再把 inputEvidence 存進發布紀錄，證據只在擷取清單的 outcomes；同一份輸入再發布仍可重用", async () => {
  const db = await mod.loadDb();
  const body = {
    asOf: "2026-09-08", formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, provisional: false, generatedAt: "2026-09-08T07:00:00.000Z",
    coverage: { complete: true }, scanQuality: { reliable: true, candidateCount: 3, completedCount: 3, readyCount: 3, coverageRate: 100 },
    requestScope: mod.canonicalVerificationScope("overnight"), warnings: [], regime: null,
    candidatePool: evidence(3).map(({ code, exchange, candidateRank }) => ({ code, exchange, candidateRank, price: 100, source: "TWSE", sourceAsOf: "2026-09-08" })),
    inputEvidence: evidence(3), groups: { strongContinuation: [{ code: "2330", name: "台積電", exchange: "TWSE", group: "strongContinuation", price: 100 }] },
    sourceTimes: {}, markets: { twse: { asOf: "2026-09-08" }, tpex: { asOf: "2026-09-08" } },
  };
  const first = mod.publishVerification(db, "overnight", body);
  assert.equal(first.inputEvidence, undefined, "回傳值（會進 API 回應與 swingSnapshots）不再帶 260 列證據");
  const stored = db.verificationPublications.captures[first.captureId];
  assert.equal(stored.inputEvidence, undefined);
  assert.deepEqual(readCaptureOutcomes(db.verificationCaptures[first.captureId]), evidence(3), "擷取清單保有完整證據（packed；fullRecord 與否由 verificationScanAccounting 決定，不在本測試範圍）");
  const again = mod.publishVerification(db, "overnight", body);
  assert.equal(again.captureId, first.captureId, "指紋沒變 → 重用同一筆，不長出新 revision");
});
