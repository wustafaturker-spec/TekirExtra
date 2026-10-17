import { defineConfig } from "@playwright/test";
import temel from "./playwright.tahsilat-bildirim.config";
export default defineConfig({ ...temel,
  webServer: { command: "node ../../scripts/f02-standalone-server.mjs", env: { PORT: "3106", HOSTNAME: "127.0.0.1" }, url: "http://127.0.0.1:3106/giris", reuseExistingServer: false, timeout: 120000 },
});
