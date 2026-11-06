import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { kabulOrtami, sunucuYonetimAdresi } from "./test/kabul-ortami";

/**
 * Kabul koşusunun başında bir kez: kabul veritabanı yoksa oluşturulur ve
 * `prisma migrate deploy` ile güncellenir (roller sunucu genelindedir, yetki
 * ve RLS migration'larla gelir). `KABUL_SIFIRLA=1` veritabanını baştan kurar;
 * yalnız adı `_kabul` ile biten veritabanında çalışır.
 */
export default async function hazirla(): Promise<void> {
  const env = resolve(__dirname, ".env");
  if (existsSync(env)) process.loadEnvFile(env);
  if (process.env.KABUL_ORTAMI !== "1") Object.assign(process.env, kabulOrtami(process.env));
  const hedef = process.env.KABUL_VERITABANI!;
  const yonetimAdresi = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL!;
  const sunucu = new PrismaClient({ datasourceUrl: sunucuYonetimAdresi(yonetimAdresi) });
  try {
    const kimlik = `"${hedef.replace(/"/g, '""')}"`;
    if (process.env.KABUL_SIFIRLA === "1") {
      if (!/_kabul$/.test(hedef)) throw new Error(`KABUL_SIFIRLA yalnız adı _kabul ile biten veritabanında çalışır (${hedef})`);
      await sunucu.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${kimlik} WITH (FORCE)`);
    }
    const var_ = await sunucu.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${hedef}`;
    if (!var_.length) await sunucu.$executeRawUnsafe(`CREATE DATABASE ${kimlik}`);
  } finally {
    await sunucu.$disconnect();
  }
  const sonuc = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: __dirname, stdio: "pipe", encoding: "utf8",
    env: { ...process.env, DATABASE_URL: yonetimAdresi },
  });
  if (sonuc.status !== 0) throw new Error(`Kabul veritabanı migration'ı başarısız:\n${sonuc.stdout}\n${sonuc.stderr}`);
  // eslint-disable-next-line no-console
  console.log(`Kabul ortamı: veritabanı ${hedef}, Redis ${new URL(process.env.REDIS_URL!).pathname}, kova ${process.env.S3_KOVA}`);
}
