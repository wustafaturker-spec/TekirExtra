import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AracTakipService } from "../src/arac-takip/arac-takip.service";
import { BildirimUreticiService } from "../src/bildirimler/bildirim-uretici.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { DemirbasService } from "../src/demirbas/demirbas.service";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";

/**
 * ARC-01…09: araç takibi gerçek PostgreSQL'de, uygulama rolüyle (RLS).
 * Demirbaş bağı, yükümlülük ve bildirim, plakadan gider önerisi ve bağı, km
 * kuralı, bakım planı, binek KKEG (oran + kiralık kira sınırı), çıkışta pasif.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const userId = randomUUID();
const [aracId, kiralikId, kategoriId, kiraKategoriId, kiraId, yakitMasraf, kiraMasraf1, kiraMasraf2] = Array.from({ length: 8 }, () => randomUUID());
let demirbasId = "";

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 30_000 }),
};
const servis = new AracTakipService(prisma as never);
const demirbas = new DemirbasService(prisma as never, new DonemKilidiService(prisma as never), { getir: async () => ({ defterTuru: "bilanco" }) } as never);
const calistir = <T>(fn: () => Promise<T>, rol = "muhasebe") => baglamlaCalistir({ tenantId, userId, rol } as never, fn);
const gunSonra = (n: number) => { const d = new Date(`${bugunTR()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Araç Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`arac-${userId}@test.local`}, 'x', 'Test Muhasebe', 'muhasebe', now())`;
  await y.$executeRaw`INSERT INTO araclar (id, tenant_id, plaka, updated_at) VALUES (${aracId}::uuid, ${tenantId}::uuid, '34 ABC 123', now()), (${kiralikId}::uuid, ${tenantId}::uuid, '06 KRL 06', now())`;
  await y.$executeRaw`INSERT INTO masraf_kategorileri (id, tenant_id, ad, updated_at) VALUES (${kategoriId}::uuid, ${tenantId}::uuid, 'Akaryakıt ve Ulaşım', now()), (${kiraKategoriId}::uuid, ${tenantId}::uuid, 'Kira', now())`;
  await y.$executeRaw`INSERT INTO kira_sozlesmeleri (id, tenant_id, kategori_id, baslik, baslangic_tarihi, matrah, updated_at) VALUES (${kiraId}::uuid, ${tenantId}::uuid, ${kiraKategoriId}::uuid, 'Kiralık binek', '2026-01-01', 50000, now())`;
  const masraf = (id: string, kat: string, tarih: string, matrah: number, aciklama: string, kira: string | null) =>
    y.$executeRawUnsafe(`INSERT INTO masraflar (id, tenant_id, kategori_id, belge_turu, tarih, matrah, kdv_tutari, toplam, durum, aciklama, kira_sozlesme_id, updated_at)
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'fis', $4::date, $5, 0, $5, 'onaylandi', $6, $7::uuid, now())`, id, tenantId, kat, tarih, matrah, aciklama, kira);
  await masraf(yakitMasraf, kategoriId, "2026-03-10", 2000, "OPET motorin 34ABC123", null);
  await masraf(kiraMasraf1, kiraKategoriId, "2026-03-01", 50000, "Mart kirası", kiraId);
  await masraf(kiraMasraf2, kiraKategoriId, "2026-04-01", 40000, "Nisan kirası", kiraId);
  const d = await calistir(() => demirbas.olustur({ ad: "Binek araç", sinif: "tasit", faydaliOmur: 5, yontem: "normal", binekOto: true, binekVergili: false, binekSinirYok: false, edinmeTarihi: "2026-01-05", edinmeBedeli: 900000, adet: 1, acilis: false, acilisBirikmis: 0, uyarilariKabulEt: true }));
  demirbasId = d.olusturuldu ? d.idler[0] : "";
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("araç takibi (ARC-01…09)", () => {
  it("öz mal araç yalnız taşıt demirbaşına bağlanır; kiralık araç kira sözleşmesine", async () => {
    await expect(calistir(() => servis.guncelle(aracId, { mulkiyet: "kiralik", demirbasId }))).rejects.toThrow(/yalnız öz mal/);
    await calistir(() => servis.guncelle(aracId, { tur: "binek", mulkiyet: "oz", demirbasId, marka: "Renault", model: "Clio", bakimKmAraligi: 15000, bakimAyAraligi: 12 }));
    await calistir(() => servis.guncelle(kiralikId, { tur: "binek", mulkiyet: "kiralik", kiraSozlesmeId: kiraId }));
    const a = await calistir(() => servis.getir(aracId));
    expect([a.demirbas?.ad, a.marka]).toEqual(["Binek araç", "Renault"]);
  });

  it("yükümlülük 7 gün içinde bitiyorsa yaklaşanlarda ve bildirimde çıkar", async () => {
    await calistir(() => servis.yukumlulukEkle(aracId, { tur: "muayene", bitis: gunSonra(5), belgeNo: "M-1" }));
    await calistir(() => servis.yukumlulukEkle(aracId, { tur: "kasko", bitis: gunSonra(200) }));
    const y = await calistir(() => servis.yaklasanlar());
    expect(y.map((x) => [x.plaka, x.tur, x.durum])).toEqual([["34 ABC 123", "muayene", "7"]]);
    const uretici = new BildirimUreticiService(prisma as never, {} as never, {} as never);
    const b = await calistir(() => (uretici as unknown as { aracUyarilari(): Promise<Array<{ birlesimAnahtari: string; onem: string }>> }).aracUyarilari());
    expect(b.map((x) => [x.birlesimAnahtari.split(":").slice(0, 2).join(":"), x.birlesimAnahtari.split(":").at(-1), x.onem])).toEqual([["vade:arac", "7", "uyari"]]);
  });

  it("plakanın geçtiği masraf önerilir, kategori tahmin edilir; bağ km yazar, aynı kayıt ikinci kez bağlanmaz", async () => {
    const adaylar = await calistir(() => servis.giderAdaylari(aracId, {}));
    expect(adaylar.map((x) => [x.id, x.kategori, x.tutarTry?.toFixed(2)])).toEqual([[yakitMasraf, "akaryakit", "2000.00"]]);
    await calistir(() => servis.giderBagla(aracId, { masrafId: yakitMasraf, kategori: "akaryakit", litre: 45, km: 20000 }));
    await expect(calistir(() => servis.giderBagla(kiralikId, { masrafId: yakitMasraf, kategori: "akaryakit" }))).rejects.toThrow(/başka bir araca bağlı/);
    expect((await calistir(() => servis.getir(aracId))).km).toBe(20000);
  });

  it("düşük km gerekçe ister; bakım planı ilerletir", async () => {
    await expect(calistir(() => servis.kmEkle(aracId, { tarih: "2026-03-15", km: 19000 }))).rejects.toThrow(/gerekçe/);
    await calistir(() => servis.kmEkle(aracId, { tarih: "2026-03-15", km: 19000, gerekce: "gösterge değişti" }));
    await calistir(() => servis.bakimEkle(aracId, { tarih: "2026-03-20", km: 20500, aciklama: "Periyodik bakım" }));
    const a = await calistir(() => servis.getir(aracId));
    expect([a.sonBakimTarihi, a.sonBakimKm, a.bakim?.km, a.bakim?.tarih]).toEqual(["2026-03-20", 20500, 35500, "2027-03-20"]);
  });

  it("binek KKEG: kira dışı giderin %30'u; kiralıkta kira sözleşmesi masraflarının aylık sınırı aşan kısmı", async () => {
    const r = await calistir(() => servis.rapor("2026-01-01", "2026-12-31"));
    const oz = r.satirlar.find((s) => s.id === aracId)!;
    const kiralik = r.satirlar.find((s) => s.id === kiralikId)!;
    expect([oz.toplam, oz.kkeg?.kiraDisiKkeg, oz.kkeg?.toplamKkeg]).toEqual([2000, 600, 600]);
    expect([kiralik.kategoriler.kira, kiralik.kkeg?.kiraKkeg, kiralik.kkeg?.aylar.map((x) => x.kkeg)]).toEqual([90000, 4000, [4000, 0]]);
    expect([r.binekGiderOrani, r.toplamKkeg]).toEqual([70, 4600]);
  });

  it("demirbaş elden çıkınca araç pasif olur", async () => {
    await calistir(() => demirbas.cikis(demirbasId, { tur: "hurda", tarih: "2026-03-01", gerekce: "Kaza sonrası hurda" }));
    expect((await yonetim.arac.findUnique({ where: { id: aracId } }))?.aktif).toBe(false);
  });
});
