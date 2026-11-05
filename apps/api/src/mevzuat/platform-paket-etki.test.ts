import { describe, expect, it, vi } from "vitest";
import { paketFiyatEtkisi } from "./platform-paket-etki";
import { PlatformPaketService } from "./platform-paket.service";
import { PlatformPaketController } from "./platform-paket.controller";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";

const id = "00000000-0000-4000-8000-000000000001";
const kosullar = {
  semaSurumu: 1, kaynak: "eski_plan_gecisi", planKodu: "profesyonel", planAdi: "Profesyonel",
  limitler: { kullanici: 10, cari: 2500, stok: 5000, aylikFatura: 1000 },
  fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", donemler: [{ aySayisi: 1, matrah: "999" }] },
};
const abonelik = { planKodu: "profesyonel", paketSurumId: id, paketKosullari: kosullar };
const fiyat = { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "10", gecerlilikTarihi: "2026-12-01", donemler: [{ aySayisi: 1, matrah: "1200" }] };
const hedef = { planKodu: "profesyonel", fiyatlandirma: fiyat };

describe("katalog fiyat etkisi", () => {
  it("iki sözleşmenin vergisini ayrı hesaplar", () => {
    const r = paketFiyatEtkisi(abonelik, hedef);
    expect(r.karsilastirilabilir).toBe(true);
    expect(r.donemler[0]).toEqual({ aySayisi: 1,
      once: { matrah: "999.00", kdv: "199.80", toplam: "1198.80" },
      sonra: { matrah: "1200.00", kdv: "120.00", toplam: "1320.00" },
      fark: { matrah: "201.00", kdv: "-79.80", toplam: "121.20" },
    });
    expect(r.donemler[1]).toEqual({ aySayisi: 3, once: null, sonra: null, fark: null });
  });
  it("v1 kodunu aynı plan olarak karşılaştırır", () => {
    expect(paketFiyatEtkisi({ ...abonelik, planKodu: "v1" }, hedef).karsilastirilabilir).toBe(true);
  });
  it("indirimde negatif farkı ve yarım kuruş yuvarlamayı korur", () => {
    const r = paketFiyatEtkisi(abonelik, { ...hedef, fiyatlandirma: { ...fiyat, donemler: [{ aySayisi: 1, matrah: "0.05" }] } });
    expect(r.donemler[0].sonra?.kdv).toBe("0.01");
    expect(r.donemler[0].fark?.toplam).toBe("-1198.74");
  });
  it("olmayan kaynak dönemini aylık fiyattan türetmez", () => {
    const r = paketFiyatEtkisi(abonelik, { ...hedef, fiyatlandirma: { ...fiyat, donemler: [{ aySayisi: 12, matrah: "10000" }] } });
    expect(r.donemler[3]).toEqual({ aySayisi: 12, once: null, sonra: { matrah: "10000.00", kdv: "1000.00", toplam: "11000.00" }, fark: null });
  });
  it("kayıtlı bağı olmayan aboneliğe eski sabit fiyat atamaz", () => {
    const r = paketFiyatEtkisi({ planKodu: "profesyonel" }, hedef);
    expect(r.neden).toBe("kayitli_kosul_yok");
    expect(r.donemler[0].once).toBeNull();
    expect(r.donemler[0].fark).toBeNull();
  });
  it.each([null, "baslangic", "yeni_paket"])("farklı/eşlenmeyen hedef karşılaştırılmaz: %s", (planKodu) => {
    const r = paketFiyatEtkisi(abonelik, { ...hedef, planKodu });
    expect(r.neden).toBe("farkli_veya_eslenmeyen_plan");
    expect(r.donemler[0].fark).toBeNull();
  });
  it("bozuk kaynak veya hedefi sessizce atlamaz", () => {
    expect(() => paketFiyatEtkisi({ ...abonelik, paketKosullari: {} }, hedef)).toThrow();
    expect(() => paketFiyatEtkisi(abonelik, { ...hedef, fiyatlandirma: null })).toThrow();
  });
});

const yonetici = { kullaniciId: id, eposta: "test@example.invalid", rol: "yonetici" as const };
describe("fiyat etki raporu", () => {
  function hazirla(durum = "yayinlandi", fiyatlandirma: unknown = fiyat) {
    const tx = {
      platformPaketSurumu: { findUnique: vi.fn().mockResolvedValue({ id, surumNo: 2, ad: "Profesyonel", durum, fiyatlandirma, paket: { kod: "profesyonel", eskiPlanKodu: "profesyonel" } }) },
      $queryRaw: vi.fn().mockResolvedValue([{ sonuc: { toplam: 1, bagli: 1, bilinmeyenPlan: 0, sayfa: 1, sayfaBoyutu: 25,
        kayitlar: [{ tenant_id: id, unvan: "Firma", plan_kodu: "v1", paket_surum_id: id, paket_kosullari: kosullar, durum: "aktif" }] } }]),
    };
    const db = { $transaction: vi.fn(async (is: (t: typeof tx) => unknown) => is(tx)) };
    return { tx, db, servis: new PlatformPaketService({ db } as never) };
  }
  it("hedef ve kayıtlı koşulları aynı tutarlı transaction içinde okur", async () => {
    const { servis, db } = hazirla();
    const r = await platformBaglamiylaCalistir(yonetici, () => servis.fiyatEtkisi(id, 1));
    expect(r.kayitlar[0].donemler[0].fark?.toplam).toBe("121.20");
    expect(r.atamaYapildi).toBe(false);
    expect(r.uygulamaTarihi).toBeNull();
    expect(r.gecerlilikTarihi).toBe("2026-12-01");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it.each(["taslak", "arsiv"])("%s sürümünden rapor üretilmez", async (durum) => {
    const { servis, tx } = hazirla(durum);
    await expect(platformBaglamiylaCalistir(yonetici, () => servis.fiyatEtkisi(id, 1))).rejects.toThrow("yayınlanmış");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("fiyatsız veya bulunamayan sürümü reddeder", async () => {
    const { servis, tx } = hazirla("yayinlandi", null);
    await expect(platformBaglamiylaCalistir(yonetici, () => servis.fiyatEtkisi(id, 1))).rejects.toThrow("dönem fiyatları");
    tx.platformPaketSurumu.findUnique.mockResolvedValueOnce(null);
    await expect(platformBaglamiylaCalistir(yonetici, () => servis.fiyatEtkisi(id, 1))).rejects.toThrow("bulunamadı");
  });
  it("editör veritabanına ulaşamaz", async () => {
    const { servis, db } = hazirla();
    await expect(platformBaglamiylaCalistir({ ...yonetici, rol: "mevzuat_editoru" }, () => servis.fiyatEtkisi(id, 1))).rejects.toThrow("yöneticisi");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("sorgu sürüm, sayfa ve ek alanları doğrular", () => {
    const fiyatEtkisi = vi.fn(), c = new PlatformPaketController({ fiyatEtkisi } as never);
    for (const q of [{}, { surumId: "yanlis" }, { surumId: id, sayfa: "0" }, { surumId: id, uygula: true }]) {
      expect(() => c.fiyatEtkisi(q)).toThrow();
    }
    expect(fiyatEtkisi).not.toHaveBeenCalled();
    c.fiyatEtkisi({ surumId: id });
    expect(fiyatEtkisi).toHaveBeenCalledWith(id, 1);
  });
});
