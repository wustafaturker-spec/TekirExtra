import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raporTanimlari, type RaporGirdisi, type RaporTanimi } from "../src/core/raporlar/rapor-kayit";
import { faturaPivotu, pivotSorgusuCoz } from "../src/rapor/fatura-pivot";
import { cariBakiyeToplamlari, envanterDegerlemesi } from "../src/rapor/varlik-ozeti";
import "../src/cari/cari.raporlar";
import "../src/fatura/fatura.raporlar";
import "../src/fatura/vergi.raporlar";
import "../src/kasa-banka/kasa-banka.raporlar";
import "../src/stok/stok.raporlar";
import "../src/stok/urun-hareket.raporlar";

/**
 * RPR-23 (inceleme P2-8): rapor kataloğunun gerçek veritabanında koşusu.
 * Önce boş kiracıda her rapor zorunlu süzgeçleriyle hatasız çalışmalı; sonra
 * küçük bir veri setiyle (bir satış faturası, stok ve kasa hareketi) her
 * satır tanımdaki bütün sütunları taşımalı ve bilinen toplamlar tutmalı.
 * Uygulama rolüyle, RLS altında çalışır.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const tenantId = randomUUID();
const cariId = randomUUID(), stokId = randomUUID(), depoId = randomUUID(), kasaId = randomUUID(), faturaId = randomUUID();

const baglamda = <T,>(fn: (tx: Tx) => Promise<T>) =>
  uygulama.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }, { timeout: 60_000 });

/** Zorunlu süzgeçleri doldurur; dönem her raporda 2026 yılı. */
function girdi(t: RaporTanimi): RaporGirdisi {
  const filtreler: Record<string, string | number | boolean> = {};
  for (const f of t.filtreler) {
    if (f.alan === "baslangic") filtreler.baslangic = "2026-01-01";
    else if (f.alan === "bitis") filtreler.bitis = "2026-12-31";
    else if (!f.zorunlu) continue;
    else if (f.tip === "cari") filtreler[f.alan] = cariId;
    else if (f.tip === "stok") filtreler[f.alan] = stokId;
    else if (f.tip === "depo") filtreler[f.alan] = depoId;
    else if (f.tip === "secim") filtreler[f.alan] = f.secenekler?.[0]?.deger ?? "";
    else if (f.tip === "sayi") filtreler[f.alan] = 2026;
    else if (f.tip === "tarih") filtreler[f.alan] = "2026-12-31";
  }
  return { filtreler };
}

const calistir = (t: RaporTanimi) => baglamda((tx) => t.calistir(girdi(t), { tenantId, tx }));

beforeAll(async () => {
  await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Rapor Kabul Test', ${String(Date.now()).slice(-10)}, now(), now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("rapor kataloğu (RPR-23)", () => {
  const tanimlar = raporTanimlari();

  it("katalogda raporlar kayıtlı", () => {
    expect(tanimlar.length).toBeGreaterThan(30);
  });

  it("boş kiracıda her rapor hatasız çalışır", async () => {
    const hatalar: string[] = [];
    for (const t of tanimlar) {
      try {
        expect(Array.isArray(await calistir(t))).toBe(true);
      } catch (e) {
        hatalar.push(`${t.kod}: ${e instanceof Error ? e.message.split("\n").slice(-1)[0] : String(e)}`);
      }
    }
    expect(hatalar).toEqual([]);
  });

  describe("veriyle", () => {
    beforeAll(async () => {
      await baglamda(async (tx) => {
        await tx.cariHesap.create({ data: { id: cariId, tenantId, kod: "C001", unvan: "Kabul Alıcı", tip: "musteri" } });
        await tx.depo.create({ data: { id: depoId, tenantId, kod: "D1", ad: "Merkez" } });
        await tx.stokKart.create({ data: { id: stokId, tenantId, kod: "U001", ad: "Kabul Ürün", mevcutMiktar: "40", ortalamaMaliyet: "60" } });
        await tx.kasa.create({ data: { id: kasaId, tenantId, ad: "Merkez Kasa" } });
        // 50 adet 60 TL'den giriş, 10 adet 100 TL'den satış (KDV %20).
        await tx.stokHareket.create({ data: { tenantId, stokId, depoId, tip: "acilis", miktar: "50", girilenBirim: "adet", girilenMiktar: "50", maliyet: "60", tarih: new Date("2026-03-01") } });
        await tx.fatura.create({
          data: {
            id: faturaId, tenantId, tip: "satis", durum: "kesin", no: "KBL2026000000001", tarih: new Date("2026-03-10"), vadeTarihi: new Date("2026-03-20"), cariId, depoId,
            toplamBrut: "1000", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamMatrah: "1000", toplamKdv: "200", toplamTevkifat: "0", toplamNetKdv: "200", genelToplam: "1200",
            satirlar: { create: [{ tenantId, stokId, miktar: "10", birimFiyat: "100", matrah: "1000", kdvOrani: "20", kdvTutari: "200", netKdvTutari: "200", toplamTutar: "1200" }] },
          },
        });
        await tx.stokHareket.create({ data: { tenantId, stokId, depoId, tip: "cikis", miktar: "-10", girilenBirim: "adet", girilenMiktar: "10", maliyet: "60", tarih: new Date("2026-03-10"), kaynakTur: "fatura", kaynakRef: faturaId } });
        await tx.cariHareket.create({ data: { tenantId, cariId, tip: "borc", tutar: "1200", tutarTry: "1200", tarih: new Date("2026-03-10"), kaynakTur: "fatura", kaynakRef: faturaId } });
        await tx.kasaBankaHareket.create({ data: { tenantId, kasaId, cariId, tip: "tahsilat", tutar: "500", tutarTry: "500", tarih: new Date("2026-03-15") } });
        await tx.cariHareket.create({ data: { tenantId, cariId, tip: "alacak", tutar: "500", tutarTry: "500", tarih: new Date("2026-03-15") } });
      });
    });

    it("her rapor çalışır ve satırlar tanımdaki bütün sütunları taşır", async () => {
      const hatalar: string[] = [];
      for (const t of tanimlar) {
        try {
          const satirlar = await calistir(t);
          for (const s of satirlar) {
            const eksik = t.kolonlar.filter((k) => !(k.alan in s)).map((k) => k.alan);
            if (eksik.length) { hatalar.push(`${t.kod}: eksik sütun ${eksik.join(", ")}`); break; }
          }
        } catch (e) {
          hatalar.push(`${t.kod}: ${e instanceof Error ? e.message.split("\n").slice(-1)[0] : String(e)}`);
        }
      }
      expect(hatalar).toEqual([]);
    });

    it("kâr özeti: net satış 1.000, SMM 600, brüt kâr 400", async () => {
      const t = tanimlar.find((x) => x.kod === "genel.kar-zarar-ozeti")!;
      const [satir] = await baglamda((tx) => t.calistir({ ...girdi(t), gruplama: "yok" }, { tenantId, tx }));
      expect(satir).toMatchObject({ netSatis: "1000.00", smm: "600.00", brutKar: "400.00" });
    });

    it("fatura pivotu ve panel varlıkları kayıtlı tutarlardan", async () => {
      const pivot = await baglamda((tx) => faturaPivotu(tx, tenantId, pivotSorgusuCoz({ baslangic: "2026-01-01", bitis: "2026-12-31", satir: "cari", sutun: "ay" })));
      expect(pivot.hucreler).toEqual([expect.objectContaining({ satir: cariId, sutun: "2026-03", matrah: 1000, kdv: 200, toplam: 1200, miktar: 10 })]);
      const envanter = await baglamda((tx) => envanterDegerlemesi(tx, tenantId));
      expect(envanter.deger.toNumber()).toBe(2400);
      const cari = await baglamda((tx) => cariBakiyeToplamlari(tx, tenantId));
      expect(cari.alacaklar.toNumber()).toBe(700);
    });

    it("stok devir hızı (dönem başı 0, sonu 40, satış 10 → devir 0,5) ve envanter değeri", async () => {
      const devir = tanimlar.find((x) => x.kod === "stok.devir-hizi")!;
      const [satir] = await calistir(devir);
      expect(satir).toMatchObject({ kod: "U001", donemBasi: 0, donemSonu: 40, satilanMiktar: 10, smm: "600.00", ortalamaStok: 20, devirHizi: 0.5 });
      const env = tanimlar.find((x) => x.kod === "stok.envanter")!;
      const [e] = await calistir(env);
      expect(e).toMatchObject({ kod: "U001", miktar: 40, envanterDegeri: "2400.00" });
    });
  });
});
