// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * K-3 (2026-11-11): beklenmeyen ve yanlış yerde kullanılan söz — para ve gönderim
 * kodunda sessiz veri kaybının en sık nedeni. Tip bilgisi gerektirdiği için ana
 * lint'ten (eslint.config.mjs, hızlı) ayrıdır: `pnpm lint:soz` API+paketler ve web'i
 * iki ayrı adımda denetler (tek seferde iki proje 7 GB'lık makinede belleği aşıyor).
 * React öznitelikleri (`onClick={async () => …}`) hariçtir: işleyici hatası
 * işleyicinin içinde yakalanır, bunu her yerde sarmak gürültü olur.
 */
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.next-*/**", "**/*.d.ts", "**/*.test.ts", "**/*.test.tsx", "**/*.test-veri.ts", "**/*.spec.ts"] },
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    // react-hooks yalnız kaynaktaki eslint-disable yorumları tanınsın diye yüklenir; kuralı burada açılmaz.
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    },
  },
);
