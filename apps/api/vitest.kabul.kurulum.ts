import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { kabulOrtami } from "./test/kabul-ortami";

/**
 * Her kabul test dosyasından önce: `.env` yüklenir, sonra veritabanı, Redis ve
 * kova adresleri kabul ortamına çevrilir. Test dosyalarının sonradan yaptığı
 * `process.loadEnvFile` var olan değişkeni ezmediği için bu değerler kalır.
 */
const env = resolve(__dirname, ".env");
if (existsSync(env)) process.loadEnvFile(env);
if (process.env.KABUL_ORTAMI !== "1") Object.assign(process.env, kabulOrtami(process.env));
