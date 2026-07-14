import { defineConfig } from "vitest/config";

/** Birim testler: yalnızca src altındaki *.test.ts; kabul testleri ayrı koşar. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
