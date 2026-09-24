import { describe, expect, it } from "vitest";
import { gonderimEngelleri, teslimatAdresiSec, type EirsaliyeAdayi } from "./eirsaliye-engeller";

const tamAdres = { tip: "sevk", il: "İstanbul", ilce: "Kadıköy", postaKodu: "34710" };

const belge = (degisiklik: Partial<EirsaliyeAdayi> = {}, cari: Partial<EirsaliyeAdayi["cari"]> = {}): EirsaliyeAdayi => ({
  tur: "irsaliye",
  yon: "satis",
  durum: "onaylandi",
  cari: { vknTckn: "1234567801", adresler: [tamAdres], ...cari },
  tasiyiciCariId: null,
  tasiyiciCari: null,
  soforAdi: "Ali",
  soforSoyadi: "Veli",
  plaka: "34ABC01",
  ...degisiklik,
});

const kodlar = (b: EirsaliyeAdayi) => gonderimEngelleri(b).map((e) => e.kod);

describe("gonderimEngelleri (EBLG-42)", () => {
  it("eksiksiz belgede engel bulmaz", () => {
    expect(kodlar(belge())).toEqual([]);
  });

  it("satış irsaliyesi olmayan belgeyi tek engelle eler", () => {
    expect(kodlar(belge({ tur: "siparis" }))).toEqual(["belge_turu"]);
    expect(kodlar(belge({ yon: "alis" }))).toEqual(["belge_turu"]);
  });

  it("onaysız belgeyi engeller", () => {
    expect(kodlar(belge({ durum: "taslak" }))).toContain("onaysiz");
  });

  it("VKN yoksa engeller", () => {
    expect(kodlar(belge({}, { vknTckn: null }))).toEqual(["vkn_yok"]);
  });

  // EBLG-83: kayıtlı olmayan alıcıya da e-İrsaliye gider (NES testinde 2026-09-24).
  it("alıcının e-İrsaliye kaydını engel saymaz", () => {
    expect(kodlar(belge())).toEqual([]);
  });

  it("posta kodu eksik adresi kabul etmez", () => {
    expect(kodlar(belge({}, { adresler: [{ ...tamAdres, postaKodu: null }] }))).toEqual(["adres_yok"]);
  });

  it("sevk adresi yoksa merkez adresine düşer", () => {
    expect(kodlar(belge({}, { adresler: [{ ...tamAdres, tip: "merkez" }] }))).toEqual([]);
    expect(teslimatAdresiSec([{ ...tamAdres, tip: "fatura" }])?.tip).toBe("fatura");
  });

  it("taşıyan bilgisi eksikse engeller", () => {
    expect(kodlar(belge({ soforAdi: null, soforSoyadi: null, plaka: null }))).toEqual(["tasiyan_yok"]);
  });

  it("taşıyıcı cari seçiliyse şoför aranmaz ama VKN aranır", () => {
    expect(kodlar(belge({ soforAdi: null, soforSoyadi: null, plaka: null, tasiyiciCariId: "t1", tasiyiciCari: { vknTckn: "9999999999" } }))).toEqual([]);
    expect(kodlar(belge({ tasiyiciCariId: "t1", tasiyiciCari: { vknTckn: null } }))).toEqual(["tasiyici_vkn_yok"]);
  });

  it("birden çok eksiği birlikte bildirir", () => {
    expect(kodlar(belge({ soforAdi: null, soforSoyadi: null, plaka: null }, { adresler: [] }))).toEqual(["adres_yok", "tasiyan_yok"]);
  });
});

describe("plaka engelleri (şematron 14.09.2026 §3)", () => {
  const temel = {
    tur: "irsaliye", yon: "satis", durum: "onaylandi",
    cari: { vknTckn: "1234567890", adresler: [{ tip: "sevk", il: "Denizli", ilce: "Honaz", postaKodu: "20330" }] },
    tasiyiciCariId: null, tasiyiciCari: null,
    soforAdi: "Mehmet", soforSoyadi: "Öztürk", plaka: "34ABC123", dorsePlaka: null,
  };

  it("geçerli plakada engel üretmez", () => {
    expect(gonderimEngelleri(temel, "mukellef")).toEqual([]);
    expect(gonderimEngelleri({ ...temel, plaka: "AFK-159" }, "mukellef")).toEqual([]);
  });

  it("şoför bildirilip plaka verilmediyse engeller", () => {
    const engeller = gonderimEngelleri({ ...temel, plaka: null }, "mukellef");
    expect(engeller.map((e) => e.kod)).toContain("tasiyan_yok");
    expect(engeller.some((e) => e.mesaj.includes("araç plakası zorunludur"))).toBe(true);
  });

  it("taşıyıcı firma seçili olsa da şoför varsa plaka ister", () => {
    const engeller = gonderimEngelleri(
      { ...temel, tasiyiciCariId: "c1", tasiyiciCari: { vknTckn: "1234567890" }, plaka: null },
      "mukellef",
    );
    expect(engeller.some((e) => e.mesaj.includes("araç plakası zorunludur"))).toBe(true);
  });

  it("biçime uymayan araç ve dorse plakasını engeller", () => {
    const engeller = gonderimEngelleri({ ...temel, plaka: "34.ABC.123", dorsePlaka: "dorse plaka!" }, "mukellef");
    expect(engeller.filter((e) => e.kod === "plaka_bicimi")).toHaveLength(2);
  });
});
