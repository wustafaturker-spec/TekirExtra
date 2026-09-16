import { describe, expect, it } from "vitest";
import { farkAciklamasi, ucluEslestir } from "./uclu-eslestirme";

const siparisIrsaliye = (miktar: number, siparisFiyati: number, stokId = "stk1", stokKod = "HM-001") => ({
  tur: "irsaliye" as const,
  satirlar: [{ stokId, stokKod, miktar, birimFiyat: siparisFiyati, siparisBirimFiyati: siparisFiyati }],
});

const faturaSatiri = (miktar: number, birimFiyat: number, stokId = "stk1", stokKod = "HM-001") => ({
  stokId, stokKod, miktar, birimFiyat,
});

describe("ucluEslestir (SAT-11)", () => {
  it("miktar ve fiyat örtüşürken fark üretmez", () => {
    const farklar = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 43)],
      belgeler: [siparisIrsaliye(100, 43)],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });

    expect(farklar).toEqual([]);
  });

  it("tolerans içindeki sapmayı fark saymaz, üstündekini sayar", () => {
    const toleransIcinde = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 43.3)],
      belgeler: [siparisIrsaliye(100, 43)],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });
    expect(toleransIcinde).toEqual([]);

    const toleransDisi = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 45)],
      belgeler: [siparisIrsaliye(100, 43)],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });
    expect(toleransDisi).toEqual([
      { stokKod: "HM-001", tur: "fiyat", faturaDeger: 45, kaynakDeger: 43, sapmaYuzde: 4.65 },
    ]);
  });

  it("mal kabulden fazla faturalanan miktarı bildirir", () => {
    const farklar = ucluEslestir({
      faturaSatirlari: [faturaSatiri(120, 43)],
      belgeler: [siparisIrsaliye(100, 43)],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });

    expect(farklar).toEqual([
      { stokKod: "HM-001", tur: "miktar", faturaDeger: 120, kaynakDeger: 100, sapmaYuzde: 20 },
    ]);
  });

  it("sipariş edilmemiş kalemi kaynaksız olarak işaretler", () => {
    const farklar = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 43), faturaSatiri(5, 12, "stk9", "EK-001")],
      belgeler: [siparisIrsaliye(100, 43)],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });

    expect(farklar).toEqual([
      { stokKod: "EK-001", tur: "kaynaksiz", faturaDeger: 5, kaynakDeger: 0, sapmaYuzde: null },
    ]);
  });

  it("teslim alınıp faturalanmamış kalemi de fark sayar", () => {
    const farklar = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 43)],
      belgeler: [
        siparisIrsaliye(100, 43),
        { tur: "irsaliye" as const, satirlar: [{ stokId: "stk2", stokKod: "AMB-001", miktar: 50, birimFiyat: 23, siparisBirimFiyati: 23 }] },
      ],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });

    expect(farklar).toEqual([
      { stokKod: "AMB-001", tur: "miktar", faturaDeger: 0, kaynakDeger: 50, sapmaYuzde: 100 },
    ]);
  });

  it("aynı stoğun parça parça teslimlerini toplayıp karşılaştırır", () => {
    const farklar = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 43)],
      belgeler: [siparisIrsaliye(60, 43), siparisIrsaliye(40, 43)],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });

    expect(farklar).toEqual([]);
  });

  it("fiyatı siparişten alır, irsaliyenin kendi fiyatından değil", () => {
    const farklar = ucluEslestir({
      faturaSatirlari: [faturaSatiri(100, 50)],
      // İrsaliyede 50 yazıyor ama sipariş 43'tü: fark siparişe göre bulunur.
      belgeler: [{ tur: "irsaliye", satirlar: [{ stokId: "stk1", stokKod: "HM-001", miktar: 100, birimFiyat: 50, siparisBirimFiyati: 43 }] }],
      miktarToleransYuzde: 1,
      fiyatToleransYuzde: 1,
    });

    expect(farklar).toEqual([
      { stokKod: "HM-001", tur: "fiyat", faturaDeger: 50, kaynakDeger: 43, sapmaYuzde: 16.28 },
    ]);
  });

  it("kaynak belgesi olmayan faturayı eşleştirmeye almaz", () => {
    expect(ucluEslestir({ faturaSatirlari: [faturaSatiri(100, 43)], belgeler: [], miktarToleransYuzde: 1, fiyatToleransYuzde: 1 })).toEqual([]);
  });

  it("farkları okunur tek satırda özetler", () => {
    const aciklama = farkAciklamasi([
      { stokKod: "HM-001", tur: "miktar", faturaDeger: 120, kaynakDeger: 100, sapmaYuzde: 20 },
      { stokKod: "EK-001", tur: "kaynaksiz", faturaDeger: 5, kaynakDeger: 0, sapmaYuzde: null },
    ]);

    expect(aciklama).toBe("HM-001: miktar faturada 120, mal kabulde 100 (%20); EK-001: faturada 5 miktar var, siparişte/mal kabulde yok");
  });

  it("fiyat farkını siparişe göre, doğru çekim ekiyle yazar", () => {
    const aciklama = farkAciklamasi([{ stokKod: "HM-001", tur: "fiyat", faturaDeger: 50, kaynakDeger: 43, sapmaYuzde: 16.28 }]);

    expect(aciklama).toBe("HM-001: birim fiyat faturada 50, siparişte 43 (%16.28)");
  });
});
