import { describe, expect, it } from "vitest";
import {
  anahtarBicimiGecerli, anahtarOzeti, anahtarUret, bakiyeCumlesi, bakiyeFarklari, gorunenDurum, gunEkle, hatirlatmaZamani, karsiBakiyeleri, portalYanitSemasi,
} from "./cari-mutabakat";

describe("CARI-42 mutabakat kuralları", () => {
  it("anahtar 43 karakter base64url; özet anahtarı vermez ve kararlıdır", () => {
    const { anahtar, ozet } = anahtarUret();
    expect(anahtarBicimiGecerli(anahtar)).toBe(true);
    expect(ozet).toBe(anahtarOzeti(anahtar));
    expect(ozet).not.toContain(anahtar);
    expect(anahtarBicimiGecerli("../../etc")).toBe(false);
    expect(anahtarUret().anahtar).not.toBe(anahtar);
  });

  it("süresi dolma yalnız yanıt bekleyende; son gün boyunca geçerli", () => {
    expect(gorunenDurum({ durum: "goruldu", sonYanitTarihi: "2026-10-04" }, "2026-10-04")).toBe("goruldu");
    expect(gorunenDurum({ durum: "goruldu", sonYanitTarihi: "2026-10-03" }, "2026-10-04")).toBe("suresi_doldu");
    expect(gorunenDurum({ durum: "mutabik", sonYanitTarihi: "2026-10-03" }, "2026-10-04")).toBe("mutabik");
  });

  it("karşı tarafın yönü bizim işaretimize çevrilir, fark karşı − biz", () => {
    const karsi = karsiBakiyeleri([
      { dovizCinsi: "TRY", tutar: "11.000,50".replace(".", ""), yon: "borcluyuz" },
      { dovizCinsi: "USD", tutar: "200", yon: "alacakliyiz" },
    ]);
    expect(karsi).toEqual([{ dovizCinsi: "TRY", bakiye: "11000.50" }, { dovizCinsi: "USD", bakiye: "-200.00" }]);
    expect(bakiyeFarklari([{ dovizCinsi: "TRY", bakiye: "12000.50" }, { dovizCinsi: "EUR", bakiye: "0.00" }], karsi)).toEqual([
      { dovizCinsi: "TRY", bakiye: "-1000.00" },
      { dovizCinsi: "USD", bakiye: "-200.00" },
    ]);
  });

  it("bakiye cümlesi yönü söyler", () => {
    expect(bakiyeCumlesi([{ dovizCinsi: "TRY", bakiye: "12500" }, { dovizCinsi: "USD", bakiye: "-100" }])).toBe("firmamıza 12.500,00 TL borçlusunuz; firmamızdan 100,00 USD alacaklısınız");
    expect(bakiyeCumlesi([{ dovizCinsi: "TRY", bakiye: "0.001" }])).toBe("hesabınız bakiyesizdir (0,00)");
  });

  it("hatırlatma son tarihe 3 gün kala bir kez, yanıtsız ve süresi dolmamışa", () => {
    const k = { durum: "goruldu", sonYanitTarihi: "2026-10-10", hatirlatmaAt: null };
    expect(hatirlatmaZamani(k, "2026-10-06")).toBe(false);
    expect(hatirlatmaZamani(k, "2026-10-07")).toBe(true);
    expect(hatirlatmaZamani(k, "2026-10-10")).toBe(true);
    expect(hatirlatmaZamani(k, "2026-10-11")).toBe(false);
    expect(hatirlatmaZamani({ ...k, hatirlatmaAt: new Date() }, "2026-10-08")).toBe(false);
    expect(hatirlatmaZamani({ ...k, durum: "mutabik" }, "2026-10-08")).toBe(false);
    expect(gunEkle("2026-02-27", 3)).toBe("2026-03-02");
  });

  it("itiraz açıklama ve bakiye ister; mutabık yalnız ad ve görev", () => {
    expect(portalYanitSemasi.safeParse({ yanit: "mutabik", ad: "Ali Veli", gorev: "Muhasebe" }).success).toBe(true);
    expect(portalYanitSemasi.safeParse({ yanit: "itiraz", ad: "Ali Veli", gorev: "Muhasebe", aciklama: "eksik ödeme", karsiBakiyeler: [] }).success).toBe(false);
    expect(portalYanitSemasi.safeParse({ yanit: "itiraz", ad: "Ali Veli", gorev: "Muhasebe", aciklama: "", karsiBakiyeler: [{ dovizCinsi: "TRY", tutar: "5", yon: "borcluyuz" }] }).success).toBe(false);
    expect(portalYanitSemasi.safeParse({ yanit: "itiraz", ad: "Ali Veli", gorev: "Muhasebe", aciklama: "eksik ödeme", karsiBakiyeler: [{ dovizCinsi: "XXX", tutar: "5", yon: "borcluyuz" }] }).success).toBe(false);
  });
});
