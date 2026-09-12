// 事後 netR 使用完整貨幣損益及原始風險；不借用移停、價格 RR 或固定 2%。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { importServer } from '../helpers/test-server.mjs';
import { compactTradingDay } from '../helpers/fixtures.mjs';
const { mod, mock, dataDir } = await importServer();
after(async () => {
  await mod.shutdownServer(); mock.restore();
  assert.equal(dirname(resolve(dataDir)), resolve(tmpdir())); assert.match(basename(dataDir), /^stock1-test-/);
  await rm(dataDir, { recursive: true, force: true });
});
test('950／500＝1.9R，零損益合法、負損益保留；0／負／缺風險無 R', () => {
  assert.equal(typeof mod.calculateNetR,'function');
  assert.equal(mod.calculateNetR({netPnl:950,initialRiskCash:500}),1.9);
  assert.equal(mod.calculateNetR({netPnl:-950,initialRiskCash:500}),-1.9);
  assert.equal(mod.calculateNetR({netPnl:0,initialRiskCash:500}),0);
  for(const initialRiskCash of [0,-1,null,undefined,'',false,'500',NaN,Infinity])assert.equal(mod.calculateNetR({netPnl:950,initialRiskCash}),null);
  for(const netPnl of [null,undefined,'',false,'950',NaN,Infinity])assert.equal(mod.calculateNetR({netPnl,initialRiskCash:500}),null);
  assert.equal(mod.calculateNetR({netPnl:Number.MAX_VALUE,initialRiskCash:Number.MIN_VALUE}),null);
});
test('真公司行動與退出接線：分母原始 5 元不加成本，JSON 重開後保持一致', () => {
  const d0=compactTradingDay(-20),d1=compactTradingDay(-19),asOf=compactTradingDay(0);
  const identity=mod.currentVerificationIdentity('swing');
  const e={signalId:'one',captureId:'cash',identity,code:'2330',status:'pending',entry:100,stop:95,target:110,daysHeld:0,lastChecked:d0,
    holdingPosition:{date:d0,price:100,shares:1,originalStop:95,originalRiskMoney:5,source:'frozen-signal-price'},
    holdingEvents:[{id:'dividend',kind:'cash-dividend',exDate:d1,cashDividend:5,source:'fixture'}],holdingCoverage:[{date:d1,status:'complete'}]};
  mod.applySwingCorporateAction(e,0.95,d1);
  // 目標 104.5 是限價單，最高價要穿越才算成交（剛好等於只是排隊）；出場價仍是目標價
  mod.advanceSwingVerificationEntry(e,{rawDate:d1,open:100,high:104.6,low:99,price:104.5});
  assert.equal(e.holdingOutcome.netPnl,9.029);
  e.stop=103; // 移停與當前 entry 都不是分母證據。
  const population={models:[{identity,rows:[{signalId:'one',captureId:'cash',tradeDate:d0,status:'resolved',scenario:'case'}]}]};
  const db={swingVerification:{[d0]:[e]}};
  const calendar={tradingDays:Array.from({length:21},(_,i)=>compactTradingDay(-20+i))};
  const summary=db=>mod.summarizeMatureVerification(db,'swing',{asOf,calendar,population}).headline.costRisk;
  assert.ok(summary(db),'netR 必須接到正式成熟模型');
  assert.equal(summary(db).netR.value,1.8058);
  assert.deepEqual(summary(JSON.parse(JSON.stringify(db))),summary(db));
  delete e.holdingPosition.originalRiskMoney;
  assert.equal(summary(db).netR.value,null,'不得由已調整價格或 outcome 分母回補缺原始證據');
  assert.equal(summary(db).netR.missingReasons['initial-risk-cash-missing-or-invalid'],1);
  assert.equal(summary(db).costSensitivity.scenarios[0].returnPct.validCount,1,'缺風險不抹掉有效含息報酬');
  e.holdingPosition.originalRiskMoney=5;
  e.holdingOutcome={...e.holdingOutcome,netPnl:-10,holdingReturnPct:null,missingReasons:['multiple-cash-flow-return-undefined']};
  assert.equal(summary(db).netR.value,-2,'追加投入的完整淨損益仍能除原始風險');
  assert.equal(summary(db).costSensitivity.scenarios[0].returnPct.validCount,0,'多時點百分比未定義不能借價格報酬');
  e.holdingOutcome={...e.holdingOutcome,status:'unpriced',netPnl:0,holdingReturnPct:0};
  assert.equal(summary(db).netR.value,null,'不完整現金證據即使殘留數字也不採用');
});
