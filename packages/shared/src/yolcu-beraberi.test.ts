import { describe, expect, it } from "vitest";
import { yolcuBeraberiEngelleri, type YolcuBeraberiBilgisi } from "./yolcu-beraberi";

const tam: YolcuBeraberiBilgisi = {
  yolcu: { ad: "John", soyad: "Doe", uyruk: "GB", pasaportNo: "123456789", pasaportTarihi: "2020-05-01", sehir: "London", ulke: "GB" },
  araciKurum: { vkn: "1111111111", etiket: "urn:mail:yolcuberaberpk@arefund.com.tr", unvan: "A Refund A.Ş." },
};
const fatura = { tip: "satis", tarih: "2026-09-20", satirlar: [{ kdvOrani: 20 }] };

describe("yolcuBeraberiEngelleri", () => {
  it("tam bilgide engel yok; pasaport tarihi boş bırakılabilir", () => {
    expect(yolcuBeraberiEngelleri(tam, fatura)).toEqual([]);
    expect(yolcuBeraberiEngelleri({ ...tam, yolcu: { ...tam.yolcu, pasaportTarihi: null } }, fatura)).toEqual([]);
  });

  it("Türkiye'de ikamet eden yolcuyu ve sıfır KDV'li satırı reddeder", () => {
    const alanlar = yolcuBeraberiEngelleri({ ...tam, yolcu: { ...tam.yolcu, ulke: "TR" } }, { ...fatura, satirlar: [{ kdvOrani: 0 }] }).map((e) => e.alan);
    expect(alanlar).toEqual(["satir", "ulke"]);
  });

  it("eksik yolcu ve aracı kurum alanlarını sayar", () => {
    const alanlar = yolcuBeraberiEngelleri({ yolcu: {}, araciKurum: { etiket: "yolcuberaberpk" } }, { ...fatura, tip: "alis_iade" }).map((e) => e.alan);
    expect(alanlar).toEqual(["tip", "ad", "soyad", "uyruk", "pasaportNo", "sehir", "ulke", "araciKurumVkn", "araciKurumEtiket", "araciKurumUnvan"]);
  });

  it("fatura tarihinden sonraki pasaport tarihini reddeder", () => {
    expect(yolcuBeraberiEngelleri({ ...tam, yolcu: { ...tam.yolcu, pasaportTarihi: "2027-01-01" } }, fatura)[0].alan).toBe("pasaportTarihi");
  });
});
