import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AiOzellikKapaliHatasi, aiOzellikDenetle, platformOnbelleginiSifirla } from "../src/ai/ozellik-kapisi";
import { TenantAiService } from "../src/ai/ayarlar/tenant-ai.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformAiOzellikService } from "../src/mevzuat/platform-ai-ozellik.service";
import { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * AI-109: acil durdurma ve firma ayarı gerçek PostgreSQL'de, uygulama ve platform rolleriyle.
 * Kiracı rolü platform tablosunu okur ama yazamaz; durdurma/açma bekleyen onay ve kuyruktaki
 * görevi silmez.
 */
const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const tenantId = randomUUID();
const [userId, platformKullaniciId] = [randomUUID(), randomUUID()];
const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx as never);
    }),
};
const platformDb = new PlatformPrismaService();
const platform = new PlatformAiOzellikService(platformDb);
const ayarlar = new TenantAiService(prisma as never);
const platformdan = <T>(fn: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: platformKullaniciId, eposta: "p@test.local", rol: "yonetici" }, fn);
const kapiHatasi = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as AiOzellikKapaliHatasi);

beforeAll(async () => {
  await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'AI Durdurma', ${String(Date.now()).slice(-10)}, now(), now())`;
  await yonetim.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`ai-dur-${userId}@test.local`}, 'x', 'Yeliz Yönetici', 'yonetici'::"Rol", now())`;
  await yonetim.$executeRaw`INSERT INTO platform_kullanicilari (id, eposta, ad_soyad, parola_hash, totp_secret_sifreli, updated_at) VALUES (${platformKullaniciId}::uuid, ${`p-${platformKullaniciId}@test.local`}, 'Pelin Platform', 'x', 'x', now())`;
});

afterAll(async () => {
  // Paylaşılan kabul veritabanında öteki testleri etkilemesin: durdurmalar kaldırılır.
  await yonetim.$executeRaw`DELETE FROM platform_ai_ozellik_durumlari`;
  platformOnbelleginiSifirla();
  await Promise.all([uygulama.$disconnect(), yonetim.$disconnect(), platformDb.onModuleDestroy()]);
});

it("kiracı rolü platform durdurmasını okur ama yazamaz", async () => {
  await expect(prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).platformAiOzellikDurumu.findMany())).resolves.toEqual(expect.any(Array));
  await expect(prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).platformAiOzellikDurumu.create({ data: { ozellik: "ocr", durduruldu: true } }))).rejects.toThrow();
});

it("acil durdurma firma ayarından önce gelir; açınca bekleyen onay ve kuyruktaki görev yerinde durur", async () => {
  const oturum = await prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).ajanOturumu.create({ data: { tenantId, userId, kanal: "WEB", kanalKimlik: userId } }));
  const istek = await prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).ajanMesajGecmisi.create({ data: { oturumId: oturum.id, rol: "user", icerik: "Uzun analiz", kanal: "WEB" } }));
  const gorev = await prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).aiAsistanGorevi.create({ data: { tenantId, userId, oturumId: oturum.id, istekMesajId: istek.id, istekId: randomUUID(), mesaj: "Uzun analiz", durum: "kuyrukta" } as never }));
  const talep = await prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).aiOnayTalebi.create({ data: { tenantId, userId, kaynak: "asistan", arac: "cari_olustur", parametreler: {}, ozet: "Cari aç", gecerlilikSonu: new Date(Date.now() + 3_600_000) } as never }));

  // Firma ayarı: yalnız seçilen özellik kapanır, denetim kaydı yazılır.
  const firma = await ayarlar.ozellikleriKaydet(tenantId, userId, ["ocr", "asistan"]);
  expect(firma.ozellikler.filter((o) => o.firmadaKapali).map((o) => o.anahtar)).toEqual(["asistan", "ocr"]);
  expect(await kapiHatasi(aiOzellikDenetle(prisma as never, tenantId, "asistan"))).toMatchObject({ kaynak: "firma" });
  await expect(aiOzellikDenetle(prisma as never, tenantId, "arka_plan_gorevi")).resolves.toBeUndefined();
  const iz = await prisma.tenantIslem(tenantId, (tx: never) => (tx as PrismaClient).auditLog.findFirst({ where: { islem: "ai_ozellikleri_degisti", varlikId: tenantId } }));
  expect(iz?.detay).toMatchObject({ eski: [], yeni: ["asistan", "ocr"] });

  // Platform durdurması: firma ayarı açık olsa da durdurur ve mesajı platformdandır.
  const liste = await platformdan(() => platform.yaz("arka_plan_gorevi", true, "Sağlayıcı arızası"));
  expect(liste.ozellikler.find((o) => o.anahtar === "arka_plan_gorevi")).toMatchObject({ durduruldu: true, neden: "Sağlayıcı arızası", guncelleyen: "Pelin Platform" });
  expect(await kapiHatasi(aiOzellikDenetle(prisma as never, tenantId, "arka_plan_gorevi"))).toMatchObject({ kaynak: "platform" });
  expect((await ayarlar.ozellikDurumlari(tenantId)).ozellikler.find((o) => o.anahtar === "arka_plan_gorevi")).toMatchObject({ platformdaDurduruldu: true, firmadaKapali: false });
  await expect(platformdan(() => platform.yaz("arka_plan_gorevi", true, null))).rejects.toThrow(/neden/i);
  await expect(platformdan(() => platform.yaz("yok", true, "deneme nedeni"))).rejects.toThrow(/Tanınmayan/);

  // Açınca: görev hâlâ kuyrukta, onay hâlâ bekliyor; olay kaydı eski → yeni taşır.
  await platformdan(() => platform.yaz("arka_plan_gorevi", false, null));
  await expect(aiOzellikDenetle(prisma as never, tenantId, "arka_plan_gorevi")).resolves.toBeUndefined();
  const olaylar = await yonetim.mevzuatOlay.findMany({ where: { kullaniciId: platformKullaniciId }, orderBy: { zaman: "asc" }, select: { olay: true, detay: true } });
  expect(olaylar.map((o) => o.olay)).toEqual(["ai_ozellik_durduruldu", "ai_ozellik_acildi"]);
  expect(olaylar[1].detay).toMatchObject({ ozellik: "arka_plan_gorevi", eski: { durduruldu: true }, yeni: { durduruldu: false } });
  expect((await yonetim.aiAsistanGorevi.findUnique({ where: { id: gorev.id } }))?.durum).toBe("kuyrukta");
  expect((await yonetim.aiOnayTalebi.findUnique({ where: { id: talep.id } }))?.durum).toBe("bekliyor");
});
