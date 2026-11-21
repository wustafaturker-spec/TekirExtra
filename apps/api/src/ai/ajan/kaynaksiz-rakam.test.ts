import { describe, expect, it } from "vitest";
import { DOGRULANAMADI, kaynaksizRakamlar, MASKE_UYARISI, rakamIfadeleri, rakamlariMaskele } from "./kaynaksiz-rakam";

const kaynak = JSON.stringify({ bakiye: "1250.00", ciro: 1234567.89, kdvOrani: 20, iskonto: "0.18", borc: "-8750.40", usd: "3200.5" });

describe("AI-111 kaynaksız rakam", () => {
  it("para ve yüzde ifadelerini yakalar; tarih, belge no, VKN ve miktara dokunmaz", () => {
    const ifadeler = rakamIfadeleri("Bakiye 1.250,00 TL, ₺500, 2,5 milyon TL, %12, yüzde 7,5, 30 %. Tarih 2026-11-21, SNC2026000000511, VKN 1234567890, 15 adet.");
    expect(ifadeler.map((i) => [i.metin, i.tur])).toEqual([
      ["1.250,00 TL", "para"], ["₺500", "para"], ["2,5 milyon TL", "para"], ["%12", "yuzde"], ["yüzde 7,5", "yuzde"], ["30 %", "yuzde"],
    ]);
  });

  it("aracın tutarının biçim farkları yanlış alarm vermez (1.250,00 / 1250 / 1,25 bin, yuvarlama, eksi işaret, oran)", () => {
    for (const cevap of [
      "Bakiye 1.250,00 TL.", "Bakiye 1250 TL.", "Bakiye 1,25 bin TL.", "Bakiye 1.250 TRY.",
      "Ciro 1.234.567,89 TL.", "Ciro yaklaşık 1,23 milyon TL.", "Ciro 1.234.568 TL.",
      "Borç -8.750,40 TL.", "Borç 8.750,40 TL.", "KDV %20.", "İskonto %18.", "Bakiye $3,200.50.",
    ]) expect(kaynaksizRakamlar(cevap, kaynak), cevap).toEqual([]);
  });

  it("kaynakta olmayan tutar, toplam ve oran yakalanır; kullanıcının yazdığı tutar kaynaktır", () => {
    expect(kaynaksizRakamlar("Bakiye 1.350,00 TL.", kaynak).map((i) => i.metin)).toEqual(["1.350,00 TL"]);
    expect(kaynaksizRakamlar("Ciro 1,3 milyon TL, büyüme %15.", kaynak).map((i) => i.metin)).toEqual(["1,3 milyon TL", "%15"]);
    expect(kaynaksizRakamlar("5.000 TL tahsilat kaydı açılabilir.", `${kaynak} Yılmaz'dan 5.000 TL tahsilat`)).toEqual([]);
    expect(kaynaksizRakamlar("Tutar yok.", kaynak)).toEqual([]);
  });

  it("maskeler ve uyarı ekler; diğer metne dokunmaz", () => {
    const cevap = "Bakiye 1.350,00 TL, KDV %20.";
    const m = rakamlariMaskele(cevap, kaynaksizRakamlar(cevap, kaynak));
    expect(m).toBe(`Bakiye ${DOGRULANAMADI}, KDV %20.\n\n${MASKE_UYARISI}`);
  });
});
