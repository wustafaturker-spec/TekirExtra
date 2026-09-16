import { describe, expect, it } from "vitest";
import { ebelgeAdimlari, type AkisGirdisi } from "./ebelge-adimlari";

const ozet = (g: AkisGirdisi) => ebelgeAdimlari(g).map((a) => `${a.baslik}:${a.durum}`);

describe("ebelgeAdimlari (EBLG-45)", () => {
  it("temel e-Faturada alıcı yanıtı adımı göstermez", () => {
    const adimlar = ebelgeAdimlari({ tur: "efatura", profil: "temel", durum: "kabul" });

    expect(adimlar).toHaveLength(3);
    expect(adimlar.map((a) => a.anahtar)).toEqual(["gonderildi", "gib", "ulasti"]);
  });

  it("ticari e-Faturada dördüncü adım yanıt bekler", () => {
    expect(ozet({ tur: "efatura", profil: "ticari", durum: "kabul" })).toEqual([
      "Belge gönderildi:tamam",
      "Maliyeye iletildi:tamam",
      "Alıcıya ulaştı:tamam",
      "Alıcı kabul etti:suanki",
    ]);
  });

  it("alıcı yanıtı geldiğinde son adımı sonuca göre kapatır", () => {
    expect(ozet({ tur: "efatura", profil: "ticari", durum: "kabul", aliciYaniti: "kabul" }).at(-1)).toBe("Alıcı kabul etti:tamam");
    expect(ozet({ tur: "efatura", profil: "ticari", durum: "kabul", aliciYaniti: "ret" }).at(-1)).toBe("Alıcı reddetti:hata");
  });

  it("yolun ortasındayken bir sonraki adımı 'şu anki' gösterir", () => {
    expect(ozet({ tur: "efatura", profil: "temel", durum: "iletildi" })).toEqual([
      "Belge gönderildi:tamam",
      "Maliyeye iletildi:tamam",
      "Alıcıya ulaştı:suanki",
    ]);
  });

  it("gönderim hatasında ilk adımı hatalı, kalanını bekliyor gösterir", () => {
    // Gönderim başarısızsa belge daha yola çıkamamıştır; hata ilk adımdadır.
    expect(ozet({ tur: "efatura", profil: "temel", durum: "hata" })).toEqual([
      "Belge gönderildi:hata",
      "Maliyeye iletildi:bekliyor",
      "Alıcıya ulaştı:bekliyor",
    ]);
  });

  it("e-Arşivde üçüncü adımı alıcıya değil GİB'e bağlar", () => {
    const adimlar = ebelgeAdimlari({ tur: "earsiv", durum: "kabul" });

    expect(adimlar.map((a) => a.baslik)).toEqual(["Belge gönderildi", "Maliyeye iletildi", "GİB'e işlendi"]);
  });

  it("e-İrsaliyede alıcı kararını ayrı adımda gösterir", () => {
    expect(ozet({ tur: "eirsaliye", durum: "kabul" }).at(-1)).toBe("Alıcı kabul etti:tamam");
    expect(ozet({ tur: "eirsaliye", durum: "kismi_kabul" }).at(-1)).toBe("Alıcı kısmen kabul etti:tamam");
    expect(ozet({ tur: "eirsaliye", durum: "ret" }).at(-1)).toBe("Alıcı reddetti:hata");
  });

  it("kısmi kabulde neyin eksik olduğunu not düşer", () => {
    expect(ebelgeAdimlari({ tur: "eirsaliye", durum: "kismi_kabul" }).at(-1)?.not).toBe("Bir kısmı reddedildi");
  });

  it("iptal edilen belgede tamamlanmamış adımları iptal olarak kapatır", () => {
    const adimlar = ebelgeAdimlari({ tur: "efatura", profil: "temel", durum: "iptal" });

    expect(adimlar.every((a) => a.durum === "iptal" || a.durum === "tamam")).toBe(true);
    expect(adimlar.some((a) => a.not === "Belge iptal edildi")).toBe(true);
  });

  it("gelen belgede akışı iki adıma indirir", () => {
    expect(ozet({ tur: "gelen_eirsaliye", durum: "yeni" })).toEqual(["Belge bize ulaştı:tamam", "Yanıt bekliyor:suanki"]);
    expect(ozet({ tur: "gelen_eirsaliye", durum: "ret" })).toEqual(["Belge bize ulaştı:tamam", "Reddedildi:hata"]);
    expect(ozet({ tur: "gelen_efatura", durum: "islendi" })).toEqual(["Belge bize ulaştı:tamam", "İşlendi:tamam"]);
  });

  it("henüz gönderilmemiş belgede ilk adım sırada bekler", () => {
    expect(ozet({ tur: "eirsaliye", durum: null })[0]).toBe("Belge gönderildi:suanki");
  });
});
