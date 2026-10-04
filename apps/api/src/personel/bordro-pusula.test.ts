import { describe, expect, it } from "vitest";
import { bordroPusulaHtml, vergiDairesiAdi, type PusulaVerisi } from "./bordro-pusula";

const firma = { unvan: "Deneme A.Ş.", vkn: "1234567801" };
const temel: PusulaVerisi = {
  donemYil: 2026, donemAy: 10, durum: "onaylandi", primGunu: 18, eksikGunNedeni: "ucretsiz_izin", netMaas: "24000.00", odenecekTutar: "19000.00", odenenTutar: "0.00",
  hesapOzeti: null,
  kalemler: [{ tip: "kazanc", aciklama: "Temel ücret", tutar: "24000.00" }, { tip: "kesinti", aciklama: "Avans mahsubu", tutar: "5000.00" }],
  personel: { personelNo: "PRS-000005", ad: "Ali", soyad: "<Veli>", tcknMaskeli: "*******0146", girisTarihi: new Date("2019-03-15T00:00:00Z"), unvan: null, departman: null },
};

describe("ücret hesap pusulası (PRS-10)", () => {
  it("dönem, gün, eksik gün nedeni, kalemler, net ve ödenecek; ad kaçışlanır; işveren maliyeti yok", () => {
    const html = bordroPusulaHtml(temel, firma);
    expect(html).toContain("Ücret Hesap Pusulası");
    expect(html).toContain("Ekim 2026");
    expect(html).toContain("Prim günü <b>18</b>");
    expect(html).toContain("Ücretsiz izin");
    expect(html).toContain("Avans mahsubu");
    expect(html).toContain("&lt;Veli&gt;");
    expect(html).toContain("*******0146");
    expect(html).not.toMatch(/işveren maliyet/i);
    expect(html).not.toContain("TASLAK");
    expect(html).toContain("SGK ve vergi kesintisi bu bordroda hesaplanmamıştır");
  });
  it("onaysız bordroda TASLAK; mevzuatlıda matrahlar", () => {
    const html = bordroPusulaHtml({ ...temel, durum: "hesaplandi", hesapOzeti: { primeEsasKazanc: "30000.00", gelirVergisiMatrahi: "25500.00", yeniKumulatifMatrah: "255000.00", asgariUcretGelirVergisiIstisnasi: "3825.00", asgariUcretDamgaVergisiIstisnasi: "227.70", isverenMaliyeti: "35325.00" } }, firma);
    expect(html).toContain("TASLAK");
    expect(html).toContain("SGK prime esas kazanç");
    expect(html).toContain("Kümülatif gelir vergisi matrahı");
    expect(html).not.toContain("35.325");
  });
});

describe("vergi dairesi eki", () => {
  it("ek yoksa V.D. eklenir, varsa tekrarlanmaz", () => {
    expect(vergiDairesiAdi("Davutpaşa")).toBe("Davutpaşa V.D.");
    expect(vergiDairesiAdi("DAVUTPAŞA VD")).toBe("DAVUTPAŞA VD");
    expect(vergiDairesiAdi("Kadıköy V.D.")).toBe("Kadıköy V.D.");
  });
});
