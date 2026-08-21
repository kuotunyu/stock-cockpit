// 版本辨識與更新檢查：讀 .git 拿 commit／branch／GitHub origin，以及 compare API 的語意換算。
//
// 為什麼需要：三個人各自 git pull、各自 npm start，出事時第一個要問的是「你那份是哪一版」。
// 這裡釘住的是「讀不到就誠實說讀不到」——所有失敗路徑都必須降級成空值或 unavailable，
// 絕不能編一個看起來像版本號的東西，也不能讓更新檢查失敗變成看盤功能的錯誤。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importServer } from "../helpers/test-server.mjs";

const { mod } = await importServer();
const { readAppBuildInfo, readGitHubRepo, readPackedRef, normalizeUpdateComparison } = mod;

const SHA = "55d5bed0f1c2a3b4c5d6e7f8091a2b3c4d5e6f70";

async function makeGitDir(files) {
  const dir = await mkdtemp(join(tmpdir(), "stock1-gitdir-"));
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return dir;
}

// ===== GitHub compare 的語意 =====
// compare 是 `base...head`，status／ahead_by 描述的是 **head 相對於 base**。
// 我們把 base 設成本機 commit、head 設成上游分支，所以 "ahead" ＝ 上游比本機新。
// 這個方向錯了會把「你已經是最新」講成「有 5 個新版」，反之亦然。
test("compare status=ahead ＝ 上游比本機新，ahead_by 就是本機落後的 commit 數", () => {
  const result = normalizeUpdateComparison({ status: "ahead", ahead_by: 5, behind_by: 0 }, { branch: "main" });
  assert.deepEqual(result, { state: "behind", behindBy: 5, localAhead: 0 });
});

test("compare status=identical ＝ 已是最新", () => {
  const result = normalizeUpdateComparison({ status: "identical", ahead_by: 0, behind_by: 0 }, { branch: "main" });
  assert.deepEqual(result, { state: "current", behindBy: 0, localAhead: 0 });
});

test("本機有未 push 的 commit（status=behind）不得說成「有新版」", () => {
  const result = normalizeUpdateComparison({ status: "behind", ahead_by: 0, behind_by: 2 }, { branch: "main" });
  assert.deepEqual(result, { state: "ahead", behindBy: 0, localAhead: 2 });
});

test("分岔（diverged）兩個方向都要保留，不可只講一半", () => {
  const result = normalizeUpdateComparison({ status: "diverged", ahead_by: 3, behind_by: 1 }, { branch: "main" });
  assert.deepEqual(result, { state: "diverged", behindBy: 3, localAhead: 1 });
});

test("看不懂的 status 回 unknown，不猜數字", () => {
  const result = normalizeUpdateComparison({ status: "", ahead_by: 9 }, { branch: "main" });
  assert.equal(result.state, "unknown");
  assert.equal(result.behindBy, 0);
  assert.equal(result.localAhead, 0);
});

// ===== .git/config 的 origin 解析 =====
test("三種 GitHub remote 寫法都解得出 owner/repo", async () => {
  const forms = [
    "https://github.com/kuotunyu/stock-cockpit.git",
    "https://github.com/kuotunyu/stock-cockpit",
    "git@github.com:kuotunyu/stock-cockpit.git",
    "ssh://git@github.com/kuotunyu/stock-cockpit.git",
  ];
  for (const url of forms) {
    const dir = await makeGitDir({ config: `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*\n` });
    assert.deepEqual(readGitHubRepo(dir), { owner: "kuotunyu", repo: "stock-cockpit" }, `解析失敗：${url}`);
  }
});

test("非 GitHub 的 remote 一律回 null（不猜別家 API 形狀）", async () => {
  const dir = await makeGitDir({ config: `[remote "origin"]\n\turl = https://gitlab.com/kuotunyu/stock-cockpit.git\n` });
  assert.equal(readGitHubRepo(dir), null);
});

test("只有 upstream、沒有 origin → 回 null，不拿別的 remote 頂替", async () => {
  const dir = await makeGitDir({
    config: `[remote "upstream"]\n\turl = https://github.com/someone/else.git\n[branch "main"]\n\tremote = upstream\n`,
  });
  assert.equal(readGitHubRepo(dir), null);
});

test("沒有 config 檔不得拋錯", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stock1-gitdir-"));
  assert.equal(readGitHubRepo(dir), null);
});

// ===== packed-refs =====
// 剛 clone 完的 repo，refs/heads/main 常常只存在 packed-refs 裡、沒有獨立檔案，
// 這正是「朋友第一次 clone」的情境，不能只支援本機開發用的鬆散 ref。
test("packed-refs 找得到 ref，並跳過註解與 peeled 行", async () => {
  const dir = await makeGitDir({
    "packed-refs": [
      "# pack-refs with: peeled fully-peeled sorted",
      `${SHA} refs/heads/main`,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/tags/v0.1.0",
      "^bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "",
    ].join("\n"),
  });
  assert.equal(readPackedRef(dir, "refs/heads/main"), SHA);
  assert.equal(readPackedRef(dir, "refs/heads/missing"), "");
});

test("packed-refs 裡不是合法 sha 的內容不得採信", async () => {
  const dir = await makeGitDir({ "packed-refs": "not-a-sha refs/heads/main\n" });
  assert.equal(readPackedRef(dir, "refs/heads/main"), "");
});

test("沒有 packed-refs 不得拋錯", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stock1-gitdir-"));
  assert.equal(readPackedRef(dir, "refs/heads/main"), "");
});

// ===== 實際 build info 的形狀 =====
// 這支測試會跟著執行環境走（開發機有 .git、下載 zip 來跑就沒有），所以只釘「形狀契約」：
// 有就必須是完整 40 碼 sha＋7 碼短碼；沒有就必須是空字串，中間不存在第三種狀態。
test("readAppBuildInfo 的形狀契約：要嘛完整可辨識，要嘛誠實留空", () => {
  const build = readAppBuildInfo();
  assert.equal(typeof build.available, "boolean");
  if (build.available) {
    assert.match(build.commit, /^[0-9a-f]{40}$/, "available 就必須有完整 sha");
    assert.equal(build.shortCommit, build.commit.slice(0, 7));
    assert.equal(typeof build.branch, "string");
  } else {
    assert.equal(build.commit, "", "讀不到就必須留空，不可回半截或假值");
    assert.equal(build.shortCommit, "");
  }
  if (build.repo) {
    assert.equal(typeof build.repo.owner, "string");
    assert.equal(typeof build.repo.repo, "string");
    assert.ok(build.repo.owner && build.repo.repo);
  }
});
