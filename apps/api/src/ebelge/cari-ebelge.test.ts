import { describe, expect, it, vi } from "vitest";
import { cariEbelgeDurumlariniOku, cariEbelgeDurumuBul } from "./cari-ebelge";

const tx = (kayitlar: unknown[], senkron: { sonSenkronAt: Date; kayitSayisi: number } | null) => ({
  gibMukellef: { findMany: vi.fn().mockResolvedValue(kayitlar) },
  gibMukellefSenkron: { findUnique: vi.fn().mockResolvedValue(senkron) },
}) as any;

describe("cariEbelgeDurumlariniOku (CARI-23)", () => {
  const taze = { sonSenkronAt: new Date(), kayitSayisi: 100 };

  it("carileri tek sorguda çözer, birden çok etikette en eski kayıt tarihini alır", async () => {
    const okuma = await cariEbelgeDurumlariniOku(tx([
      { vknTckn: "1234567802", belgeTuru: "efatura", tur: "OZEL", ilkKayitZamani: new Date("2019-05-01T09:00:00Z") },
      { vknTckn: "1234567802", belgeTuru: "efatura", tur: "OZEL", ilkKayitZamani: new Date("2014-07-18T13:07:05Z") },
      { vknTckn: "1234567802", belgeTuru: "eirsaliye", tur: null, ilkKayitZamani: null },
    ], taze), ["1234567802", "9876543210", null]);

    expect(cariEbelgeDurumuBul(okuma, "1234567802")).toMatchObject({ tur: "efatura", efaturaKayitTarihi: "2014-07-18", eirsaliye: true });
    expect(cariEbelgeDurumuBul(okuma, "9876543210").tur).toBe("earsiv");
    expect(cariEbelgeDurumuBul(okuma, null).tur).toBe("earsiv");
    expect(okuma.listeGuncellendi).toBe(taze.sonSenkronAt);
  });

  it("liste 48 saatten eskiyse bilinmiyor der", async () => {
    const eski = { sonSenkronAt: new Date(Date.now() - 49 * 3_600_000), kayitSayisi: 100 };
    const okuma = await cariEbelgeDurumlariniOku(tx([], eski), ["9876543210"]);

    expect(cariEbelgeDurumuBul(okuma, "9876543210").tur).toBe("bilinmiyor");
  });
});
