// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Dar kapsamlı lint (karar 2026-10-17): biçim kuralı yok, yalnız gerçek hata
 * yakalayan kurallar. Tip bilgisi gerektiren kurallar kullanılmaz (hızlı
 * kalsın). Kural eklemek bilinçli bir karar olmalı; toplu "recommended"
 * setleri açılmaz.
 */
const hataKurallari = {
  "no-cond-assign": "error",
  "no-constant-binary-expression": "error",
  "no-debugger": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-eval": "error",
  "no-fallthrough": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-sparse-arrays": "error",
  "no-unreachable": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "@typescript-eslint/no-duplicate-enum-values": "error",
};

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.next-*/**", "**/coverage/**", "**/playwright-report/**", "**/test-results/**", "backups/**", ".release-candidates/**", "**/*.d.ts"],
  },
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "apps/*/test/**/*.ts", "apps/web/e2e/**/*.ts", "packages/*/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: "module" },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { ...hataKurallari },
  },
  {
    files: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
);
