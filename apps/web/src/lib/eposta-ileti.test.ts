import { describe, expect, it } from "vitest";
import { adresleriAyikla, iletiTaslagi, type IletiKaynagi } from "./eposta-ileti";

const kaynak: IletiKaynagi = {
  id: "11111111-1111-4111-8111-111111111111",
  gonderenAdi: "Ayşe Satın",
  gonderenEposta: "Ayse@Musteri.com",
  aliciEposta: "Tekir <satis@tekir.com>, Mehmet <mehmet@musteri.com>",
  konu: "Fiyat talebi",
  icerikMetin: "Merhaba,\n5000 adet için fiyat rica ederiz.",
  tarih: "2026-10-18T17:15:00Z",
};

describe("E-posta ileti taslağı", () => {
  it("adresleri sırasıyla ve tekrarsız ayıklar", () => {
    expect(adresleriAyikla("A <a@x.com>, b@y.com; A@X.com")).toEqual(["a@x.com", "b@y.com"]);
  });
  it("yeni ileti boş başlar", () => {
    expect(iletiTaslagi("yeni", kaynak)).toEqual({ mod: "yeni", kime: "", konu: "", metin: "" });
  });
  it("yanıt göndereni alıcı yapar, alıntılar ve zinciri taşır", () => {
    const t = iletiTaslagi("yanitla", kaynak);
    expect(t.kime).toBe("ayse@musteri.com");
    expect(t.konu).toBe("Ynt: Fiyat talebi");
    expect(t.metin).toContain("> 5000 adet için fiyat rica ederiz.");
    expect(t.yanitlananId).toBe(kaynak.id);
  });
  it("tümünü yanıtla diğer alıcıları da ekler", () => {
    expect(iletiTaslagi("tumunu", kaynak).kime).toBe("ayse@musteri.com, satis@tekir.com, mehmet@musteri.com");
  });
  it("öneki çoğaltmaz", () => {
    expect(iletiTaslagi("yanitla", { ...kaynak, konu: "RE: Fiyat talebi" }).konu).toBe("RE: Fiyat talebi");
    expect(iletiTaslagi("ilet", { ...kaynak, konu: "Fwd: Fiyat" }).konu).toBe("Fwd: Fiyat");
  });
  it("iletmede alıcı boş, zincir yok, başlık bilgisi metinde", () => {
    const t = iletiTaslagi("ilet", kaynak);
    expect(t.kime).toBe("");
    expect(t.yanitlananId).toBeUndefined();
    expect(t.metin).toContain("Kimden: Ayşe Satın <Ayse@Musteri.com>");
  });
});
