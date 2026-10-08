import { describe, expect, it } from "vitest";
import { bordroHesapla } from "./bordro-hesaplama";
import { RESMI_MEVZUAT_SETLERI } from "./resmi-mevzuat";
import { aphbBildirgeleri, aphbDisiNedeni, hizmetSatiri, muhsgkOzeti, type HizmetGirdisi } from "./sgk-dokum";

const p = RESMI_MEVZUAT_SETLERI[1].parametreler;
const hesap = (brut: number, ek: Partial<Parameters<typeof bordroHesapla>[1]> = {}) => bordroHesapla(p, { brutUcret: brut, primGunu: 30, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0, ...ek });
const girdi = (ek: Partial<HizmetGirdisi> = {}): HizmetGirdisi => ({
  personelId: "p1", personelNo: "PRS-000001", ad: "Ayşe", soyad: "Yılmaz", tckn: "10000000146", belgeTuru: "1", kanunNo: "05510", meslekKodu: "2411.01",
  primGunu: 30, istihdamGunu: 30, eksikGunNedeni: null, girisTarihi: null, cikisTarihi: null, cikisKodu: null, hesapOzeti: hesap(50000), ...ek,
});

describe("MUHSGK hizmet satırı (PRS-26)", () => {
  it("hesap izinden PEK, GV ve DV alanları; prim/ikramiye PEK'ten ayrılır", () => {
    const oz = hesap(40000, { ucretDisiOdeme: 10000 });
    const s = hizmetSatiri(girdi({ hesapOzeti: oz }));
    expect(s.hesapIzi).toBe(true);
    expect(s.pek).toBe(oz.primeEsasKazanc);
    expect(Number(s.primIkramiye)).toBe(10000);
    expect(Number(s.hakEdilenUcret) + Number(s.primIkramiye)).toBe(Number(oz.primeEsasKazanc));
    expect(s.kesilenGv).toBe(oz.gelirVergisi);
    expect(s.asgariGvIstisnasi).toBe(oz.asgariUcretGelirVergisiIstisnasi);
    expect(s.kesilenDv).toBe(oz.damgaVergisi);
    expect(s.uyarilar).toEqual([]);
  });
  it("eksik gün = istihdam günü − prim günü; kod puantaj nedeninden", () => {
    const s = hizmetSatiri(girdi({ primGunu: 18, istihdamGunu: 30, eksikGunNedeni: "ucretsiz_izin" }));
    expect([s.eksikGunSayisi, s.eksikGunKodu]).toEqual([12, "02"]);
    // Ay içinde giren personelin istihdam dışı günleri eksik gün değildir.
    expect(hizmetSatiri(girdi({ primGunu: 12, istihdamGunu: 12, girisTarihi: "2026-10-20" })).eksikGunSayisi).toBe(0);
    expect(hizmetSatiri(girdi({ primGunu: 25, istihdamGunu: 30 })).uyarilar).toContain("Eksik gün nedeni girilmemiş");
  });
  it("hesap izi yoksa tutarlar sıfır, uyarı var, toplama ve APHB'ye girmez", () => {
    const izsiz = hizmetSatiri(girdi({ personelId: "p2", personelNo: "PRS-000002", hesapOzeti: null }));
    expect(izsiz.hesapIzi).toBe(false);
    expect(izsiz.pek).toBe("0.00");
    expect(aphbDisiNedeni(izsiz)).toBe("hesap izi yok");
    const izli = hizmetSatiri(girdi());
    const ozet = muhsgkOzeti([izli, izsiz]);
    expect(ozet.kisiSayisi).toBe(1);
    expect(ozet.pek).toBe(izli.pek);
  });
  it("APHB: belge türü + kanun başına grup, eksik kart alanı uyarısı", () => {
    const satirlar = [
      hizmetSatiri(girdi({ personelNo: "PRS-000003", belgeTuru: "2", kanunNo: "00000" })),
      hizmetSatiri(girdi({ personelNo: "PRS-000002", meslekKodu: null })),
      hizmetSatiri(girdi({ personelNo: "PRS-000001", cikisTarihi: "2026-10-15" })),
    ];
    expect(satirlar[1].uyarilar).toContain("Meslek kodu yok");
    expect(aphbDisiNedeni(satirlar[2])).toBe("SGK çıkış kodu yok");
    const gruplar = aphbBildirgeleri(satirlar);
    expect(gruplar.map((g) => [g.belgeTuru, g.kanun, g.sigortalilar.length])).toEqual([["1", "05510", 1], ["2", "00000", 1]]);
    expect(gruplar[0].sigortalilar[0].meslekKodu).toBeNull();
  });
});
