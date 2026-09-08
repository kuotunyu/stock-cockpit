// Windows 雙擊入口：版本與 runtime 安裝契約、同一 child 的 ready，以及成對關閉。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function supportsRuntimeNode(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts) return false;
  const [, major, minor] = parts.map(Number);
  return major >= 24 || (major === 22 && minor >= 13);
}
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function readOrNull(path) { try { return await json(path); } catch { return null; } }
function runtimePackages(lock) {
  return Object.entries(lock.packages || {}).filter(([path, pkg]) => path && !pkg.dev && !pkg.devOptional && !pkg.optional);
}
async function installedInventory(root, lock) {
  const installedLock = await readOrNull(join(root, 'node_modules/.package-lock.json'));
  const inventory = {};
  try {
    for (const [path, pkg] of runtimePackages(lock)) {
      if (!/^node_modules\/(?:[^.][^/]*\/)*[^.][^/]*$/.test(path)) return null;
      const installed = installedLock?.packages?.[path];
      if (!installed || ['version', 'integrity', 'resolved'].some(key => installed[key] !== pkg[key])) return null;
      const manifest = await json(join(root, path, 'package.json'));
      if (manifest.version !== pkg.version) return null;
      if (manifest.main && !(await stat(join(root, path, manifest.main))).isFile()) return null;
      // 每次重新列舉實際檔案（含內部模組／原生檔）；stamp 不是免驗安裝的旗標。
      async function scan(relativePath) {
        for (const entry of await readdir(join(root, relativePath), { withFileTypes: true })) {
          if (entry.name === 'node_modules') continue;
          const name = `${relativePath}/${entry.name}`;
          if (entry.isDirectory()) { if (!(await scan(name))) return false; }
          else if (entry.isFile()) inventory[name] = (await stat(join(root, name))).size;
          else return false;
        }
        return true;
      }
      if (!(await scan(path))) return null;
    }
    return inventory;
  } catch { return null; }
}
export async function ensureRuntimeDependencies({ root = projectRoot, npm = runNpm } = {}) {
  const manifest = await json(join(root, 'package.json'));
  const lockBytes = await readFile(join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  if (lock.lockfileVersion !== 3 || JSON.stringify(manifest.dependencies || {}) !== JSON.stringify(lock.packages?.['']?.dependencies || {})) throw new Error('package.json 與 lock 不一致，請先修正相依套件宣告。');
  const lockHash = createHash('sha256').update(lockBytes).digest('hex');
  const stampPath = join(root, 'node_modules/.stock1-runtime.json');
  const stamp = await readOrNull(stampPath);
  let inventory = await installedInventory(root, lock);
  const installation = `${process.versions.node.split('.')[0]}:${process.platform}:${process.arch}`;
  if (!inventory || (stamp && (stamp.lockHash !== lockHash || stamp.installation !== installation || JSON.stringify(stamp.inventory) !== JSON.stringify(inventory)))) {
    const keepDev = Object.keys(manifest.devDependencies || {}).some(name => existsSync(join(root, 'node_modules', name, 'package.json')));
    await npm(['ci', keepDev ? '--include=dev' : '--omit=dev', '--no-audit', '--no-fund'], { root });
    inventory = await installedInventory(root, lock);
    if (!inventory) throw new Error('安裝後相依套件仍不完整，伺服器未啟動。');
  }
  await writeFile(stampPath, `${JSON.stringify({ lockHash, installation, inventory })}\n`, 'utf8');
}

function runNpm(args, { root }) {
  // npm 與 node 同一安裝目錄；直接執行 CLI，避免 cmd 引號與額外中介程序。
  const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npmCli)) throw new Error('找不到 Node 同目錄的 npm，請修復 Node.js 安裝。');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
    const stop = () => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill('SIGTERM');
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const cleanup = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); if (code === 0) resolvePromise(); else reject(new Error(`npm ci 失敗（${code ?? '已取消'}），伺服器未啟動。`)); });
  });
}

function openDefaultBrowser(url) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolvePromise(); });
  });
}

export async function startLocalServer({ root = projectRoot, spawnChild = spawn, openBrowser = openDefaultBrowser, fetchHealth = fetch, readyTimeoutMs = 30000 } = {}) {
  const child = spawnChild(process.execPath, ['--env-file-if-exists=.env', join(root, 'server.mjs')], {
    cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true,
  });
  let exited = false;
  const closed = new Promise(resolvePromise => {
    // Windows 手動 IPC disconnect 後 close 可能不送出；exit 才是 child 已結束的契約。
    child.once('exit', (code, signal) => { exited = true; resolvePromise({ code, signal }); });
    child.once('error', () => { exited = true; resolvePromise({ code: 1, signal: null }); });
  });
  let stopping = null;
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (exited) return closed;
      if (child.connected) child.send({ type: 'stock1-stop' }, () => {});
      else child.kill('SIGTERM');
      const timeout = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 10000);
      try { return await closed; } finally { clearTimeout(timeout); }
    })();
    return stopping;
  };
  const onSignal = () => { void stop(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  void closed.then(() => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); });
  let timeout;
  try {
    const ready = await new Promise((resolvePromise, reject) => {
      timeout = setTimeout(() => reject(new Error('伺服器啟動逾時，尚未就緒。')), readyTimeoutMs);
      child.once('error', () => reject(new Error('無法啟動 Node 子程序。')));
      child.once('exit', () => reject(new Error('伺服器啟動失敗；請查看上方錯誤訊息。')));
      child.on('message', message => {
        if (message?.type !== 'stock1-ready' || message.pid !== child.pid || !/^[a-f0-9]{32}$/.test(message.instanceId || '') || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) return;
        resolvePromise(message);
      });
    });
    clearTimeout(timeout);
    const browserHost = ['0.0.0.0', '::'].includes(ready.host) ? '127.0.0.1' : ready.host;
    const url = new URL(`http://${browserHost.includes(':') ? `[${browserHost}]` : browserHost}:${ready.port}/`).href;
    const response = await fetchHealth(`${url}api/health`, { signal: AbortSignal.timeout(5000) });
    const health = await response.json();
    if (!response.ok || !health.ok || health.status !== 'ready' || health.instanceId !== ready.instanceId) throw new Error('伺服器就緒身份不符，未開啟瀏覽器。');
    if (stopping || exited) throw new Error('伺服器啟動已取消。');
    await openBrowser(url);
    return { url, instanceId: ready.instanceId, stop, closed };
  } catch (error) {
    await stop();
    throw error;
  } finally { clearTimeout(timeout); }
}

async function main() {
  if (!supportsRuntimeNode(process.versions.node)) throw new Error(`Node ${process.versions.node} 不符合 App 需求：22.13 以上的 22.x 或 24+；建議安裝 Node 24 LTS。`);
  await ensureRuntimeDependencies();
  const session = await startLocalServer();
  const result = await session.closed;
  process.exitCode = result.code ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[Stock1] ${error.message}`); process.exitCode = 1; });
}
