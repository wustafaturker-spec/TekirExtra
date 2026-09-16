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

const kodlar = (b: EirsaliyeAdayi, mukellef: "mukellef" | "degil" | "bilinmiyor" = "mukellef") =>
  gonderimEngelleri(b, mukellef).map((e) => e.kod);

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

  it("VKN yoksa mükellefiyeti ayrıca sormaz", () => {
    expect(kodlar(belge({}, { vknTckn: null }), "degil")).toEqual(["vkn_yok"]);
  });

  it("mükellef olmayan cariyi engeller", () => {
    expect(kodlar(belge(), "degil")).toEqual(["mukellef_degil"]);
  });

  it("mükellefiyet doğrulanamadığında engel saymaz", () => {
    expect(kodlar(belge(), "bilinmiyor")).toEqual([]);
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
