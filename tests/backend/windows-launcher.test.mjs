// Windows 啟動器只在相依契約成立且本次子程序 ready 後開頁；失敗與關閉必須停止 writer。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
const launcher = await import('../../scripts/start-local.mjs').catch(() => ({}));
const dirs = [];
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'stock1-launcher-')); dirs.push(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ engines: { node: '^22.13.0 || >=24.0.0' }, dependencies: { demo: '^1.0.0' }, devDependencies: { devtool: '1.0.0' } }));
  const lock = { lockfileVersion: 3, packages: { '': { dependencies: { demo: '^1.0.0' }, devDependencies: { devtool: '1.0.0' } }, 'node_modules/demo': { version: '1.0.0', integrity: 'fixture' }, 'node_modules/devtool': { version: '1.0.0', dev: true } } };
  await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lock));
  return dir;
}
async function install(dir, dev = false) {
  await mkdir(join(dir, 'node_modules/demo'), { recursive: true });
  await writeFile(join(dir, 'node_modules/demo/package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules/demo/index.js'), 'module.exports = 1;');
  await writeFile(join(dir, 'node_modules/demo/inner.js'), 'module.exports = 2;');
  if (dev) { await mkdir(join(dir, 'node_modules/devtool'), { recursive: true }); await writeFile(join(dir, 'node_modules/devtool/package.json'), '{"version":"1.0.0"}'); }
  await writeFile(join(dir, 'node_modules/.package-lock.json'), await readFile(join(dir, 'package-lock.json')));
}
test('Node 支援保留 22.13 起的 22.x 及 24+，拒絕 20／22.12／23 與預發版', () => {
  assert.equal(typeof launcher.supportsRuntimeNode, 'function');
  for (const version of ['22.13.0', '22.22.2', '24.0.0', '25.0.0', '26.0.0']) assert.equal(launcher.supportsRuntimeNode(version), true, version);
  for (const version of ['20.20.0', '22.12.0', '23.9.0', '24.0.0-rc.1']) assert.equal(launcher.supportsRuntimeNode(version), false, version);
});

async function serverFixture(settings = '') {
  const dir = await fixture();
  for (const file of ['server.mjs', 'portfolio-risk.js', 'verification-evidence.mjs', 'app.js']) await cp(resolve(file), join(dir, file));
  await writeFile(join(dir, '.env'), `PORT=0\nHOST=127.0.0.1\nDATA_DIR=${join(dir, 'data').replaceAll('\\', '/')}\nUPDATE_CHECK=off\nADMIN_PASSWORD=test-admin-password\nAPP_SECRET=test-app-secret-with-at-least-32-characters\n${settings}`);
  await writeFile(join(dir, 'offline.mjs'), `globalThis.fetch = () => { throw new Error('offline fixture'); };`);
  return dir;
}
function isolatedSpawn(record) {
  return (executable, args, options) => {
    const env = { ...process.env };
    for (const key of ['PORT','HOST','DATA_DIR','DB_PATH','STOCK1_SKIP_LISTEN','NODE_ENV','NODE_TEST_CONTEXT','PUBLIC_ORIGIN','SCHEDULER','ADMIN_PASSWORD','APP_SECRET','ENCRYPTION_KEY','UPDATE_CHECK','NODE_OPTIONS']) delete env[key];
    const child = spawn(executable, ['--import', pathToFileURL(join(options.cwd, 'offline.mjs')).href, ...args], { ...options, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    record.child = child; record.args = args; record.output = '';
    child.stdout.on('data', chunk => { record.output += chunk; }); child.stderr.on('data', chunk => { record.output += chunk; });
    return child;
  };
}
test('真入口讀隔離 .env，用本次 instance 的 health ready 才開實際 port；保留排程與安全關機', { timeout: 15000 }, async () => {
  assert.equal(typeof launcher.startLocalServer, 'function');
  const dir = await serverFixture(); const record = {}; const opened = [];
  const session = await launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn(record), openBrowser: async url => { const health = await (await fetch(`${url}api/health`)).json(); opened.push({ url, health }); } });
  try {
    assert.equal(opened.length, 1); assert.notEqual(new URL(session.url).port, '0');
    assert.equal(opened[0].health.instanceId, session.instanceId); assert.equal(opened[0].health.status, 'ready');
    assert.match(record.output, /收盤排程已啟動/); assert.ok(record.args.includes('--env-file-if-exists=.env'));
    const version = await (await fetch(`${session.url}api/app-version`)).json(); assert.equal(version.identity.restartRequired, false);
  } finally { await session.stop(); }
  assert.equal(record.child.exitCode, 0); await assert.rejects(fetch(session.url, { signal: AbortSignal.timeout(500) }));
  const again = await launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn({}), openBrowser: async () => {} }); await again.stop();
});
test('占用 port 的其他 health 不能當 ready；初始化失敗與安全門檻失敗都不開頁', { timeout: 15000 }, async () => {
  assert.equal(typeof launcher.startLocalServer, 'function');
  const occupied = createServer((req, res) => res.end('{"ok":true,"status":"ready"}')); await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  let opened = 0;
  try {
    for (const [settings, expected] of [[`PORT=${occupied.address().port}\n`, /EADDRINUSE/], ['DB_PATH=outside-data.json\n', /DB_PATH/], ['NODE_ENV=production\nAPP_SECRET=\n', /APP_SECRET/]]) {
      const dir = await serverFixture(settings); const record = {};
      await assert.rejects(launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn(record), openBrowser: async () => { opened++; }, readyTimeoutMs: 3000 }), /啟動|就緒/);
      assert.notEqual(record.child.exitCode, null);
      assert.notEqual(record.child.exitCode, 0);
      assert.match(record.output, expected);
    }
  } finally { await new Promise(resolve => occupied.close(resolve)); }
  assert.equal(opened, 0);
});
test('IPC 斷線等同啟動器視窗關閉，child 排空並釋放 writer lease', { timeout: 15000 }, async () => {
  assert.equal(typeof launcher.startLocalServer, 'function');
  const dir = await serverFixture(); const record = {};
  const session = await launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn(record), openBrowser: async () => {} });
  record.child.disconnect();
  await session.closed; assert.equal(record.child.exitCode, 0);
  const next = await launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn({}), openBrowser: async () => {} }); await next.stop();
});
test('health identity 不符或開頁失敗，啟動器收掉自家 child', { timeout: 15000 }, async () => {
  assert.equal(typeof launcher.startLocalServer, 'function');
  for (const fault of ['health', 'browser']) {
    const dir = await serverFixture(); const record = {};
    await assert.rejects(launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn(record), openBrowser: async () => { if (fault === 'browser') throw new Error('browser failure'); }, ...(fault === 'health' ? { fetchHealth: async () => ({ ok: true, json: async () => ({ ok: true, status: 'ready', instanceId: 'another' }) }) } : {}) }), /身份|browser failure/);
    assert.equal(record.child.exitCode, 0);
  }
});

test('Ctrl+C 路徑停止本次 writer；自訂可用 port 正確開頁', { timeout: 15000 }, async () => {
  const reservation = createServer(); await new Promise(resolvePromise => reservation.listen(0, '127.0.0.1', resolvePromise));
  const port = reservation.address().port; await new Promise(resolvePromise => reservation.close(resolvePromise));
  const dir = await serverFixture(`PORT=${port}\n`); const record = {};
  const session = await launcher.startLocalServer({ root: dir, spawnChild: isolatedSpawn(record), openBrowser: async () => {} });
  try { assert.equal(new URL(session.url).port, String(port)); process.emit('SIGINT'); await session.closed; assert.equal(record.child.exitCode, 0); } finally { await session.stop(); }
});

test('假的或缺失 IPC ready 不開頁，啟動逾時後終止本次 child', { timeout: 15000 }, async () => {
  const dir = await fixture(); let child; let opened = 0;
  await assert.rejects(launcher.startLocalServer({ root: dir, readyTimeoutMs: 200, openBrowser: async () => { opened++; }, spawnChild: () => {
    child = spawn(process.execPath, ['-e', `process.send({type:'stock1-ready',pid:0,instanceId:'a'.repeat(32),port:1,host:'127.0.0.1'}); process.on('message', () => process.exit(0));`], { windowsHide: true, stdio: ['ignore','ignore','ignore','ipc'] }); return child;
  } }), /逾時/);
  assert.equal(opened, 0); assert.equal(child.exitCode, 0);
});

test('父程序在 server 載入前即斷線，也不得留下服務', { timeout: 10000 }, async () => {
  const dir = await serverFixture(); const record = {};
  // preload 刻意等 disconnect 已發生才讓 server 模組求值，鎖住視窗在初始化中關閉的競態。
  await writeFile(join(dir, 'offline.mjs'), `globalThis.fetch = () => { throw new Error('offline fixture'); }; if(process.connected) await new Promise(resolve => process.once('disconnect', resolve));`);
  const child = isolatedSpawn(record)(process.execPath, ['--env-file-if-exists=.env', join(dir, 'server.mjs')], { cwd: dir, windowsHide: true });
  const exit = new Promise(resolvePromise => child.once('exit', code => resolvePromise(code)));
  child.disconnect();
  let timer;
  try { assert.equal(await Promise.race([exit, new Promise(resolvePromise => { timer = setTimeout(() => resolvePromise('orphan'), 2500); })]), 0); }
  finally { clearTimeout(timer); if (child.exitCode === null) { child.kill(); await exit; } }
});

test('真 start.bat 保留 launcher 退出碼，中文字可讀且不另開視窗', { skip: process.platform !== 'win32', timeout: 10000 }, async () => {
  const dir = await fixture(); await mkdir(join(dir, 'scripts'));
  await cp(resolve('start.bat'), join(dir, 'start.bat'));
  await writeFile(join(dir, 'scripts/start-local.mjs'), `console.log('fixture launcher'); process.exitCode = 23;`);
  const child = spawn('cmd.exe', ['/d', '/c', 'start.bat'], { cwd: dir, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const buffers = []; child.stdout.on('data', chunk => buffers.push(chunk)); child.stderr.on('data', chunk => buffers.push(chunk)); child.stdin.end('\r\n');
  const code = await new Promise(resolvePromise => child.once('close', resolvePromise));
  const output = Buffer.concat(buffers).toString('utf8');
  assert.equal(code, 23); assert.match(output, /fixture launcher/); assert.match(output, /伺服器已停止/);
});
test('缺套件會安裝；stamp 存在仍偵測套件內檔案消失及 lock 改變', async () => {
  assert.equal(typeof launcher.ensureRuntimeDependencies, 'function');
  const dir = await fixture(); const calls = [];
  const npm = async (args) => { calls.push(args); await install(dir); };
  await launcher.ensureRuntimeDependencies({ root: dir, npm }); assert.equal(calls.length, 1); assert.ok(calls[0].includes('--omit=dev'));
  await launcher.ensureRuntimeDependencies({ root: dir, npm }); assert.equal(calls.length, 1);
  await rm(join(dir, 'node_modules/demo/inner.js'));
  await launcher.ensureRuntimeDependencies({ root: dir, npm }); assert.equal(calls.length, 2);
  await writeFile(join(dir, 'package-lock.json'), `${await readFile(join(dir, 'package-lock.json'), 'utf8')}\n`);
  await launcher.ensureRuntimeDependencies({ root: dir, npm }); assert.equal(calls.length, 3);
});
test('既有符合 lock 的開發安裝不重裝；需要重裝時保留 dev 安裝意圖', async () => {
  assert.equal(typeof launcher.ensureRuntimeDependencies, 'function');
  const dir = await fixture(); await install(dir, true); const calls = [];
  const npm = async (args) => { calls.push(args); await install(dir, true); };
  await launcher.ensureRuntimeDependencies({ root: dir, npm }); assert.equal(calls.length, 0);
  await rm(join(dir, 'node_modules/demo/index.js'));
  await launcher.ensureRuntimeDependencies({ root: dir, npm }); assert.equal(calls.length, 1); assert.ok(calls[0].includes('--include=dev'));
});
test('安裝失敗或安裝後仍缺檔不寫成功 stamp，不能啟動伺服器', async () => {
  assert.equal(typeof launcher.ensureRuntimeDependencies, 'function');
  const dir = await fixture();
  await assert.rejects(launcher.ensureRuntimeDependencies({ root: dir, npm: async () => { throw new Error('install failed'); } }), /install failed/);
  await assert.rejects(readFile(join(dir, 'node_modules/.stock1-runtime.json')));
  await assert.rejects(launcher.ensureRuntimeDependencies({ root: dir, npm: async () => {} }), /相依套件/);
  await assert.rejects(readFile(join(dir, 'node_modules/.stock1-runtime.json')));
});
