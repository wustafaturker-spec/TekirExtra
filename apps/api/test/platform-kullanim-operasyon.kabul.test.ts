import { kabulPaketleri } from "./platform-paket-fixture";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { gunEkle, istatistikFiltreSemasi } from "../src/mevzuat/platform-istatistik-filtre";
import { PlatformIstatistikService } from "../src/mevzuat/platform-istatistik.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";

interface Baslama {
  kesimGunu: string; hazir: boolean; sayilar: { baslayan: number | null; baslamayan: number | null; belirsiz: number | null };
  toplam: number | null; kayitlar: { tenantId: string; planKodu: string }[];
}
interface Operasyon {
  sayilar: { toplam: number; gorev: number; fatura: number; iade: number; hatali: number };
  filtreliIs: number; firmaToplam: number; kayitlar: { tenantId: string; toplam: number; gorev: number; fatura: number; iade: number; hatali: number }[];
}
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const paketler = kabulPaketleri(admin, db);
const service = new PlatformIstatistikService({ db } as never);
const ids = Array.from({ length: 7 }, () => randomUUID());
const [a, b, c, d, e, f, yeni] = ids;
const plan = `gozlem_${randomUUID().slice(0, 8)}`;
const aktor = randomUUID(), kisi = randomUUID();
const gun = (n: number) => gunEkle(bugunTR(), n);
const an = (n: number) => new Date(`${gun(n)}T12:00:00+03:00`);
let eskiGun: Date, eskiYasam: Date;
const baslama = async (id: string | null = null, durum = "baslamayan", sayfa = 1, bitis = gun(-1), paket: string | null = plan) => {
  const [r] = await db.$queryRaw<{ veri: Baslama }[]>`SELECT platform_kullanima_baslama(${bitis}::date, ${paket}::text, ${id}::uuid, ${durum}::text, ${sayfa}::integer) AS veri`;
  return r.veri;
};
const operasyon = async (tur = "hepsi", sayfa = 1, id: string | null = a, paket: string | null = null) => {
  const [r] = await db.$queryRaw<{ veri: Operasyon }[]>`SELECT platform_bekleyen_isler(${paket}::text, ${id}::uuid, ${tur}::text, ${sayfa}::integer) AS veri`;
  return r.veri;
};
beforeAll(async () => {
  eskiGun = (await admin.platformIstatistikAyari.findUniqueOrThrow({ where: { id: 1 } })).baslangic;
  eskiYasam = (await admin.platformBuyumeAyari.findUniqueOrThrow({ where: { id: 1 } })).baslangic;
  await admin.platformIstatistikAyari.update({ where: { id: 1 }, data: { baslangic: new Date(`${gun(-4)}T00:00:00Z`) } });
  await admin.platformBuyumeAyari.update({ where: { id: 1 }, data: { baslangic: an(-8) } });
  for (const id of ids) {
    await admin.tenant.create({ data: { id, unvan: `GOZLEM-${id}`, vkn: id.replaceAll("-", "").slice(0, 10), createdAt: an(id === yeni ? 0 : -6) } });
    await paketler.olustur( { tenantId: id, planKodu: plan, durum: "aktif" });
    await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: id }, data: { olayAt: an(id === yeni ? 0 : id === d ? -6 : -3) } });
  }
  await admin.platformFirmaYasamOlayi.updateMany({ where: { tenantId: e, tip: "kayit" }, data: { tip: "baslangic" } });
  await admin.auditLog.createMany({ data: [
    { tenantId: b, userId: kisi, varlik: "user", islem: "giris_yapildi", createdAt: an(-2) },
    { tenantId: a, userId: "00000000-0000-4000-8000-000000000000", varlik: "fatura", islem: "POST /api/v1/fatura", createdAt: an(-2) },
  ] });
  for (const n of [-3, -2, -1]) await service.gunuUret(gun(n));
  await admin.platformFirmaGunlukOzeti.delete({ where: { tenantId_gun: { tenantId: c, gun: new Date(`${gun(-2)}T00:00:00Z`) } } });
  await admin.platformKullanici.create({ data: { id: aktor, eposta: `${aktor}@ornek.invalid`, adSoyad: "Gözlem", parolaHash: "x", totpSecretSifreli: "x" } });
  for (const durum of ["acik", "devam_ediyor", "tamamlandi", "iptal"] as const) await admin.platformGorev.create({ data: { tenantId: a, kapsam: "platform", durum, baslik: "GIZLI-GOREV", olusturanId: aktor, createdAt: an(-1) } });
  await admin.platformGorev.create({ data: { kapsam: "platform", durum: "acik", baslik: "FİRMASIZ", olusturanId: aktor } });
  let odemeId = "";
  for (const durum of ["bekliyor", "hata", "kesinlesti", "taslak", "tahsil_edildi"]) {
    const p = await admin.abonelikOdemesi.create({ data: { tenantId: a, aySayisi: 1, tutar: 100, yeniDonemSonu: an(30), kaynak: "saglayici", saglayici: "iyzico" } });
    odemeId = p.id;
    await admin.abonelikFaturasi.create({ data: { odemeId: p.id, odeyenTenantId: a, faturalayanTenantId: b, durum, hata: "GIZLI-HATA", createdAt: an(-1) } });
  }
  for (const durum of ["bekliyor", "hata", "yazildi", "gerekmiyor"]) await admin.abonelikIadesi.create({ data: { tenantId: a, odemeId, tutar: 1, neden: "GIZLI-IADE", islemAnahtari: randomUUID(), faturalayanDurumu: durum, createdAt: an(-1) } });
});
afterAll(async () => {
  await admin.$executeRaw`DELETE FROM audit_log WHERE tenant_id = ANY(${ids}::uuid[])`;
  await admin.platformGorev.deleteMany({ where: { olusturanId: aktor } });
  await admin.tenant.deleteMany({ where: { id: { in: ids } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformBuyumeOdemesi.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformFirmaGunlukOzeti.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformFirmaGunlukKullanici.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformKullanici.delete({ where: { id: aktor } });
  await admin.platformIstatistikAyari.update({ where: { id: 1 }, data: { baslangic: eskiGun } });
  await admin.platformBuyumeAyari.update({ where: { id: 1 }, data: { baslangic: eskiYasam } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});

describe("kullanıma başlama ve bekleyen işler — gerçek PostgreSQL", () => {
  it("yalnız tam gözlenen yeni firma başlamayan sayılır; geçmişi eksik ve eski firmalar belirsizdir", async () => {
    expect((await baslama()).sayilar).toEqual({ baslayan: 1, baslamayan: 2, belirsiz: 3 });
    expect((await baslama(a)).sayilar).toEqual({ baslayan: 0, baslamayan: 1, belirsiz: 0 });
    for (const id of [c, d, e]) expect((await baslama(id)).sayilar.belirsiz).toBe(1);
    expect((await baslama(yeni)).toplam).toBe(0);
    expect((await baslama(null, "belirsiz")).kayitlar.map((r) => r.tenantId).sort()).toEqual([c, d, e].sort());
  });
  it("bugün kesime dahil edilmez; dönem başlangıcı yerine yaşam boyu gözlem ve kapanmış gün kullanılır", async () => {
    expect((await baslama(a, "baslamayan", 1, bugunTR())).kesimGunu).toBe(gun(-1));
    expect((await baslama(b, "baslayan")).sayilar.baslayan).toBe(1);
    const r = await platformBaglamiylaCalistir({ kullaniciId: aktor, eposta: "test@ornek.invalid", rol: "yonetici" }, () => service.rapor(istatistikFiltreSemasi.parse({ baslangic: gun(-1), bitis: gun(-1), firma: b })));
    expect(r.donem.etkinFirma).toBe(0);
    expect(r.baslama).toMatchObject({ sayilar: { baslayan: 1 } });
  });
  it("eksik/eski sürümlü gün belirsizlik üretir; gözlenen pozitif etkinlik eksik günde de kaybolmaz", async () => {
    const marker = await admin.platformIstatistikGunu.findUniqueOrThrow({ where: { gun: new Date(`${gun(-1)}T00:00:00Z`) } });
    await admin.platformIstatistikGunu.update({ where: { gun: marker.gun }, data: { surum: 0 } });
    try {
      expect((await baslama(a)).sayilar.belirsiz).toBe(1);
      expect((await baslama(b, "baslayan")).sayilar.baslayan).toBe(1);
    } finally { await admin.platformIstatistikGunu.update({ where: { gun: marker.gun }, data: { surum: marker.surum } }); }
    const eski = await baslama(null, "baslamayan", 1, gun(-9));
    expect(eski).toMatchObject({ hazir: false, toplam: null, kayitlar: [], sayilar: { baslamayan: null } });
  });
  it("geçmiş kesim paketini ve mevcutluğu kullanır; boş sayfada toplam korunur", async () => {
    await paketler.gecir(f, `${plan}_yeni`);
    expect((await baslama(f)).toplam).toBe(1);
    expect((await baslama(f, "baslamayan", 1, gun(-1), `${plan}_yeni`)).toplam).toBe(0);
    expect(await baslama(a, "baslamayan", 2)).toMatchObject({ toplam: 1, kayitlar: [] });
    await admin.tenant.delete({ where: { id: f } });
    // Şimdi silinmiş olsa da dünün sayısal sınıflandırmasında durur.
    expect((await baslama(f)).toplam).toBe(1);
  });
  it("bekleyen işlem sayısı durum sözlüğüyle aynı firma listesinden gelir, hatalar yeniden eklenmez", async () => {
    const r = await operasyon();
    expect(r.sayilar).toEqual({ toplam: 7, gorev: 2, fatura: 3, iade: 2, hatali: 2 });
    expect(r).toMatchObject({ filtreliIs: 7, firmaToplam: 1, kayitlar: [{ tenantId: a, toplam: 7, gorev: 2, fatura: 3, iade: 2, hatali: 2 }] });
    expect(await operasyon("fatura")).toMatchObject({ filtreliIs: 3, kayitlar: [{ fatura: 3, gorev: 0, iade: 0, toplam: 3, hatali: 1 }] });
    expect(await operasyon("hepsi", 2)).toMatchObject({ firmaToplam: 1, filtreliIs: 7, kayitlar: [] });
    expect((await operasyon("hepsi", 1, b)).filtreliIs).toBe(0); // faturalayan değil ödeyen firma
  });
  it("canlı paket/firma kapsamı uygulanır; kapanan işler sayıdan ve listeden birlikte düşer", async () => {
    expect((await operasyon("hepsi", 1, a, plan)).filtreliIs).toBe(7);
    await paketler.gecir(a, `${plan}_yeni`);
    expect((await operasyon("hepsi", 1, a, plan)).filtreliIs).toBe(0);
    await admin.platformGorev.updateMany({ where: { tenantId: a, durum: "acik" }, data: { durum: "tamamlandi" } });
    expect((await operasyon()).filtreliIs).toBe(6);
    expect((await baslama(a)).toplam).toBe(1); // canlı paket değişimi dünü değiştirmez
  });
  it("API ham içerik taşımaz; uygulama rolü ve geçersiz filtreler işlevlere erişemez", async () => {
    await expect(app.$queryRaw`SELECT platform_kullanima_baslama(${gun(-1)}::date, NULL, NULL, 'baslamayan', 1)`).rejects.toThrow(/permission denied/);
    await expect(app.$queryRaw`SELECT platform_bekleyen_isler(NULL, NULL, 'hepsi', 1)`).rejects.toThrow(/permission denied/);
    await expect(baslama(null, "DROP")).rejects.toThrow(/Gecersiz/);
    await expect(baslama(null, "baslamayan", 0)).rejects.toThrow(/Gecersiz/);
    await expect(operasyon("DROP")).rejects.toThrow(/Gecersiz/);
    const metin = JSON.stringify([await baslama(), await operasyon()]);
    for (const gizli of [kisi, "GIZLI-GOREV", "GIZLI-HATA", "GIZLI-IADE", "odemeId", "user_id"]) expect(metin).not.toContain(gizli);
  });
});
