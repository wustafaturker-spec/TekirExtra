import { describe, expect, it } from "vitest";
import { cariEbelgeDurumu } from "./cari-ebelge";

describe("cariEbelgeDurumu (CARI-23)", () => {
  it("listedeki alıcı e-Fatura mükellefidir, kayıt tarihi Türkiye günüyle yazılır", () => {
    const durum = cariEbelgeDurumu({
      vknTckn: "1234567802",
      efatura: { ilkKayitZamani: "2020-03-11T22:30:00Z", tur: "OZEL" },
      eirsaliye: { ilkKayitZamani: "2021-07-01T09:00:00+03:00" },
      listeGuncel: true,
    });
    expect(durum).toEqual({ tur: "efatura", efaturaKayitTarihi: "2020-03-12", eirsaliye: true, eirsaliyeKayitTarihi: "2021-07-01", kamu: false });
  });

  it("listede olmayan alıcı otomatik e-Arşiv'dir", () => {
    expect(cariEbelgeDurumu({ vknTckn: "9876543210", efatura: null, eirsaliye: null, listeGuncel: true })).toMatchObject({ tur: "earsiv", eirsaliye: false });
  });

  it("VKN/TCKN'si olmayan cari e-Arşiv'dir, liste güncel olmasa bile", () => {
    expect(cariEbelgeDurumu({ vknTckn: null, efatura: null, eirsaliye: null, listeGuncel: false }).tur).toBe("earsiv");
  });

  it("liste güncel değilse e-Arşiv demez, bilinmiyor der", () => {
    expect(cariEbelgeDurumu({ vknTckn: "9876543210", efatura: null, eirsaliye: null, listeGuncel: false })).toMatchObject({ tur: "bilinmiyor", eirsaliye: null });
  });

  it("listede KAMU türündeki alıcıyı işaretler; tarih yoksa boş kalır", () => {
    expect(cariEbelgeDurumu({ vknTckn: "2222222105", efatura: { ilkKayitZamani: null, tur: "KAMU" }, eirsaliye: null, listeGuncel: true }))
      .toMatchObject({ tur: "efatura", kamu: true, efaturaKayitTarihi: null });
  });
});
