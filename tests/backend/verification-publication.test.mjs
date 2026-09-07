// 正式發布只取首次 canonical 完整清單；修訂、並發與磁碟失敗不得改寫原訊號。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { importServer, SERVER_PATH } from '../helpers/test-server.mjs';
import { surveillanceRoutes, fundamentalsRoutes, stockDayAllRow, tpexDailyCloseRow } from '../helpers/fixtures.mjs';
const { mod, dataDir, mock } = await importServer();
after(async () => { await mod.flushPersistence(); mock.restore(); await rm(dataDir, { recursive:true, force:true }); });
const body = (strategy, date = '2026-09-04', codes = ['2330']) => ({
  asOf: date, formulaVersion: strategy === 'swing' ? mod.SWING_FORMULA_VERSION : mod.OVERNIGHT_FORMULA_VERSION,
  generatedAt: '2026-09-07T02:00:00.000Z', coverage: { complete: true },
  requestScope: strategy === 'swing' ? { maxCandidates:240, scenarioKey:'', limit:40 } : { maxCandidates:260, maxPerGroup:20 },
  scanQuality: { candidateCount: codes.length, completedCount: codes.length, reliable:true, coverageRate:100 },
  sourceTimes: { twse:{ sourceAsOf:date, precision:'date', observedAt:'2026-09-05T00:00:00.000Z' } },
  picks: codes.map(code => ({code, name:code, exchange:'TWSE', scenario:{key:'midBandDefense'}, plan:{entry:100,structuralStop:95,target:110}})),
  groups: { strongContinuation: codes.map(code => ({code, exchange:'TWSE',group:'strongContinuation',price:100})) },
});
test('A 後到較多 B 只存 correction revision；正式 signalId、原計畫與 publishedAt 不變', async () => {
  const a = body('swing');
  const publish = b => mod.commitDbMutation(db => mod.publishVerification(db, 'swing', b)).then(mod.confirmVerificationPublication);
  const first = await publish(a);
  const original = structuredClone((await mod.loadDb()).swingVerification['20260904']);
  const b = body('swing', a.asOf, ['2330','1101']); b.picks[0].plan.entry = 200;
  const second = await publish(b);
  assert.equal(first.kind,'formal'); assert.equal(second.kind,'correction');
  assert.notEqual(first.captureId,second.captureId);
  assert.deepEqual((await mod.loadDb()).swingVerification['20260904'],original);
  assert.equal(original[0].originalEntry,100); assert.equal(original[0].publishedAt,first.publishedAt);
  assert.ok(original[0].signalId);
  assert.deepEqual(await publish(a),first,'重算相同輸入必須重用原發布');
});
test('小 scope、provisional 不搶正式；完整零訊號有效、全部失敗不得發布', () => {
  const db = {};
  const small = body('overnight'); small.requestScope.maxCandidates = 1;
  assert.equal(mod.publishVerification(db,'overnight',small).kind,'research');
  const provisional = body('overnight'); provisional.provisional = true;
  assert.equal(mod.publishVerification(db,'overnight',provisional).kind,'provisional');
  const failed = body('overnight'); failed.scanQuality.reliable = false;
  assert.equal(mod.publishVerification(db,'overnight',failed).kind,'provisional');
  const zero = body('overnight',small.asOf,[]);
  const formal = mod.publishVerification(db,'overnight',zero);
  assert.equal(formal.kind,'formal'); assert.equal(db.signalSnapshots.length,1);
  assert.equal(db.signalSnapshots[0].picks.length,0);
  assert.equal(formal.sourceTimes.twse.precision,'date');
  assert.equal(formal.sourceTimes.twse.observedAt,'2026-09-05T00:00:00.000Z');
  assert.ok(formal.publicationStartedAt >= zero.generatedAt,'週五資料週一才發布，不能補造週五可得時間');
  assert.equal(formal.publishedAt,null); assert.equal(formal.decisionAvailableAt,null);
});
test('提交跨09:00保留開始下界與可讀上界；並发時間補證不覆蓋已推進entry', async t => {
  const started=Date.parse('2026-09-07T00:59:59.999Z');
  t.mock.timers.enable({apis:['Date'],now:started});
  try {
    const source=body('swing','2026-08-28'); source.generatedAt=new Date(started-1000).toISOString();
    const a=await mod.commitDbMutation(db=>mod.publishVerification(db,'swing',source));
    assert.equal(a.publishedAt,null); assert.equal(a.decisionAvailableAt,null);
    assert.equal(a.publicationStartedAt,new Date(started).toISOString());
    t.mock.timers.setTime(started-1);
    assert.equal((await mod.confirmVerificationPublication(a)).publishedAt,null,'本機時鐘倒退不能補造早於下界的可得時間');
    t.mock.timers.setTime(started+2);
    await mod.commitDbMutation(db=>{const entry=db.swingVerification['20260828'][0];entry.lastChecked='20260901';entry.verificationRetry={reason:'keep'};});
    const [one,two]=await Promise.all([mod.confirmVerificationPublication(a),mod.confirmVerificationPublication(a)]);
    assert.equal(one.publishedAt,two.publishedAt);
    assert.equal(one.publicationTimePrecision,'confirmed-available-upper-bound');
    assert.equal(one.publishedAt,'2026-09-07T01:00:00.001Z');
    assert.equal(one.decisionAvailableAt,one.availableConfirmedAt);
    assert.equal(one.revision,a.revision,'補時間不是清單更正');
    const entry=(await mod.loadDb()).swingVerification['20260828'][0];
    assert.equal(entry.publishedAt,one.publishedAt); assert.equal(entry.lastChecked,'20260901');
    assert.deepEqual(entry.verificationRetry,{reason:'keep'});
    assert.equal(entry.originalEntry,100);
    t.mock.timers.setTime(started+1000);
    assert.equal((await mod.confirmVerificationPublication(one)).publishedAt,one.publishedAt,'已知確認上界永不更新');
  } finally {t.mock.timers.reset();}
});
test('逐檔未完成不得發布；可靠但降級可發布且揭露，不要求全候選都有足夠歷史', () => {
  const db = {}; const partial = body('swing','2026-09-02');
  partial.scanQuality = {candidateCount:10,completedCount:9,reliable:true,coverageRate:80};
  assert.equal(mod.publishVerification(db,'swing',partial).kind,'provisional');
  partial.scanQuality.completedCount=10;
  const published=mod.publishVerification(db,'swing',partial);
  assert.equal(published.kind,'formal'); assert.equal(published.degraded,true);
});
test('當日 legacy 單不阻擋新正式身份；每場景採前40，signalId 含市場與場景', () => {
 const db={swingVerification:{20260901:[{code:'2330',scenario:'midBandDefense',formulaVersion:mod.SWING_FORMULA_VERSION,status:'pending',entry:77}]}};
 const source=body('swing','2026-09-01',Array.from({length:42},(_,i)=>String(2330+i)));
 const capture=mod.publishVerification(db,'swing',source);
 assert.equal(capture.signals.length,40); assert.equal(db.swingVerification['20260901'].length,41);
 assert.equal(db.swingVerification['20260901'][0].entry,77);
 assert.equal(new Set(capture.signals.map(pick=>pick.signalId)).size,40);
 const reordered=JSON.parse(JSON.stringify(source)); reordered.generatedAt='2026-09-08T00:00:00.000Z';
 reordered.sourceTimes.twse.observedAt='2026-09-08T00:00:00.000Z';
 assert.equal(mod.publishVerification(db,'swing',reordered).captureId,capture.captureId,'重新取得相同內容不產生revision');
});
test('兩個並發發布只一份正式，B 寫入失敗 RAM/磁碟只見 A，重啟讀取與重試', async () => {
  const a = body('overnight','2026-09-03');
  const publish = b => mod.commitDbMutation(db => mod.publishVerification(db,'overnight',b));
  const [one,two] = await Promise.all([publish(a),publish(a)]);
  assert.equal(one.captureId,two.captureId);
  const before = structuredClone((await mod.loadDb()).verificationPublications);
  const b = body('overnight',a.asOf,['2330','1101']);
  const blocker = join(dataDir,'stock1-db.json.tmp'); await mkdir(blocker);
  await assert.rejects(publish(b),error => error.code === 'PERSISTENCE_FAILED');
  assert.deepEqual((await mod.loadDb()).verificationPublications,before);
  const disk = JSON.parse(await readFile(join(dataDir,'stock1-db.json'),'utf8'));
  assert.deepEqual(disk.verificationPublications,before);
  assert.equal(mod.publishVerification(disk,'overnight',a).captureId,one.captureId,'重啟以持久化狀態重算');
  await rm(blocker,{recursive:true});
  const restarted = JSON.parse(execFileSync(process.execPath, ['--input-type=module','-e',
    `const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)}); const db=await m.loadDb(); console.log(JSON.stringify(m.publishVerification(db,'overnight',JSON.parse(process.argv[1]))));`, JSON.stringify(a)],
    { env:{...process.env,PORT:'0',STOCK1_SKIP_LISTEN:'1',DATA_DIR:dataDir},encoding:'utf8' }).trim().split('\n').at(-1));
  assert.deepEqual(restarted,one,'真正冷行程載入不重發、不變更時間或身份');
  assert.equal((await publish(b)).kind,'correction');
});
test('兩 builder 真實 canonical 零候選發布；研究參數不搶身份，UI 場景/limit 共用 all scope', async () => {
  const removers = [...surveillanceRoutes({ reference:[stockDayAllRow({code:'0050',name:'ETF'})],tpexReference:[tpexDailyCloseRow({code:'00679B',name:'債ETF'})] }),
    ...fundamentalsRoutes({})].map(route => mock.override(route));
  try {
    const research = await mod.buildSwingBoard({maxCandidates:1,scenarioKey:'upperBandContinuation',limit:1});
    assert.equal(research.publication.kind,'research');
    const formal = await mod.buildSwingBoard({scenarioKey:'midBandDefense',limit:1});
    assert.equal(formal.publication.kind,'formal');
    assert.ok(formal.publication.availableConfirmedAt);
    assert.deepEqual(formal.publication.requestScope,{maxCandidates:240,scenarioKey:'',limit:40});
    const tab = await mod.buildSwingBoard({scenarioKey:'upperBandContinuation',limit:3});
    assert.equal(tab.publication.captureId,formal.publication.captureId);
    const refresh = await mod.buildSwingBoard({forceRefresh:true});
    assert.equal(refresh.publication.captureId,formal.publication.captureId,'手動 refresh 不另立正式身份');
    const narrow = await mod.buildOvernightSignals({maxCandidates:1});
    assert.equal(narrow.publication.kind,'research');
    const overnight = await mod.buildOvernightSignals();
    assert.equal(overnight.publication.kind,'formal');
    assert.equal(overnight.publication.signals.length,0);
    const historical = await mod.buildOvernightSignals({dateCompact:'20260102'});
    assert.equal(historical.publication,undefined,'歷史明確日期不回建當時發布');
  } finally { removers.forEach(remove => remove()); }
});
test('首次清單成功但時間補證失敗仍正式；冷啟動以本次真實確認時間補上，不回填', async () => {
  const a=await mod.commitDbMutation(db=>mod.publishVerification(db,'overnight',body('overnight','2026-08-27')));
  const blocker=join(dataDir,'stock1-db.json.tmp'); await mkdir(blocker);
  const failed=await mod.confirmVerificationPublication(a);
  assert.equal(failed.kind,'formal'); assert.equal(failed.publishedAt,null);
  assert.equal(failed.timingReason,'availability-not-confirmed');
  const disk=JSON.parse(await readFile(join(dataDir,'stock1-db.json'),'utf8'));
  assert.equal(disk.verificationPublications.captures[a.captureId].publishedAt,null);
  assert.equal((await mod.loadDb()).verificationPublications.captures[a.captureId].publishedAt,null);
  await rm(blocker,{recursive:true});
  const confirmed=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',
    `const m=await import(${JSON.stringify(pathToFileURL(SERVER_PATH).href)}); const db=await m.loadDb(); console.log(JSON.stringify(await m.confirmVerificationPublication(db.verificationPublications.captures[process.argv[1]])));`,a.captureId],
    {env:{...process.env,PORT:'0',STOCK1_SKIP_LISTEN:'1',DATA_DIR:dataDir,
      ...(process.env.STOCK1_DATE_SWEEP_AT ? {STOCK1_DATE_SWEEP_AT:new Date().toISOString()} : {})},encoding:'utf8'}).trim().split('\n').at(-1));
  assert.equal(confirmed.captureId,a.captureId); assert.equal(confirmed.revision,a.revision);
  assert.ok(confirmed.availableConfirmedAt >= a.publicationStartedAt);
  assert.equal(confirmed.timingReason,null);
  const persisted=JSON.parse(await readFile(join(dataDir,'stock1-db.json'),'utf8'));
  assert.equal(persisted.signalSnapshots.find(snapshot=>snapshot.captureId===a.captureId).publishedAt,confirmed.publishedAt);
});
