import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import type { MevzuatService } from "../src/mevzuat/mevzuat.service";
import { PlatformMevzuatService } from "../src/mevzuat/platform-mevzuat.service";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * PLT-26: editörün denetim sorgusu gerçek PostgreSQL'de, gerçek platform
 * rolüyle açık mevzuat listesine süzülür. Yönetim olayları ve bilinmeyen
 * yeni olaylar editöre dönmez; yönetici hepsini görür.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
function platformAdresi(): string {
  if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;
  const u = new URL(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? "");
  u.username = "tekir_platform";
  u.password = "tekir_platform_dev";
  return u.toString();
}
const platform = new PrismaClient({ datasourceUrl: platformAdresi() });
const servis = new PlatformMevzuatService({ db: platform } as unknown as PlatformPrismaService, {} as MevzuatService);

const iz = `plt26-${randomUUID()}`;
const YONETIM = ["abonelik_saglayicisi_guncellendi", "platform_rolu_degisti", "destek_istegi", "giris_basarisiz", "sistem_alarmi", "ai_tavani_degisti", "platform_gorevi_olusturuldu", "plt26_bilinmeyen_olay"];
const MEVZUAT = ["olusturuldu", "yayinlandi", "mevzuat_gorevi_olusturuldu"];

const olarak = <T>(rol: "yonetici" | "mevzuat_editoru", is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: randomUUID(), eposta: "kabul@example.invalid", rol }, is);
const bizimkiler = (liste: { olay: string; detay: unknown }[]) => liste.filter((o) => (o.detay as { iz?: string } | null)?.iz === iz).map((o) => o.olay).sort();

beforeAll(async () => {
  // Platform rolü olay tablosuna yalnız ekleyebilir; kayıtlar gerçek üreticiler gibi bu rolle yazılır.
  await platform.mevzuatOlay.createMany({ data: [...YONETIM, ...MEVZUAT].map((olay) => ({ olay, detay: { iz, token: "gizli" } })) });
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE detay->>'iz' = ${iz}`;
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-26 — denetim görünürlüğü (gerçek PostgreSQL)", () => {
  it("editör yalnız mevzuat olaylarını alır; yönetim ve bilinmeyen olaylar dönmez", async () => {
    const liste = await olarak("mevzuat_editoru", () => servis.olaylar(1, true));
    expect(bizimkiler(liste)).toEqual([...MEVZUAT].sort());
    expect(liste.every((o) => !YONETIM.includes(o.olay))).toBe(true);
  });

  it("yönetici tüm olayları görür; gizli alan maskelenir", async () => {
    const liste = await olarak("yonetici", () => servis.olaylar(1, false));
    expect(bizimkiler(liste)).toEqual([...YONETIM, ...MEVZUAT].sort());
    expect(liste.filter((o) => (o.detay as { iz?: string } | null)?.iz === iz).every((o) => (o.detay as { token: string }).token === "•••")).toBe(true);
  });

  it("platform rolü olay geçmişini değiştiremez ve silemez", async () => {
    await expect(platform.$executeRaw`UPDATE mevzuat_olaylari SET olay = 'olusturuldu' WHERE detay->>'iz' = ${iz}`).rejects.toThrow(/permission denied/);
    await expect(platform.$executeRaw`DELETE FROM mevzuat_olaylari WHERE detay->>'iz' = ${iz}`).rejects.toThrow(/permission denied/);
  });
});
