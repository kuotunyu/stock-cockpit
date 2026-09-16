// 2026-09-16：候選池（candidates）與發布紀錄的正式訊號（signals）也壓成 blob——它們是主 DB 每天固定成長裡最大的兩塊
// （實機每策略每天 ≈15 KB＋≈58 KB），而每次 commitDbMutation 都整份 clone＋序列化。兩者都有執行期讀取端：
// 候選池基準 worker、交易計畫來源比對、時間補證、維運狀態；這裡鎖住 codec、啟動遷移、各讀取端與「回呼叫端仍是 inline」。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";
import { compactToday } from "../helpers/fixtures.mjs";
import {
  packCaptureCandidates, readCaptureCandidates, hasCaptureCandidates,
  packPublicationSignals, readPublicationSignals, writePublicationSignals, publicationSignalCount, unpackPublicationView,
} from "../../verification-evidence.mjs";

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const candidates = (n) => Array.from({ length: n }, (_, i) => ({
  code: String(1101 + i), exchange: i % 3 ? "TWSE" : "TPEx", candidateRank: i + 1, price: 50 + i, source: "TWSE OpenAPI",
  sourceAsOf: "2026-09-07", observedAt: "2026-09-07T05:30:00.000Z",
}));
const signals = (n) => Array.from({ length: n }, (_, i) => ({
  code: String(2301 + i), name: `股票${i}`, exchange: "TWSE", group: "strongContinuation", price: 100 + i, change: 1.5, unit: 12, total: 3400 + i,
  reasons: ["站上均線", "量能放大", "籌碼集中"], risks: [], chips: [{ key: "foreignNet", label: "外資買超", tone: "is-up" }],
  backtest: { winRate: 0.58, samples: 20 }, indicators: { ma5: 99, ma20: 95, bollMid: 97 },
  signalId: "a".repeat(63) + String(i % 10), plan: { entry: 100 + i, structuralStop: 95 + i, target: 110 + i, rr: 2.0 },
}));

test("codec：candidates／signals 壓縮後不到原來 1/4、解回逐位元組相同；inline 原樣回、沒有回 null、竄改要 throw；signalCount 不解壓", () => {
  const manifest = { captureId: "c1", candidates: candidates(260), outcomesBlob: { version: 1 } };
  const packed = packCaptureCandidates(manifest);
  assert.equal(packed.candidates, undefined);
  assert.equal(packed.candidatesBlob.rows, 260);
  assert.ok(bytes(packed.candidatesBlob) < bytes(manifest.candidates) / 4, `candidates ${bytes(packed.candidatesBlob)} vs ${bytes(manifest.candidates)}`);
  assert.deepEqual(readCaptureCandidates(packed), manifest.candidates);
  assert.strictEqual(packCaptureCandidates(packed), packed, "已 packed 不重壓");
  assert.deepEqual(readCaptureCandidates(manifest), manifest.candidates, "inline 原樣回");
  assert.equal(readCaptureCandidates({ captureId: "old" }), null, "沒記候選池 → null");
  assert.equal(readCaptureCandidates({ captureId: "null", candidates: null }), null);
  assert.deepEqual([hasCaptureCandidates(manifest), hasCaptureCandidates(packed), hasCaptureCandidates({ candidates: null }), hasCaptureCandidates(null)], [true, true, false, false]);
  const tampered = { ...packed, candidatesBlob: { ...packed.candidatesBlob, data: packed.candidatesBlob.data.slice(0, -8) + "AAAAAAAA" } };
  assert.throws(() => readCaptureCandidates(tampered), (error) => error.code === "CAPTURE_EVIDENCE_INVALID");

  const capture = { captureId: "p1", strategy: "swing", signals: signals(40) };
  const packedCapture = packPublicationSignals(capture);
  assert.equal(packedCapture.signals, undefined);
  assert.equal(packedCapture.signalsBlob.rows, 40);
  assert.equal(packedCapture.signalCount, 40);
  assert.ok(bytes(packedCapture) < bytes(capture) / 4, `signals ${bytes(packedCapture)} vs ${bytes(capture)}`);
  assert.deepEqual(readPublicationSignals(packedCapture), capture.signals);
  assert.deepEqual([publicationSignalCount(packedCapture), publicationSignalCount(capture), publicationSignalCount({ signalCount: 3 }), publicationSignalCount({})], [40, 40, 3, null]);
  assert.equal(capture.signals.length, 40, "不動原物件");
  const view = unpackPublicationView(packedCapture);
  assert.deepEqual(view, capture, "給 API 的視圖：signals inline、沒有 blob／signalCount，形狀跟以前一樣");
  const wrongRows = { ...packedCapture, signalsBlob: { ...packedCapture.signalsBlob, rows: 39 } };
  assert.throws(() => readPublicationSignals(wrongRows), (error) => error.code === "PUBLICATION_EVIDENCE_INVALID");
  // 就地改寫（時間補證）
  const draft = { ...packedCapture };
  const edited = readPublicationSignals(draft).map((signal) => ({ ...signal, availableConfirmedAt: "2026-09-07T06:00:00.000Z" }));
  writePublicationSignals(draft, edited);
  assert.equal(draft.signals, undefined);
  assert.notEqual(draft.signalsBlob.sha256, packedCapture.signalsBlob.sha256);
  assert.equal(readPublicationSignals(draft)[5].availableConfirmedAt, "2026-09-07T06:00:00.000Z");
});

// 舊格式 DB：inline candidates／signals、pending memo 內嵌的 capture 副本
const dataDir = await mkdtemp(join(tmpdir(), "stock1-evidence-"));
const oldCandidates = candidates(6);
const oldSignals = signals(3).map((signal, i) => ({ ...signal, signalId: "b".repeat(63) + String(i) }));
const manifest = {
  manifestVersion: 1, captureId: "cap-1", strategy: "overnight", tradeDate: "2026-09-07", kind: "formal", fullRecord: true, canonical: true,
  inputFingerprint: "fp-1", status: "complete", candidates: oldCandidates, outcomes: [], issued: oldSignals.map((s) => ({ signalId: s.signalId, code: s.code, exchange: "TWSE", scenario: s.group, fillRisk: null })),
  populationModels: [],
};
const publication = {
  captureId: "cap-1", publicationKey: "overnight:2026-09-07", strategy: "overnight", tradeDate: "2026-09-07", kind: "formal", complete: true, revision: 1,
  inputFingerprint: "fp-1", publicationStartedAt: "2026-09-07T05:40:00.000Z", publishedAt: null, decisionAvailableAt: null, availableConfirmedAt: null,
  publicationTimePrecision: "unknown", timingReason: "availability-not-confirmed", signals: oldSignals,
};
await writeFile(join(dataDir, "stock1-db.json"), JSON.stringify({
  verificationPublications: { current: { "overnight:2026-09-07": "cap-1" }, captures: { "cap-1": publication } },
  verificationCaptures: { "cap-1": manifest },
  verificationBenchmarks: { cursor: "", memos: { m1: { captureId: "cap-1", inputFingerprint: "fp-1", status: "pending", capture: structuredClone(manifest), observations: [], cursor: 0 } } },
}, null, 2));
const { mod } = await importServer({ routes: [], dataDir });

test("loadDb 遷移：擷取清單與 memo 內嵌 capture 的 candidates、發布紀錄的 signals 都壓成 blob，並落盤；第二次載入冪等", async () => {
  const db = await mod.loadDb();
  const stored = db.verificationCaptures["cap-1"];
  assert.equal(stored.candidates, undefined);
  assert.equal(stored.candidatesBlob.rows, 6);
  assert.deepEqual(readCaptureCandidates(stored), oldCandidates);
  assert.equal(db.verificationBenchmarks.memos.m1.capture.candidates, undefined, "pending memo 內嵌的 capture 副本也壓");
  assert.deepEqual(readCaptureCandidates(db.verificationBenchmarks.memos.m1.capture), oldCandidates);
  const record = db.verificationPublications.captures["cap-1"];
  assert.equal(record.signals, undefined);
  assert.equal(record.signalsBlob.rows, 3);
  assert.equal(record.signalCount, 3);
  assert.deepEqual(readPublicationSignals(record), oldSignals);
  await mod.flushPersistence();
  const disk = JSON.parse(await readFile(join(dataDir, "stock1-db.json"), "utf8"));
  assert.ok(disk.verificationCaptures["cap-1"].candidatesBlob && disk.verificationPublications.captures["cap-1"].signalsBlob, "遷移要落盤");
  assert.equal(mod.packStoredCaptureEvidence(structuredClone(disk)), false, "已 packed 的 DB 再跑一次遷移不改任何東西");
});

test("交易計畫來源比對讀 packed 的發布紀錄；blob 壞掉視同來源不符（PLAN_SOURCE_INVALID），不是 500", async () => {
  const db = await mod.loadDb();
  const identity = { code: "2301", exchange: "TWSE", strategy: "overnight", scenario: "strongContinuation", signalId: oldSignals[0].signalId, sourceCaptureId: "cap-1" };
  const source = mod.resolveTradePlanSource(identity, db);
  assert.equal(source.captureId, "cap-1");
  assert.equal(source.verification, "verified-local");
  assert.equal(source.capturedReference.price, 100);
  assert.equal(mod.resolveTradePlanSource({ ...identity, signalId: null, sourceCaptureId: null }, db), null, "手動計畫沒有來源");
  assert.throws(() => mod.resolveTradePlanSource({ ...identity, code: "9999" }, db), (error) => error.code === "PLAN_SOURCE_INVALID");
  const broken = structuredClone(db);
  broken.verificationPublications.captures["cap-1"].signalsBlob.data = broken.verificationPublications.captures["cap-1"].signalsBlob.data.slice(0, -8) + "AAAAAAAA";
  assert.throws(() => mod.resolveTradePlanSource(identity, broken), (error) => error.code === "PLAN_SOURCE_INVALID");
});

test("時間補證（confirmVerificationPublication）解回 signals 補時間再壓回；DB 仍是 packed、回呼叫端是 inline", async () => {
  const before = (await mod.loadDb()).verificationPublications.captures["cap-1"];
  assert.equal(before.availableConfirmedAt, null);
  const confirmed = await mod.confirmVerificationPublication(before);
  assert.ok(confirmed.availableConfirmedAt, "補上可讀上界");
  assert.equal(confirmed.signalsBlob, undefined, "回呼叫端的是 inline 視圖");
  assert.equal(confirmed.signals.length, 3);
  assert.ok(confirmed.signals.every((signal) => signal.availableConfirmedAt === confirmed.availableConfirmedAt), "每筆訊號也補了時間");
  const after = (await mod.loadDb()).verificationPublications.captures["cap-1"];
  assert.equal(after.signals, undefined, "DB 裡仍是 packed");
  assert.equal(after.signalCount, 3);
  assert.ok(readPublicationSignals(after).every((signal) => signal.availableConfirmedAt === confirmed.availableConfirmedAt));
  assert.deepEqual(await mod.confirmVerificationPublication(after), confirmed, "已補證：原樣回、不重寫");
});

test("維運狀態與候選池基準只用 helper：真實發布（DB 存 packed）後 signalCount 不解壓、有 candidatesBlob 的 manifest 仍算有候選池", () => {
  const today = compactToday();
  const iso = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  const db = {};
  const pool = candidates(4).map((c) => ({ ...c, sourceAsOf: iso }));
  const picks = pool.slice(0, 2).map((c) => ({ code: c.code, name: `股票${c.code}`, exchange: c.exchange, group: "strongContinuation", price: c.price }));
  const publication = mod.publishVerification(db, "overnight", {
    asOf: iso, formulaVersion: mod.OVERNIGHT_FORMULA_VERSION, provisional: false, generatedAt: `${iso}T07:00:00.000Z`,
    requestScope: mod.canonicalVerificationScope("overnight"), coverage: { complete: true, markets: { twse: { asOf: iso }, tpex: { asOf: iso } } },
    scanQuality: { reliable: true, candidateCount: 4, completedCount: 4, readyCount: 4, coverageRate: 100 },
    candidatePool: pool, inputEvidence: pool.map((c) => ({ code: c.code, exchange: c.exchange, candidateRank: c.candidateRank, outcome: "selected" })),
    groups: { strongContinuation: picks }, warnings: [], regime: null, sourceTimes: {}, markets: { twse: { asOf: iso }, tpex: { asOf: iso } },
  });
  assert.equal(publication.signals.length, 2, "回呼叫端 inline");
  const record = db.verificationPublications.captures[publication.captureId];
  assert.equal(record.signals, undefined);
  assert.equal(record.signalsBlob.rows, 2);
  const status = mod.summarizeOperationalStatus(db, { today });
  assert.equal(status.captures.overnight.today.status, "published");
  assert.equal(status.captures.overnight.today.signalCount, 2, "數量直接讀 blob rows，不解壓");
  const authoritative = mod.authoritativeBenchmarkCaptures(db, "overnight");
  assert.equal(authoritative.length, 1, "有 candidatesBlob 的正式 manifest 仍是候選池基準的母體");
  assert.deepEqual(readCaptureCandidates(authoritative[0]).map((c) => c.code), pool.map((c) => c.code));
});
