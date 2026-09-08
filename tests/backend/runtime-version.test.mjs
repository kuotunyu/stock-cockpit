// 執行身份在首次查詢前固定；磁碟、文件、dirty、無 Git 與 worktree 狀態分開辨識。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { importServer } from '../helpers/test-server.mjs';

const imported = await importServer();
test.after(async () => { await imported.mod.shutdownServer(); imported.mock.restore(); await rm(imported.dataDir, { recursive: true, force: true }); });
const owned = [];
test.after(async () => { for (const dir of owned) await rm(dir, { recursive: true, force: true }); });
async function fixture(git = true) {
  const dir = await mkdtemp(join(tmpdir(), 'stock1-version-')); owned.push(dir);
  for (const file of ['server.mjs', 'portfolio-risk.js', 'verification-evidence.mjs', 'package.json', 'package-lock.json', 'app.js']) await cp(resolve(file), join(dir, file));
  if (git) { command(dir, ['init', '-b', 'main']); command(dir, ['config', 'core.autocrlf', 'false']); command(dir, ['config', 'user.email', 'fixture@example.invalid']); command(dir, ['config', 'user.name', 'Fixture']); await writeFile(join(dir, '.gitignore'), 'query-helper.mjs\ndata/\n'); commit(dir); }
  return dir;
}
function command(dir, args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }).trim(); }
function commit(dir) { command(dir, ['add', '.']); command(dir, ['commit', '-m', 'fixture']); }
async function load(dir) {
  const helper = join(dir, 'query-helper.mjs');
  await writeFile(helper, `import * as mod from './server.mjs'; process.send({ loaded: true }); process.on('message', () => process.send(mod.getAppIdentity()));`);
  const child = fork(helper, [], { cwd: dir, execArgv: [], env: { ...process.env, STOCK1_SKIP_LISTEN: '1', DATA_DIR: join(dir, 'data'), PORT: '0', UPDATE_CHECK: 'off', SCHEDULER: 'off' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  await once(child, 'message');
  return { query: async () => { const next = once(child, 'message'); child.send('query'); return (await next)[0]; }, close: async () => { const exit = once(child, 'exit'); child.kill(); await exit; } };
}
test('模組載入後首次查詢前更新後端，首次與之後查詢仍保留執行身份；重啟才換版', async () => {
  assert.equal(typeof imported.mod.getAppIdentity, 'function');
  const dir = await fixture();
  const original = command(dir, ['rev-parse', 'HEAD']);
  const process1 = await load(dir);
  try {
    await writeFile(join(dir, 'server.mjs'), `${await readFile(join(dir, 'server.mjs'), 'utf8')}\n// fixture update\n`); commit(dir);
    const first = await process1.query();
    assert.equal(first.runtime.commit, original);
    assert.equal(first.runtime.dirty, false);
    assert.notEqual(first.disk.commit, original);
    assert.equal(first.restartRequired, true);
    await writeFile(join(dir, 'server.mjs'), `${await readFile(join(dir, 'server.mjs'), 'utf8')}\n// second update\n`);
    const second = await process1.query();
    assert.equal(second.runtime.fingerprint, first.runtime.fingerprint);
    assert.notEqual(second.disk.fingerprint, first.disk.fingerprint);
    assert.equal(second.disk.dirty, true);
  } finally { await process1.close(); }
  const process2 = await load(dir);
  try { const result = await process2.query(); assert.equal(result.restartRequired, false); assert.equal(result.runtime.dirty, true); } finally { await process2.close(); }
});
test('文件 commit 不要求重啟；無 Git 仍有來源指紋且不偽稱乾淨 commit', async () => {
  assert.equal(typeof imported.mod.getAppIdentity, 'function');
  const dir = await fixture(false);
  const child = await load(dir);
  try { const value = await child.query(); assert.equal(value.runtime.available, false); assert.equal(value.runtime.dirty, null); assert.match(value.runtime.fingerprint, /^[a-f0-9]{64}$/); } finally { await child.close(); }
  const repo = await fixture(); const running = await load(repo);
  try { await writeFile(join(repo, 'README.md'), 'documents only'); commit(repo); const value = await running.query(); assert.notEqual(value.runtime.commit, value.disk.commit); assert.equal(value.restartRequired, false); } finally { await running.close(); }
});
test('worktree 的共用 config／packed ref 與 dirty 讀自實際 worktree', async () => {
  const dir = await fixture(); command(dir, ['remote', 'add', 'origin', 'https://github.com/example/fixture.git']); command(dir, ['pack-refs', '--all']);
  const wt = join(dir, 'linked'); command(dir, ['worktree', 'add', '-b', 'linked', wt]);
  const value = imported.mod.readAppBuildInfo(wt);
  assert.equal(value.branch, 'linked'); assert.deepEqual(value.repo, { owner: 'example', repo: 'fixture' }); assert.equal(value.dirty, false);
  await writeFile(join(wt, 'server.mjs'), '// changed'); assert.equal(imported.mod.readAppBuildInfo(wt).dirty, true);
});
