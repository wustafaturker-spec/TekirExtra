import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { CariBirlestirmeService } from "../src/cari/cari-birlestirme.service";

/**
 * CARI-56…62: mükerrer cari raporu ve birleştirme gerçek PostgreSQL'de,
 * uygulama rolüyle (RLS altında). Bağların katalogdan bulunması, tekil
 * kısıt çakışmaları, kapalı dönem engeli ve iz kaydı doğrulanır.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const userId = randomUUID();
const [ana, tasinan, kapali, personel, baska] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const etiket = randomUUID();
const IBAN = "TR120006200000000000000001";

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 30_000 }),
};
const servis = new CariBirlestirmeService(prisma as never, { bakiyeleriGetir: async () => new Map() } as never);
const calistir = <T>(fn: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol: "yonetici" } as never, fn);

beforeAll(async () => {
  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Birleştirme Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`birlestirme-${userId}@test.local`}, 'x', 'Test Yönetici', 'yonetici', now())`;
  const kart = (id: string, kod: string, unvan: string, ek: { vkn?: string; eposta?: string; tip?: string } = {}) =>
    y.$executeRawUnsafe(`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, vkn_tckn, eposta, updated_at) VALUES ($1::uuid, $2::uuid, $3, $4, $5::"CariTip", $6, $7, now())`,
      id, tenantId, kod, unvan, ek.tip ?? "musteri", ek.vkn ?? null, ek.eposta ?? null);
  await kart(ana, "120.D.009", "DUNKA GIDA DIŞ TİC SAN LTD ŞTİ", { vkn: "3000048938" });
  await kart(tasinan, "120.D.021", "DÜNKA GIDA DIŞ TİÇ. LTD.ŞTİ.", { vkn: "3000048938", eposta: "muhasebe@dunka.test" });
  await kart(kapali, "120.D.030", "DUNKA GIDA", { vkn: "3000048938" });
  await kart(personel, "PRS-1", "MELEK TÜRKER", { vkn: "21125695124", tip: "personel" });
  await kart(baska, "MUS-1", "MELEK TÜRKER", { vkn: "21125695124" });

  const hareket = (cari: string, tarih: string) =>
    y.$executeRawUnsafe(`INSERT INTO cari_hareketler (id, tenant_id, cari_id, tip, tutar, tutar_try, tarih) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'borc', 100, 100, $3::date)`, tenantId, cari, tarih);
  await hareket(ana, "2026-09-01");
  await hareket(tasinan, "2026-09-02");
  await hareket(tasinan, "2026-09-03");
  await hareket(kapali, "2025-01-15");
  await y.$executeRaw`INSERT INTO mali_donemler (id, tenant_id, yil, ay, durum, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 2025, 1, 'kapali', now())`;

  await y.$executeRaw`INSERT INTO cari_adresler (id, tenant_id, cari_id, tip, baslik, adres) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${tasinan}::uuid, 'sevk', 'Depo', 'Organize Sanayi')`;
  await y.$executeRaw`INSERT INTO cari_banka_hesaplari (id, tenant_id, cari_id, banka_adi, iban) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${ana}::uuid, 'Ziraat', ${IBAN})`;
  await y.$executeRaw`INSERT INTO cari_banka_hesaplari (id, tenant_id, cari_id, banka_adi, iban) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${tasinan}::uuid, 'Ziraat', ${"TR12 0006 2000 0000 0000 0000 01"})`;
  await y.$executeRaw`INSERT INTO cari_banka_hesaplari (id, tenant_id, cari_id, banka_adi, iban) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${tasinan}::uuid, 'İş', 'TR990006400000000000000002')`;
  await y.$executeRaw`INSERT INTO cari_etiketleri (id, tenant_id, ad) VALUES (${etiket}::uuid, ${tenantId}::uuid, 'Gıda')`;
  for (const c of [ana, tasinan]) await y.$executeRaw`INSERT INTO cari_etiket_atamalari (id, tenant_id, cari_id, etiket_id) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${c}::uuid, ${etiket}::uuid)`;
  await y.$executeRaw`INSERT INTO ekstre_kurallari (id, tenant_id, anahtar, yon, eslesme_turu, cari_id, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'DUNKA', 'giris', 'cari', ${tasinan}::uuid, now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("mükerrer cari birleştirme (CARI-56…62)", () => {
  it("rapor aynı VKN'li kartları gruplar, personel kartını 'farklı rol' gösterir", async () => {
    const r = await calistir(() => servis.rapor());
    const dunka = r.gruplar.find((g) => g.kartlar.some((k) => k.id === ana))!;
    expect(dunka.tur).toBe("ayni_kimlik");
    expect(dunka.kartlar.map((k) => k.id).sort()).toEqual([ana, tasinan, kapali].sort());
    expect(dunka.kartlar.find((k) => k.id === tasinan)).toMatchObject({ hareketSayisi: 2, sonHareket: "2026-09-03" });
    const melek = r.gruplar.find((g) => g.kartlar.some((k) => k.id === personel))!;
    expect(melek).toMatchObject({ tur: "farkli_rol", birlestirilebilir: false });
  });

  it("önizleme taşınacak kayıtları, dolacak alanları ve engelleri söyler", async () => {
    const o = await calistir(() => servis.onizleme(ana, [tasinan, kapali, personel]));
    expect(o.birlestirilebilir).toBe(false);
    const t = o.tasinanlar.find((x) => x.cari.id === tasinan)!;
    expect(t.engeller).toEqual([]);
    expect(t.kayitlar).toEqual(expect.arrayContaining([{ ad: "Cari hareket", adet: 2 }, { ad: "Adres", adet: 1 }, { ad: "Banka hesabı", adet: 2 }, { ad: "Ekstre kuralı", adet: 1 }]));
    expect(t.doldurulacaklar).toEqual(["E-posta"]);
    expect(o.tasinanlar.find((x) => x.cari.id === kapali)!.engeller).toEqual(["kapalı mali dönemde 1 cari hareket kaydı var"]);
    expect(o.tasinanlar.find((x) => x.cari.id === personel)!.engeller[0]).toContain("personel kartı");
  });

  it("engelli kart varken hiçbir şey taşınmaz", async () => {
    await expect(calistir(() => servis.birlestir(ana, [tasinan, kapali]))).rejects.toThrow(/kapalı mali dönemde/);
    const [{ adet }] = await yonetim.$queryRaw<Array<{ adet: number }>>`SELECT count(*)::int AS adet FROM cari_hareketler WHERE cari_id = ${tasinan}::uuid`;
    expect(adet).toBe(2);
  });

  it("birleştirme kayıtları ana karta taşır, kopyaları düşürür, boş alanı doldurur ve iz bırakır", async () => {
    const s = await calistir(() => servis.birlestir(ana, [tasinan]));
    expect(s.sonuclar[0]).toMatchObject({ dusenKayit: 2, doldurulanlar: ["E-posta"] });

    const say = (tablo: string, cari: string) => yonetim.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${tablo} WHERE cari_id = $1::uuid`, cari).then((r) => r[0].n);
    expect(await say("cari_hareketler", ana)).toBe(3);
    expect(await say("cari_hareketler", tasinan)).toBe(0);
    expect(await say("cari_adresler", ana)).toBe(1);
    expect(await say("cari_banka_hesaplari", ana)).toBe(2);
    expect(await say("cari_etiket_atamalari", ana)).toBe(1);
    expect(await say("ekstre_kurallari", ana)).toBe(1);

    const kartlar = await yonetim.cariHesap.findMany({ where: { id: { in: [ana, tasinan] } }, select: { id: true, aktif: true, birlestigiCariId: true, eposta: true } });
    expect(kartlar.find((k) => k.id === ana)).toMatchObject({ aktif: true, birlestigiCariId: null, eposta: "muhasebe@dunka.test" });
    expect(kartlar.find((k) => k.id === tasinan)).toMatchObject({ aktif: false, birlestigiCariId: ana });

    const iz = await yonetim.cariBirlestirme.findFirstOrThrow({ where: { tenantId, tasinanCariId: tasinan } });
    expect(iz).toMatchObject({ anaCariId: ana, userId, dusenler: { cari_banka_hesaplari: 1, cari_etiket_atamalari: 1 }, doldurulanlar: { eposta: "muhasebe@dunka.test" } });
    expect(iz.tasinanlar).toMatchObject({ "cari_hareketler.cari_id": 2, "cari_adresler.cari_id": 1, "ekstre_kurallari.cari_id": 1 });
    expect(await yonetim.auditLog.count({ where: { tenantId, islem: "cari_birlestir", varlikId: ana } })).toBe(1);
  });

  it("birleşen kart rapora girmez, ikinci kez taşınamaz; 'aynı değil' işareti grubu gizler", async () => {
    const r = await calistir(() => servis.rapor());
    expect(r.gruplar.some((g) => g.kartlar.some((k) => k.id === tasinan))).toBe(false);
    await expect(calistir(() => servis.birlestir(ana, [tasinan]))).rejects.toThrow(/zaten başka bir karta birleştirilmiş/);

    await calistir(() => servis.istisnaEkle([ana, kapali]));
    const sonra = await calistir(() => servis.rapor());
    expect(sonra.gruplar.some((g) => g.kartlar.some((k) => k.id === kapali))).toBe(false);
    const [isaret] = await calistir(() => servis.istisnalar());
    await calistir(() => servis.istisnaKaldir(isaret.id));
    expect((await calistir(() => servis.rapor())).gruplar.some((g) => g.kartlar.some((k) => k.id === kapali))).toBe(true);
  });

  it("başka kiracı bu kiracının kartlarını göremez ve birleştiremez", async () => {
    const yabanci = randomUUID();
    await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${yabanci}::uuid, 'Yabancı', ${String(Date.now() + 1).slice(-10)}, now(), now())`;
    const r = await baglamlaCalistir({ tenantId: yabanci, userId, rol: "yonetici" } as never, () => servis.rapor());
    expect(r.gruplar).toEqual([]);
    await expect(baglamlaCalistir({ tenantId: yabanci, userId, rol: "yonetici" } as never, () => servis.birlestir(ana, [kapali]))).rejects.toThrow(/Cari bulunamadı/);
  });
});
