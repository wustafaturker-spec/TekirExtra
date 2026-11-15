import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { planOzelligiAcik } from "../src/core/abonelik-erisim.service";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { PrismaService } from "../src/core/prisma.service";
import { kabulPaketleri } from "./platform-paket-fixture";

/**
 * PLT-126 kabul testi (gerçek PostgreSQL): eski plan geçişinden gelen ve
 * kayıtlı fiyatı olmayan (teklifli) kurumsal abonelik, kurumsal paketin
 * yayınlanmış sürümüne kapsam atamasıyla geçer; fiyat koşulu null kalır,
 * plan özellikleri açılır. Fiyat ataması ve başka pakete geçiş reddedilir.
 */
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService();
const paketler = kabulPaketleri(admin, db);
const servis = new PlatformPaketService({ db } as never), kisi = randomUUID(), firma = randomUUID();
const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "teklifli@kabul.invalid", rol: "yonetici" }, is);

beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Teklifli kabul", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await admin.tenant.create({ data: { id: firma, unvan: "Teklifli kurumsal firma", vkn: String(Date.now()).slice(-10) } });
  // Eski plan bağı tetikleyiciyle kurulur: kurumsal v1, fiyat yok.
  await admin.tenantAbonelik.create({ data: { tenantId: firma, planKodu: "kurumsal", donemSonu: new Date(Date.now() + 20 * 86400000) } });
});
afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: kisi } });
  await admin.platformPaketAtamasi.deleteMany({ where: { kullaniciId: kisi } });
  await admin.tenant.deleteMany({ where: { id: firma } });
  await admin.platformKullanici.deleteMany({ where: { id: kisi } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});

describe("PLT-126 teklifli aboneliğe kapsam ataması", () => {
  it("kurumsal teklifli abonelik kapsamla geçer; fiyat null kalır, plan özelliği açılır", async () => {
    const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
    expect((once.paketKosullari as { fiyatlandirma: unknown }).fiyatlandirma).toBeNull();
    const hedefId = await paketler.gecir(firma, "kurumsal");
    const sonra = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
    const k = sonra.paketKosullari as { semaSurumu: number; kaynak: string; fiyatlandirma: unknown; kapsamSozlesmesi: unknown };
    expect([sonra.paketSurumId, sonra.planKodu, k.semaSurumu, k.kaynak, k.fiyatlandirma]).toEqual([hedefId, "kurumsal", 2, "katalog_atamasi", null]);
    expect(k.kapsamSozlesmesi).toBeTruthy();
    expect([sonra.donemSonu?.toISOString(), sonra.durum]).toEqual([once.donemSonu?.toISOString(), once.durum]);
  });

  it("özellikli sürüme geçince plan özelliği açılır; önizleme fiyat göstermez", async () => {
    const p = await admin.platformPaket.findUniqueOrThrow({ where: { kod: "kurumsal" }, include: { surumler: { orderBy: { surumNo: "desc" }, take: 1 } } });
    const son = p.surumler[0];
    const taslak = await yonetici(() => servis.taslakAc(p.id, son.id));
    const kapsam = { ...(son.kapsamSozlesmesi as object), ozellikler: { fiyatEndeksAnalizi: true } };
    const g = await yonetici(() => servis.guncelle(p.id, taslak.id, { ad: son.ad, aciklama: son.aciklama, ozellikler: son.ozellikler as string[], siralama: son.siralama, fiyatlandirma: son.fiyatlandirma as never, kapsamSozlesmesi: kapsam as never, kilitSurumu: taslak.kilitSurumu }));
    const yayin = await yonetici(() => servis.yayinla(p.id, g.id, g.kilitSurumu));
    expect(await app.tenantIslem(firma, (tx) => planOzelligiAcik(tx, firma, "fiyatEndeksAnalizi"))).toBe(false);
    const o = await yonetici(() => servis.atamaOnizle({ surumId: yayin.id, tenantIds: [firma], uygulamaTarihi: bugunTR(), neden: "Teklifli firmaya plan özelliği", atamaKapsami: "kapsam" }));
    expect(o.kayitlar[0]).toMatchObject({ teklifli: true, donemler: [], neden: "teklifli_fiyat_degismez" });
    await yonetici(() => servis.atamaUygula(o.id));
    expect(await app.tenantIslem(firma, (tx) => planOzelligiAcik(tx, firma, "fiyatEndeksAnalizi"))).toBe(true);
    expect(((await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).paketKosullari as { fiyatlandirma: unknown }).fiyatlandirma).toBeNull();
  });

  it("teklifli abonelikte fiyat ataması ve başka pakete geçiş reddedilir", async () => {
    const p = await admin.platformPaket.findUniqueOrThrow({ where: { kod: "kurumsal" }, include: { surumler: { where: { durum: "yayinlandi" }, orderBy: { surumNo: "desc" }, take: 1 } } });
    await expect(yonetici(() => servis.atamaOnizle({ surumId: p.surumler[0].id, tenantIds: [firma], uygulamaTarihi: bugunTR(), neden: "Fiyat ataması denemesi" }))).rejects.toThrow();
    const baska = await admin.platformPaket.findFirstOrThrow({ where: { kod: { not: "kurumsal" }, surumler: { some: { durum: "yayinlandi", fiyatlandirma: { not: undefined }, kapsamSozlesmesi: { not: undefined } } } }, include: { surumler: { where: { durum: "yayinlandi" }, take: 1 } } }).catch(() => null);
    if (baska?.surumler[0]?.kapsamSozlesmesi && baska.surumler[0].fiyatlandirma) {
      await expect(yonetici(() => servis.atamaOnizle({ surumId: baska.surumler[0].id, tenantIds: [firma], uygulamaTarihi: bugunTR(), neden: "Başka paket denemesi", atamaKapsami: "kapsam" }))).rejects.toThrow(/kendi paketinin/);
    }
  });
});
