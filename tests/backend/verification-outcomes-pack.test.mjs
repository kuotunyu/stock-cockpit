// 擷取清單的逐檔終端結果（outcomes，260 列 ≈ 177 KB／策略／日）在執行期沒有讀取端、只是稽核證據，
// 但每次 commitDbMutation 整份序列化都在付它的成本。壓成 outcomesBlob（deflate＋sha256，同 memo 的 codec），
// 新發布直接 packed、舊資料啟動時遷移；讀取走 readCaptureOutcomes，竄改要能被抓到。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { packCaptureOutcomes, readCaptureOutcomes } from "../../verification-evidence.mjs";

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const rows = (n) => Array.from({ length: n }, (_, i) => ({
  code: String(1101 + i), exchange: i % 3 ? "TWSE" : "TPEx", candidateRank: i + 1, price: 50 + i, source: "TWSE OpenAPI",
  sourceAsOf: "2026-09-07", observedAt: "2026-09-07T05:30:00.000Z", outcome: i % 7 ? "condition-not-met" : "selected",
  sourceEvidence: { official: [{ month: "202609", status: "ok", rows: 5 }, { month: "202608", status: "ok", rows: 21 }], fallback: { status: "not-needed" } },
  failedMonths: [], historyFingerprint: "a".repeat(64), corporateActionsFingerprint: "b".repeat(64), issuedShares: 1000000 + i,
}));

test("codec：260 列壓縮後不到原來 1/4、解回逐位元組相同；inline 原樣回、沒有證據回 null、竄改要 throw", () => {
  const manifest = { captureId: "c1", inputFingerprint: "fp", candidates: [], outcomes: rows(260) };
  const packed = packCaptureOutcomes(manifest);
  assert.equal(packed.outcomes, undefined);
  assert.equal(packed.outcomesBlob.rows, 260);
  assert.equal(packed.outcomesBlob.rawBytes, bytes(manifest.outcomes));
  assert.ok(bytes(packed) < bytes(manifest) / 4, `packed ${bytes(packed)} vs raw ${bytes(manifest)}`);
  assert.deepEqual(manifest.outcomes.length, 260, "不動原物件");
  assert.deepEqual(readCaptureOutcomes(packed), manifest.outcomes);
  assert.strictEqual(packCaptureOutcomes(packed), packed, "已 packed 不重壓");
  assert.deepEqual(readCaptureOutcomes(manifest), manifest.outcomes, "inline 原樣回");
  assert.equal(readCaptureOutcomes({ captureId: "old" }), null, "舊 manifest 沒有證據 → null");
  const tampered = { ...packed, outcomesBlob: { ...packed.outcomesBlob, data: packed.outcomesBlob.data.slice(0, -8) + "AAAAAAAA" } };
  assert.throws(() => readCaptureOutcomes(tampered), (error) => error.code === "CAPTURE_EVIDENCE_INVALID");
  const wrongRows = { ...packed, outcomesBlob: { ...packed.outcomesBlob, rows: 259 } };
  assert.throws(() => readCaptureOutcomes(wrongRows), (error) => error.code === "CAPTURE_EVIDENCE_INVALID");
});

// 舊格式 DB：inline outcomes＋發布紀錄的相同副本＋pending memo 內嵌的 capture
const dataDir = await mkdtemp(join(tmpdir(), "stock1-outcomes-"));
const same = rows(4);
const manifest = { captureId: "cap-1", strategy: "overnight", tradeDate: "2026-09-07", kind: "formal", fullRecord: true, canonical: true, inputFingerprint: "fp-1", candidates: [{ code: "1101", exchange: "TWSE" }], outcomes: structuredClone(same), issued: [] };
await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify({
  verificationPublications: { current: { k: "cap-1" }, captures: { "cap-1": { captureId: "cap-1", strategy: "overnight", tradeDate: "2026-09-07", kind: "formal", complete: true, inputFingerprint: "fp-1", inputEvidence: structuredClone(same), signals: [] } } },
  verificationCaptures: { "cap-1": manifest },
  verificationBenchmarks: { cursor: "", memos: { m1: { captureId: "cap-1", inputFingerprint: "fp-1", status: "pending", capture: structuredClone(manifest), observations: [], cursor: 0 } } },
}, null, 2));
const { mod } = await importServer({ routes: [], dataDir });

test("loadDb 遷移：先剝發布紀錄的相同副本（比對認得兩種格式），再把擷取清單與 memo 內嵌 capture 的 outcomes 壓成 blob，並落盤", async () => {
  const db = await mod.loadDb();
  const stored = db.verificationCaptures["cap-1"];
  assert.equal(stored.outcomes, undefined);
  assert.equal(stored.outcomesBlob.rows, 4);
  assert.deepEqual(readCaptureOutcomes(stored), same);
  assert.equal(db.verificationPublications.captures["cap-1"].inputEvidence, undefined, "剝除比對要能讀 packed 的擷取清單");
  assert.equal(db.verificationBenchmarks.memos.m1.capture.outcomes, undefined, "pending memo 內嵌的 capture 副本也壓");
  assert.deepEqual(readCaptureOutcomes(db.verificationBenchmarks.memos.m1.capture), same);
  assert.deepEqual(stored.candidates, [{ code: "1101", exchange: "TWSE" }], "candidates 有執行期讀取端，維持 inline");
  await mod.flushPersistence();
  const disk = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.ok(disk.verificationCaptures["cap-1"].outcomesBlob, "遷移要落盤");
  assert.equal(disk.verificationCaptures["cap-1"].outcomes, undefined);
});

test("publishVerification：新發布的擷取清單直接是 packed，讀回等於輸入證據", async () => {
  const db = await mod.loadDb();
  const inputEvidence = rows(5);
  const body = {
    asOf: "2026-09-08", formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, provisional: false, generatedAt: "2026-09-08T07:00:00.000Z",
    coverage: { complete: true }, scanQuality: { reliable: true, candidateCount: 5, completedCount: 5, readyCount: 5, coverageRate: 100 },
    requestScope: mod.canonicalVerificationScope("overnight"), warnings: [], regime: null,
    candidatePool: inputEvidence.map(({ code, exchange, candidateRank, price }) => ({ code, exchange, candidateRank, price, source: "TWSE", sourceAsOf: "2026-09-08" })),
    inputEvidence, groups: { strongContinuation: [{ code: "1101", name: "台泥", exchange: "TWSE", group: "strongContinuation", price: 50 }] },
    sourceTimes: {}, markets: { twse: { asOf: "2026-09-08" }, tpex: { asOf: "2026-09-08" } },
  };
  const publication = mod.publishVerification(db, "overnight", body);
  const stored = db.verificationCaptures[publication.captureId];
  assert.equal(stored.outcomes, undefined);
  assert.equal(stored.outcomesBlob.rows, 5);
  assert.deepEqual(readCaptureOutcomes(stored), inputEvidence);
});
