import { describe, expect, it } from "vitest";
import { bordroHesapla } from "./bordro-hesaplama";

const parametreler={asgariUcretBrut:33030,sgkTavan:297270,sgkIsciOrani:14,issizlikIsciOrani:1,sgkIsverenOrani:20.75,issizlikIsverenOrani:2,yemekGelirVergisiGunlukIstisna:300,yemekSgkGunlukIstisna:158,damgaVergisiOrani:.759,gelirVergisiDilimleri:[{ustSinir:null,oran:15}]};

describe("nakit yemek yardımı istisnası",()=>{
  it("SGK ve gelir vergisi istisnalarını fiilî gün üzerinden ayrı hesaplar",()=>{
    const sonuc=bordroHesapla(parametreler,{brutUcret:50000,nakitYemekYardimi:8000,fiiliCalismaGunu:20,primGunu:30,oncekiKumulatifMatrah:0,oncekiAsgariKumulatifMatrah:0});
    expect(sonuc.brutUcret).toBe("58000.00");
    expect(sonuc.yemekSgkIstisnasi).toBe("3160.00");
    expect(sonuc.yemekGelirVergisiIstisnasi).toBe("6000.00");
    expect(sonuc.primeEsasKazanc).toBe("54840.00");
    expect(sonuc.gelirVergisiMatrahiIndirimOncesi).toBe("43774.00");
  });

  it("istisnaları ödenen yemek tutarıyla sınırlar",()=>{
    const sonuc=bordroHesapla(parametreler,{brutUcret:50000,nakitYemekYardimi:2000,fiiliCalismaGunu:20,primGunu:30,oncekiKumulatifMatrah:0,oncekiAsgariKumulatifMatrah:0});
    expect(sonuc.yemekSgkIstisnasi).toBe("2000.00");
    expect(sonuc.yemekGelirVergisiIstisnasi).toBe("2000.00");
  });
});
