import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baglamlaCalistir } from "../src/core/istek-baglami";
import { DonemKilidiService } from "../src/donem-kapatma/donem-kilidi.service";
import { KurFarkiService } from "../src/fatura/kur-farki.service";
import { baglanmamisOdemeler } from "../src/kasa-banka/baglanmamis-odeme";
import { bagDuzeltmeleriniGeriAl, DovizBaglamaService } from "../src/kasa-banka/doviz-baglama.service";

/**
 * KSB-19…24: faturasız girilmiş TL tahsilatın sonradan USD faturalara
 * bağlanması gerçek PostgreSQL'de, uygulama rolüyle (RLS ve cari hareketinde
 * UPDATE yetkisi yok). Karşılık, cari düzeltmesi, kur farkı, kapalı dönem,
 * bağı çözme ve "bağlanmamış tahsilat" uyarısı doğrulanır.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const userId = randomUUID();
const cariId = randomUUID();
const bankaId = randomUUID();
const fisId = randomUUID();
const [usd1, usd2, tl1] = [randomUUID(), randomUUID(), randomUUID()];

const prisma = {
  tenantIslem: <T>(t: string, fn: (tx: never) => Promise<T>, secenek?: { timeout?: number }) =>
    uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx as never);
    }, { timeout: secenek?.timeout ?? 30_000 }),
};
const servis = new DovizBaglamaService(prisma as never, new DonemKilidiService(prisma as never));
const kurFarki = new KurFarkiService(prisma as never, null as never);
const calistir = <T>(fn: () => Promise<T>) => baglamlaCalistir({ tenantId, userId, rol: "muhasebe" } as never, fn);
const oku = <T>(fn: (tx: PrismaClient) => Promise<T>) => prisma.tenantIslem(tenantId, fn as never) as Promise<T>;

beforeAll(async () => {
  const y = yonetim;
  await y.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Döviz Bağlama Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await y.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`baglama-${userId}@test.local`}, 'x', 'Test Muhasebe', 'muhasebe', now())`;
  await y.$executeRaw`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, updated_at) VALUES (${cariId}::uuid, ${tenantId}::uuid, 'MUS-IHR', 'MUSTER EXPORT GMBH', 'musteri', now())`;
  await y.$executeRaw`INSERT INTO banka_hesaplari (id, tenant_id, ad, banka_adi, updated_at) VALUES (${bankaId}::uuid, ${tenantId}::uuid, 'Ziraat TL', 'Ziraat', now())`;
  // Fiş tarihinin USD kuru: alış 42, satış 43 (tahsilatta alış kullanılır).
  await y.$executeRaw`INSERT INTO elle_kurlar (id, tenant_id, tarih, doviz_cinsi, doviz_alis, doviz_satis, user_id, gerekce, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, '2026-03-10', 'USD', 42, 43, ${userId}::uuid, 'test', now(), now())`;
  const fatura = (id: string, no: string, doviz: string, kur: number, toplam: number) =>
    y.$executeRawUnsafe(`INSERT INTO faturalar (id, tenant_id, no, tip, durum, tarih, vade_tarihi, cari_id, doviz_cinsi, kur, toplam_brut, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_matrah, toplam_kdv, toplam_tevkifat, toplam_net_kdv, genel_toplam, created_at, updated_at)
      VALUES ($1::uuid, $2::uuid, $3, 'satis', 'kesin', '2026-03-01', '2026-03-05', $4::uuid, $5::"DovizCinsi", $6, $7, 0, 0, $7, 0, 0, 0, $7, now(), now())`, id, tenantId, no, cariId, doviz, kur, toplam);
  await fatura(usd1, "IHR2026000000001", "USD", 40, 1000);
  await fatura(usd2, "IHR2026000000002", "USD", 40, 500);
  await fatura(tl1, "SNC2026000000001", "TRY", 1, 300);
  await y.$executeRaw`INSERT INTO kasa_banka_hareketleri (id, tenant_id, banka_hesap_id, tip, tutar, doviz_cinsi, kur, tutar_try, tarih, cari_id, kaynak_tur, aciklama, created_at) VALUES (${fisId}::uuid, ${tenantId}::uuid, ${bankaId}::uuid, 'tahsilat', 50300, 'TRY', 1, 50300, '2026-03-10', ${cariId}::uuid, 'manuel', 'GELEN EFT', now())`;
  await y.$executeRaw`INSERT INTO cari_hareketler (id, tenant_id, cari_id, tip, tutar, doviz_cinsi, kur, tutar_try, tarih, kaynak_tur, kaynak_ref) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${cariId}::uuid, 'alacak', 50300, 'TRY', 1, 50300, '2026-03-10', 'kasa_banka', ${fisId})`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("ödemeyi sonradan farklı dövizli faturaya bağlama (KSB-19…24)", () => {
  it("önizleme bağlanmamış tutarı, her dövizdeki açık faturayı ve fiş tarihinin kurunu verir; uyarı tutarı görünür", async () => {
    const o = await calistir(() => servis.onizle(fisId));
    expect(o.fis.bosta).toBe("50300.00");
    expect(o.kapaliDonem).toBe(false);
    expect(o.faturalar.map((f) => [f.no, f.dovizCinsi, f.kalan, f.kur])).toEqual([
      ["IHR2026000000001", "USD", "1000.00", "42.000000"],
      ["IHR2026000000002", "USD", "500.00", "42.000000"],
      ["SNC2026000000001", "TRY", "300.00", "1.000000"],
    ]);
    expect((await oku((tx) => baglanmamisOdemeler(tx as never, [cariId], "tahsilat"))).get(cariId)?.toFixed(2)).toBe("50300.00");
  });

  it("aşan tutar ve kalanı aşan karşılık reddedilir", async () => {
    await expect(calistir(() => servis.bagla(fisId, [{ faturaId: usd1, tutar: "50301.00" }]))).rejects.toThrow(/bağlanmamış 50300.00 TRY/);
    await expect(calistir(() => servis.bagla(fisId, [{ faturaId: usd2, tutar: "30000.00" }]))).rejects.toThrow(/kalanı \(500.00\) aşıyor/);
  });

  it("karşılık kurla ya da elle; cari hareketi USD'ye taşınır, TL değeri değişmez; kalan TL vadeye göre TL faturayı kapatır", async () => {
    const s = await calistir(() => servis.bagla(fisId, [{ faturaId: usd1, tutar: "42000.00" }, { faturaId: usd2, tutar: "8000.00", karsilik: "190.00" }]));
    expect(s.baglar.map((b) => [b.no, b.tutar, b.karsilik])).toEqual([["IHR2026000000001", "42000.00", "1000.00"], ["IHR2026000000002", "8000.00", "190.00"]]);

    const kapamalar = await yonetim.faturaKapama.findMany({ where: { tenantId }, orderBy: { tutar: "desc" } });
    expect(kapamalar.map((k) => [k.faturaId, k.tutar.toFixed(2), k.kaynakTutari?.toFixed(2) ?? null, k.otomatik])).toEqual([
      [usd1, "1000.00", "42000.00", false], [tl1, "300.00", null, true], [usd2, "190.00", "8000.00", false],
    ]);
    const duzeltmeler = await yonetim.cariHareket.findMany({ where: { tenantId, kaynakTur: "doviz_baglama" }, orderBy: [{ tutarTry: "desc" }, { dovizCinsi: "asc" }] });
    expect(duzeltmeler.map((h) => [h.tip, h.dovizCinsi, h.tutar.toFixed(2), h.tutarTry.toFixed(2)])).toEqual([
      ["borc", "TRY", "42000.00", "42000.00"], ["alacak", "USD", "1000.00", "42000.00"],
      ["borc", "TRY", "8000.00", "8000.00"], ["alacak", "USD", "190.00", "8000.00"],
    ]);
    const tlNet = await yonetim.cariHareket.aggregate({ where: { tenantId, dovizCinsi: "TRY", tip: "alacak" }, _sum: { tutar: true } });
    expect(tlNet._sum.tutar?.toFixed(2)).toBe("50300.00");
    expect((await calistir(() => servis.onizle(fisId))).fis.bosta).toBe("300.00");
    expect((await oku((tx) => baglanmamisOdemeler(tx as never, [cariId], "tahsilat"))).has(cariId)).toBe(false);
  });

  it("kur farkı listesine girer: ödemenin TL değeri − fatura kurundaki TL değeri", async () => {
    const liste = await calistir(() => kurFarki.liste("bekleyen"));
    expect(liste.map((k) => [k.fatura.no, k.tutar, k.mahsup, k.kurFarkiTry, k.yon]).sort()).toEqual([
      ["IHR2026000000001", "42000.00", "1000.00", "2000.00", "biz_keseriz"],
      ["IHR2026000000002", "8000.00", "190.00", "400.00", "biz_keseriz"],
    ]);
    await calistir(() => kurFarki.kapat([liste[0].hareketId]));
    expect(await calistir(() => kurFarki.liste("bekleyen"))).toHaveLength(1);
    await calistir(() => kurFarki.geriAc([liste[0].hareketId]));
    expect(await calistir(() => kurFarki.liste("bekleyen"))).toHaveLength(2);
  });

  it("kapalı dönemde bağ çözülmez; açılınca çözülür ve cari düzeltmesi gider", async () => {
    const kapama = await yonetim.faturaKapama.findFirstOrThrow({ where: { tenantId, faturaId: usd2 } });
    await yonetim.$executeRaw`INSERT INTO mali_donemler (id, tenant_id, yil, ay, durum, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 2026, 3, 'kapali', now())`;
    await expect(calistir(() => servis.coz(kapama.id))).rejects.toThrow(/mali dönemi kapalı/);
    await expect(calistir(() => servis.bagla(fisId, [{ faturaId: usd2, tutar: "100.00" }]))).rejects.toThrow(/mali dönemi kapalı/);
    await yonetim.$executeRaw`DELETE FROM mali_donemler WHERE tenant_id = ${tenantId}::uuid`;

    await calistir(() => servis.coz(kapama.id));
    expect(await yonetim.faturaKapama.count({ where: { id: kapama.id } })).toBe(0);
    expect(await yonetim.cariHareket.count({ where: { kaynakTur: "doviz_baglama", kaynakRef: kapama.id } })).toBe(0);
    expect((await calistir(() => servis.onizle(fisId))).fis.bosta).toBe("8300.00");
    expect(await yonetim.auditLog.count({ where: { tenantId, islem: { in: ["odeme_faturaya_baglandi", "odeme_fatura_bagi_cozuldu"] } } })).toBe(2);
  });

  it("bağlanmamış tutar carinin alacaklı bakiyesini aşmaz (karşı yön kaynağı kapama yazmadan netleşir)", async () => {
    const tutar = async () => (await oku((tx) => baglanmamisOdemeler(tx as never, [cariId], "tahsilat"))).get(cariId)?.toFixed(2);
    // Fişte elle bağlanmamış 8.300; 300'ü TL faturayı otomatik kapatıyor.
    expect(await tutar()).toBe("8000.00");
    // Cariye ciro edilen çek gibi faturasız bir borç tahsilattan netleşir; bağlanmamış görünmemeli.
    await yonetim.$executeRaw`INSERT INTO cari_hareketler (id, tenant_id, cari_id, tip, tutar, doviz_cinsi, kur, tutar_try, tarih, kaynak_tur) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${cariId}::uuid, 'borc', 1000, 'TRY', 1, 1000, '2026-03-11', 'cek_senet_ciro')`;
    expect(await tutar()).toBe("7300.00");
  });

  it("fiş kapalı dönemde ters kayıtla geri alınırsa cari düzeltmesinin tersi bugün yazılır", async () => {
    await oku((tx) => bagDuzeltmeleriniGeriAl(tx as never, tenantId, [fisId], { tarih: "2026-10-23" }));
    const tersler = await yonetim.cariHareket.findMany({ where: { tenantId, kaynakTur: "doviz_baglama_iptal" } });
    expect(tersler.map((h) => [h.tip, h.dovizCinsi, h.tutar.toFixed(2), h.tarih.toISOString().slice(0, 10)]).sort()).toEqual([
      ["alacak", "TRY", "42000.00", "2026-10-23"], ["borc", "USD", "1000.00", "2026-10-23"],
    ]);
  });
});
