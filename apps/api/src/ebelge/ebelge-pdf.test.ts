import { describe, expect, it } from "vitest";
import { ebelgeYedekPdfHtml } from "./ebelge-pdf";
import { faturaUblOku } from "./ubl-oku";
import { faturaUblUret } from "./xml-uretec";

/** Etiket hücresi ile tutar hücresini birlikte arar (değerin doğru satırda olduğunu doğrular). */
const satirVar = (html: string, etiket: string, tutar: string) =>
  new RegExp(`${etiket.replace(/[()%.]/g, (c) => `\\${c}`)}</td>\\s*<td class="sag"[^>]*>${tutar}`).test(html);

describe("yedek e-Belge görünümü — KDV dışı vergiler (EBLG-129)", () => {
  const satir = (ekVergiler: unknown[], ek: Record<string, unknown> = {}) => ({
    miktar: 1, birim: "adet", birimFiyat: 1000, iskontoTutari: 0, matrah: 1000, kdvOrani: 20, kdvTutari: 250, gibIstisnaKodu: null,
    stok: { kod: "STK-1", ad: "Buzdolabı" }, ekVergiler, ...ek,
  });
  const fatura = (satirlar: unknown[], ek: Record<string, unknown> = {}) => ({
    id: "77777777-7777-4777-8777-777777777777", no: "TKR2026000000020", tarih: new Date("2026-10-10T12:00:00Z"),
    tip: "satis", senaryo: "satis", dovizCinsi: "TRY",
    toplamKdv: 250, toplamMatrah: 1000, toplamBrut: 1000, genelToplam: 1500, toplamStopaj: 0, toplamSatirIskontosu: 0,
    cari: { vknTckn: "1234567890", unvan: "Alıcı A.Ş." }, satirlar, ...ek,
  }) as never;
  const satici = { unvan: "Satıcı A.Ş.", vkn: "9876543210" };
  const otv = { kod: "0074", ad: "ÖTV IV. Liste", hesap: "oran", oran: "25", birimTutar: null, matrah: "1000.00", tutar: "250.00", stopaj: false, kdvMatrahinaDahil: true };

  it("ÖTV: KDV matrahı ÖTV dahil, Hesaplanan KDV yalnız KDV, ÖTV ayrı satır ve kalemde", () => {
    const html = ebelgeYedekPdfHtml(faturaUblOku(faturaUblUret(fatura([satir([otv])]), satici)));
    expect(satirVar(html, "KDV Matrahı", "1.250,00")).toBe(true);
    expect(satirVar(html, "Hesaplanan KDV", "250,00")).toBe(true);
    expect(satirVar(html, "ÖTV IV. Liste (%25)", "250,00")).toBe(true);
    expect(satirVar(html, "Ödenecek Tutar", "1.500,00")).toBe(true);
    expect(html).toContain("<small>ÖTV IV. Liste %25: 250,00</small>");
  });

  it("stopaj ödenecekten düştüğü için eksi basılır", () => {
    const stopaj = { kod: "0003", ad: "Gelir Vergisi Stopajı", hesap: "oran", oran: "10", birimTutar: null, matrah: "500.00", tutar: "50.00", stopaj: true, kdvMatrahinaDahil: false };
    const html = ebelgeYedekPdfHtml(faturaUblOku(faturaUblUret(fatura([satir([stopaj], { matrah: 500, birimFiyat: 500, kdvTutari: 100 })], { toplamKdv: 100, toplamMatrah: 500, toplamBrut: 500, genelToplam: 550, toplamStopaj: 50 }), satici)));
    expect(satirVar(html, "Hesaplanan KDV", "100,00")).toBe(true);
    expect(satirVar(html, "Gelir Vergisi Stopajı (%10)", "-50,00")).toBe(true);
    expect(satirVar(html, "Ödenecek Tutar", "550,00")).toBe(true);
  });

  it("KDV dışı vergi yoksa toplamlar eskisi gibi: matrah vergiler hariç tutar, KDV başlık vergi toplamı", () => {
    const html = ebelgeYedekPdfHtml(faturaUblOku(faturaUblUret(fatura([satir([], { kdvTutari: 200 })], { toplamKdv: 200, genelToplam: 1200 }), satici)));
    expect(satirVar(html, "KDV Matrahı", "1.000,00")).toBe(true);
    expect(satirVar(html, "Hesaplanan KDV", "200,00")).toBe(true);
    expect(html).not.toContain("<small>");
  });
});
