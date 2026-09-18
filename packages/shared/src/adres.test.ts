import { describe, expect, it } from "vitest";
import { belgeAdresiSec, ublAdresi } from "./adres";

const adres = (tip: string, ek: Record<string, unknown> = {}) => ({
  tip, adres: "Atatürk Cad. 1", il: "İstanbul", ilce: "Kadıköy", postaKodu: "34710", ulke: "TR", ...ek,
});

describe("belgeAdresiSec", () => {
  it("fatura adresini merkeze, merkezi sevke yeğler", () => {
    expect(belgeAdresiSec([adres("sevk"), adres("fatura"), adres("merkez")])?.tip).toBe("fatura");
    expect(belgeAdresiSec([adres("depo"), adres("merkez")])?.tip).toBe("merkez");
    // Tanımadığı tip en sona düşer ama tek adres kaldıysa yine de kullanılır.
    expect(belgeAdresiSec([adres("bilinmeyen")])?.tip).toBe("bilinmeyen");
    expect(belgeAdresiSec([])).toBeUndefined();
  });
});

describe("ublAdresi", () => {
  it("karttaki adresi belgeye hazırlar", () => {
    const a = ublAdresi([adres("fatura")]);
    expect(a).toMatchObject({ adres: "Atatürk Cad. 1", il: "İstanbul", ilce: "Kadıköy", postaKodu: "34710", ulkeKodu: "TR", ulkeAdi: "Türkiye", eksik: false });
  });

  it("adres yoksa zorunlu alanları boş bırakır, şehir uydurmaz", () => {
    const a = ublAdresi([]);
    expect(a).toMatchObject({ il: "-", ilce: "-", ulkeKodu: "TR", eksik: true });
    expect(a.adres).toBeUndefined();
    expect(a.postaKodu).toBeUndefined();
  });

  it("yurt dışı adreste ülke kodunu ve adını çözer", () => {
    expect(ublAdresi([adres("fatura", { ulke: "DE", il: "Berlin", ilce: "Mitte" })])).toMatchObject({
      ulkeKodu: "DE", ulkeAdi: "Almanya", il: "Berlin",
    });
    // Tanınmayan ülke adı TR'ye düşmez; kod çözülemezse varsayılan TR kalır.
    expect(ublAdresi([adres("fatura", { ulke: "FR" })]).ulkeKodu).toBe("FR");
  });
});
