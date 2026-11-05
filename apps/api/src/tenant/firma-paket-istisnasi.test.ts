import { describe, expect, it } from "vitest";
import { firmaIstisnasiniCoz, firmaPaketIstisnaSemasi } from "./firma-paket-istisnasi";
import type { AbonelikKosullari } from "./abonelik-kosullari";

const bag = { tenantId: "00000000-0000-4000-8000-000000000001", paketSurumId: "00000000-0000-4000-8000-000000000002" };
const kaynak: AbonelikKosullari = { semaSurumu: 1, kaynak: "eski_plan_gecisi", planKodu: "baslangic", planAdi: "Başlangıç", limitler: { kullanici: 3, cari: 100, stok: 200, aylikFatura: 50 }, fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", donemler: [{ aySayisi: 1, matrah: "399.00" }] } };
const veri = { ...bag, neden: "Firma özel anlaşması", baslangic: "2026-11-01T00:00:00Z", bitis: "2026-12-01T00:00:00Z", fiyatlandirma: { ...kaynak.fiyatlandirma!, donemler: [{ aySayisi: 1, matrah: "299.00" }] } };
describe("süreli firma koşulu", () => {
  it("süre sınırında özel fiyat ve kota birlikte standart koşullara döner", () => {
    const kapsamSozlesmesi = { semaSurumu: 1, moduller: ["cari"], kotalar: {
      kullanici: { sinir: 10, uyariYuzdesi: 80 }, cari: { sinir: null, uyariYuzdesi: 80 }, stok: { sinir: 0, uyariYuzdesi: 80 }, aylikFatura: { sinir: 50, uyariYuzdesi: 80 },
    } };
    const ozel = { ...veri, kapsamSozlesmesi };
    expect(firmaIstisnasiniCoz(kaynak, bag, ozel, new Date(Date.parse(veri.baslangic) - 1))).toMatchObject({ etkin: false, kosullar: kaynak });
    const etkin = firmaIstisnasiniCoz(kaynak, bag, ozel, new Date(Date.parse(veri.bitis) - 1));
    expect(etkin).toMatchObject({ etkin: true, kosullar: { semaSurumu: 2, limitler: { kullanici: 10, cari: null, stok: 0 }, fiyatlandirma: { donemler: [{ matrah: "299.00" }] } } });
    expect(firmaIstisnasiniCoz(kaynak, bag, ozel, new Date(veri.bitis))).toMatchObject({ etkin: false, kosullar: kaynak });
    expect(kaynak.limitler.cari).toBe(100);
  });
  it("mevcut yenileme dönemini kaldıran özel fiyatı etkinleştirmez", () => {
    const temel = { ...kaynak, fiyatlandirma: { ...kaynak.fiyatlandirma!, donemler: [...kaynak.fiyatlandirma!.donemler, { aySayisi: 12 as const, matrah: "3990.00" }] } };
    expect(() => firmaIstisnasiniCoz(temel, bag, veri, new Date(veri.baslangic))).toThrow("ödeme dönemlerini kaldıramaz");
  });
  it("başlangıçta etkinleşir, bitişte kaynak fiyata döner ve kaynağı değiştirmez", () => {
    expect(firmaIstisnasiniCoz(kaynak, bag, veri, new Date(veri.baslangic)).kosullar.fiyatlandirma?.donemler[0].matrah).toBe("299.00");
    expect(firmaIstisnasiniCoz(kaynak, bag, veri, new Date(veri.bitis))).toMatchObject({ etkin: false, kosullar: kaynak });
    expect(kaynak.fiyatlandirma?.donemler[0].matrah).toBe("399.00");
  });
  it("başka firmanın veya sürümün istisnasını uygulamaz", () => {
    expect(() => firmaIstisnasiniCoz(kaynak, { ...bag, tenantId: bag.paketSurumId }, veri)).toThrow("eşleşmiyor");
  });
  it("ters tarih, boş değişiklik ve bozuk fiyatı reddeder", () => {
    expect(firmaPaketIstisnaSemasi.safeParse({ ...veri, bitis: veri.baslangic }).success).toBe(false);
    expect(firmaPaketIstisnaSemasi.safeParse({ ...veri, fiyatlandirma: undefined }).success).toBe(false);
    expect(firmaPaketIstisnaSemasi.safeParse({ ...veri, fiyatlandirma: { ...veri.fiyatlandirma, kdvOrani: "101" } }).success).toBe(false);
  });
});
