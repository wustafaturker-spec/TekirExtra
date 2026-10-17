import { defineConfig } from "@playwright/test";
import temel from "./playwright.f02-yayin.config";
export default defineConfig({ ...temel, testMatch: ["belge-gorunumu.spec.ts"], retries: 0 });
