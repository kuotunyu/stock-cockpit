// ESLint（2026-09-17 起）：45,000 行只靠 node --check 太薄——未使用的變數、漏掉的 import、意外全域都沒人看。
// 規則刻意只取「幾乎一定是 bug」的那些：recommended 為底，no-unused-vars 不管函式參數（回呼簽名常故意留著）、
// 忽略 rest 解構的兄弟（`const { a, ...rest } = x` 是刻意剔除欄位）、允許空 catch（本專案大量「失敗就沿用舊值」）。
// 風格類規則一條都不加，這裡不是 formatter。第一輪就抓到兩份測試在樣板字串裡寫 `\s`（送進 jsdom 變成 /s+/）。
// app.js／portfolio-risk.js 是 classic script（頂層 const 進 global lexical scope，測試 harness 依賴），sourceType 必須是 script。
import js from "@eslint/js";
import globals from "globals";

const baseRules = {
  ...js.configs.recommended.rules,
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "eqeqeq": ["error", "smart"],
  // 中文介面的樣板字串、註解與字串常有全形空白，那是內容不是程式碼；程式碼本體裡的全形空白仍然抓
  "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true }],
  // 上游文字常帶控制字元，正則裡的 \x00 之類是刻意的
  "no-control-regex": "off",
};

export default [
  { ignores: ["node_modules/**", "lucide.min.js", ".data/**", ".data-preview/**", ".agents/**", ".claude/**", "fonts/**"] },
  {
    files: ["server.mjs", "verification-evidence.mjs", "scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2025, sourceType: "module", globals: { ...globals.node } },
    rules: baseRules,
  },
  {
    // Playwright 的 page.evaluate(() => …) 回呼在瀏覽器裡執行，引用的是 app.js 的全域（state、el、APP_SHELL_VERSION…）
    // 與 document／window；ESLint 看不出這層界線，no-undef 在這幾個檔關掉，其餘規則照抓。
    files: ["tests/browser/**/*.mjs", "tests/helpers/browser-fixtures.mjs", "tests/helpers/pwa-fixtures.mjs", "scripts/verification-measurement.mjs"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["app.js", "portfolio-risk.js"],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: "script",
      globals: { ...globals.browser, lucide: "readonly", Stock1Risk: "readonly" },
    },
    rules: baseRules,
  },
  {
    files: ["sw.js"],
    languageOptions: { ecmaVersion: 2025, sourceType: "script", globals: { ...globals.serviceworker } },
    rules: baseRules,
  },
];
