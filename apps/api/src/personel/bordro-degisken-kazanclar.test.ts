import { describe, expect, it } from "vitest";
import { bordroHesapla } from "./bordro-hesaplama";

const parametreler={asgariUcretBrut:30000,sgkTavan:225000,sgkIsciOrani:14,issizlikIsciOrani:1,sgkIsverenOrani:20.75,issizlikIsverenOrani:2,damgaVergisiOrani:.759,gelirVergisiDilimleri:[{ustSinir:100000,oran:15},{ustSinir:null,oran:20}]};

describe("değişken brüt kazançlar",()=>{
  it("fazla mesai ve primi toplam brüt üzerinden SGK ve vergiye dahil eder",()=>{
    const sonuc=bordroHesapla(parametreler,{brutUcret:57500,primGunu:30,oncekiKumulatifMatrah:0,oncekiAsgariKumulatifMatrah:0});
    expect(sonuc.brutUcret).toBe("57500.00");
    expect(sonuc.primeEsasKazanc).toBe("57500.00");
    expect(sonuc.sgkIsci).toBe("8050.00");
    expect(sonuc.gelirVergisiMatrahi).toBe("48875.00");
    expect(sonuc.isverenMaliyeti).toBe("70581.25");
  });
  it("önceki aydan devreden SGK matrahını cari ay tavan kapasitesinde kullanır",()=>{
    const sonuc=bordroHesapla(parametreler,{brutUcret:100000,ucretDisiOdeme:25000,sgkMatrahDevirleri:[{tutar:150000,kalanAy:2}],primGunu:30,oncekiKumulatifMatrah:0,oncekiAsgariKumulatifMatrah:0});
    expect(sonuc.brutUcret).toBe("125000.00");
    expect(sonuc.primeEsasKazanc).toBe("225000.00");
    expect(sonuc.sgkDevredenUygulanan).toBe("125000.00");
    expect(sonuc.sgkCariAyUcretDisiUygulanan).toBe("0.00");
    expect(sonuc.sgkMatrahDevirleri).toEqual([{tutar:"25000.00",kalanAy:1},{tutar:"25000.00",kalanAy:2}]);
  });
});
