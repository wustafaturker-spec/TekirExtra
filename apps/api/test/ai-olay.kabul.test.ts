import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it, vi } from "vitest";
import { AiOlayService, OLAY_AZAMI_DENEME, olayYaz } from "../src/ai/olay/ai-olay.service";
import { BildirimService } from "../src/bildirimler/bildirim.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { PrismaService } from "../src/core/prisma.service";

/**
 * AI-106 kabulü (gerçek PostgreSQL): olay iş kaydıyla aynı işlemde; teslimatçı çökse de
 * bildirim bir kez oluşur; teslim edilemeyen olay iş kaydını kaybettirmez; imleçle okuma
 * eksiksiz ve sıralı; başka firma olayları görünmez.
 */
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService();
const tenantId = randomUUID();
const baskaTenantId = randomUUID();

afterAll(async () => {
  await admin.$transaction(async (tx) => {
    for (const t of [tenantId, baskaTenantId]) {
      await tx.bildirimTeslimati.deleteMany({ where: { bildirim: { tenantId: t } } });
      await tx.bildirim.deleteMany({ where: { tenantId: t } });
      await tx.aiOlay.deleteMany({ where: { tenantId: t } });
      await tx.aiOnayTalebi.deleteMany({ where: { tenantId: t } });
      await tx.user.deleteMany({ where: { tenantId: t } });
      await tx.tenant.deleteMany({ where: { id: t } });
    }
  }, { timeout: 60_000 });
  await Promise.all([db.$disconnect(), admin.$disconnect()]);
});

it("olay kaydı: aynı işlem, tek bildirim, kalıcı başarısızlık, imleç ve yalıtım", async () => {
  await admin.tenant.create({ data: { id: tenantId, unvan: "Olay Kabul", vkn: String(Date.now()).slice(-10) } });
  await admin.tenant.create({ data: { id: baskaTenantId, unvan: "Başka", vkn: String(Date.now() + 3).slice(-10) } });
  const user = await admin.user.create({ data: { tenantId, eposta: `${tenantId}@kabul.invalid`, adSoyad: "Onaylayan", parolaHash: "test", rol: "yonetici" } });
  const yabanci = await admin.user.create({ data: { tenantId: baskaTenantId, eposta: `${baskaTenantId}@kabul.invalid`, adSoyad: "Yabancı", parolaHash: "test", rol: "yonetici" } });
  const bildirim = new BildirimService(db);
  const servis = new AiOlayService(db, bildirim);
  const talepId = randomUUID();

  // (a) İş kaydı geri alınırsa olay da yoktur.
  await expect(db.tenantIslem(tenantId, async (tx) => {
    await olayYaz(tx, { tenantId, topluTur: "ai_onay", topluId: talepId, tur: "ai_onay.acildi", yuk: { userId: user.id, kaynak: "asistan", ozet: "Geri alınan" } });
    throw new Error("iş kaydı başarısız");
  })).rejects.toThrow("iş kaydı başarısız");
  expect(await admin.aiOlay.count({ where: { topluId: talepId } })).toBe(0);

  // (b) Teslimatçı bildirimi ürettikten sonra işaretleyemeden çöktü: kira dolunca yeniden teslim edilir, bildirim tek kalır.
  const acildi = await db.tenantIslem(tenantId, (tx) => olayYaz(tx, { tenantId, topluTur: "ai_onay", topluId: talepId, tur: "ai_onay.acildi", yuk: { userId: user.id, kaynak: "asistan", ozet: "Teklif onayı" } }));
  await servis.teslimEt(acildi);
  await admin.aiOlay.update({ where: { id: acildi.id }, data: { sahiplikAnahtari: randomUUID(), kiraBitisAt: new Date(Date.now() - 1000) } });
  expect(await servis.tur(new Date(), admin)).toEqual({ teslim: 1, edilemedi: 0 });
  expect(await servis.tur(new Date(), admin)).toEqual({ teslim: 0, edilemedi: 0 });
  const bildirimler = await admin.bildirim.findMany({ where: { tenantId, kaynakRef: talepId } });
  expect(bildirimler).toHaveLength(1);
  expect(await admin.bildirimTeslimati.count({ where: { bildirimId: bildirimler[0]!.id, userId: user.id } })).toBe(1);
  expect(await admin.aiOlay.findUniqueOrThrow({ where: { id: acildi.id } })).toMatchObject({ teslimDurumu: "teslim_edildi" });

  // "Sonuçlandı" olayı bildirimi kapatır.
  await db.tenantIslem(tenantId, (tx) => olayYaz(tx, { tenantId, topluTur: "ai_onay", topluId: talepId, tur: "ai_onay.sonuclandi", yuk: { userId: user.id, durum: "onaylandi" } }));
  await servis.tur(new Date(), admin);
  expect((await admin.bildirim.findFirstOrThrow({ where: { id: bildirimler[0]!.id } })).kapandiAt).not.toBeNull();

  // (c) Kanal/teslim sürekli başarısız: olay artan beklemeyle kalır, sınırda "teslim_edilemedi", tur hata verir.
  const bozuk = new AiOlayService(db, { uret: vi.fn(async () => { throw new Error("Telegram kapalı"); }), kapatEksikleri: vi.fn() } as never);
  const gorevId = randomUUID();
  const hata = await db.tenantIslem(tenantId, (tx) => olayYaz(tx, { tenantId, topluTur: "asistan_gorevi", topluId: gorevId, tur: "asistan_gorevi.durum", yuk: { userId: user.id, durum: "tamamlandi", konu: "Analiz" } }));
  let an = new Date();
  await bozuk.tur(an, admin);
  const ilk = await admin.aiOlay.findUniqueOrThrow({ where: { id: hata.id } });
  expect(ilk).toMatchObject({ teslimDurumu: "bekliyor", deneme: 1, hata: "Telegram kapalı" });
  expect(ilk.sonrakiDenemeAt!.getTime()).toBeGreaterThan(an.getTime());
  for (let i = 2; i < OLAY_AZAMI_DENEME; i++) { an = new Date(an.getTime() + 3_700_000); await bozuk.tur(an, admin); }
  await expect(bozuk.tur(new Date(an.getTime() + 3_700_000), admin)).rejects.toThrow(/teslim edilemedi/);
  expect(await admin.aiOlay.findUniqueOrThrow({ where: { id: hata.id } })).toMatchObject({ teslimDurumu: "teslim_edilemedi", deneme: OLAY_AZAMI_DENEME });

  // (d) İmleç: görev olayları sırayla, kaldığı yerden eksiksiz.
  for (const d of ["kuyrukta", "calisiyor", "tamamlandi"]) {
    await db.tenantIslem(tenantId, (tx) => olayYaz(tx, { tenantId, topluTur: "asistan_gorevi", topluId: gorevId, tur: "asistan_gorevi.durum", yuk: { userId: user.id, durum: d }, teslimGerekmez: true }));
  }
  const baglam = { tenantId, userId: user.id, rol: "yonetici" as const };
  const ilk2 = await baglamlaCalistir(baglam, () => servis.gorevOlaylari(gorevId));
  expect(ilk2.olaylar.map((o) => o.durum)).toEqual(["tamamlandi", "kuyrukta", "calisiyor", "tamamlandi"]);
  const devam = await baglamlaCalistir(baglam, () => servis.gorevOlaylari(gorevId, ilk2.olaylar[1]!.sira));
  expect(devam.olaylar.map((o) => o.durum)).toEqual(["calisiyor", "tamamlandi"]);
  expect((await baglamlaCalistir(baglam, () => servis.gorevOlaylari(gorevId, devam.sonraki!))).olaylar).toEqual([]);

  // (e) Başka firma aynı görev kimliğiyle olay göremez (RLS).
  expect((await baglamlaCalistir({ tenantId: baskaTenantId, userId: yabanci.id, rol: "yonetici" }, () => servis.gorevOlaylari(gorevId))).olaylar).toEqual([]);
});
