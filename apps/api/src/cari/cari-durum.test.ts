import { describe, expect, it } from "vitest";
import { cariDavranisAnalizi } from "./cari-analiz";
import { durumBulgulari, type DurumGirdisi, type FinansGirdisi } from "./cari-durum";

const BUGUN = new Date("2026-10-17T09:00:00Z");
const CARI = { id: "c1", tip: "musteri", karaListe: false, karaListeNotu: null };

function finans(ek: Partial<FinansGirdisi> = {}): FinansGirdisi {
  return {
    acikBakiyeTry: 0, vadesiGecmisTry: 0, enEskiGecikmeGun: null, mevcutRiskTry: 0, kullanilabilirLimitTry: null,
    davranis: cariDavranisAnalizi([], null, BUGUN), egilim: { sonUcAy: null, oncekiAltiAy: null },
    sorunluCekSayisi: 0, yaklasanCek: { sayi: 0, tutarTry: 0, enYakinVade: null }, bitenTeminat: { sayi: 0, enYakinBitis: null },
    acikItirazSayisi: 0, sonEtkilesim: new Date("2026-10-01T00:00:00Z"), borclarimiz: { vadesiGecmisTry: 0, yakinVadeTry: 0 },
    ...ek,
  };
}

const kodlar = (g: Partial<DurumGirdisi>) => durumBulgulari({ bugun: BUGUN, cari: CARI, ...g }).map((b) => `${b.kod}:${b.onem}`);

describe("Cari Durum Paneli bulguları (CARI-44)", () => {
  it("sorun yoksa bulgu yoktur", () => {
    expect(kodlar({ finans: finans(), satis: { bitenTeklifler: [], bekleyenSiparisler: [] } })).toEqual([]);
  });

  it("vadesi geçmiş alacak: en eskisi 30 günü aşınca kritik, değilse uyarı", () => {
    expect(kodlar({ finans: finans({ acikBakiyeTry: 500, vadesiGecmisTry: 500, enEskiGecikmeGun: 31 }) })).toContain("vadesi_gecmis:kritik");
    expect(kodlar({ finans: finans({ acikBakiyeTry: 500, vadesiGecmisTry: 500, enEskiGecikmeGun: 30 }) })).toContain("vadesi_gecmis:uyari");
  });

  it("risk kullanımı %80'de uyarı, %100'de kritik; limit yoksa bulgu yok", () => {
    expect(kodlar({ finans: finans({ mevcutRiskTry: 79, kullanilabilirLimitTry: 100 }) })).toEqual([]);
    expect(kodlar({ finans: finans({ mevcutRiskTry: 80, kullanilabilirLimitTry: 100 }) })).toEqual(["risk_limiti:uyari"]);
    expect(kodlar({ finans: finans({ mevcutRiskTry: 100, kullanilabilirLimitTry: 100 }) })).toEqual(["risk_limiti:kritik"]);
    expect(kodlar({ finans: finans({ mevcutRiskTry: 1000, kullanilabilirLimitTry: null }) })).toEqual([]);
  });

  it("gecikme 10 günden fazla artarsa davranış kötüleşiyor uyarısı", () => {
    expect(kodlar({ finans: finans({ egilim: { sonUcAy: 25, oncekiAltiAy: 14 } }) })).toEqual(["davranis_kotulesiyor:uyari"]);
    expect(kodlar({ finans: finans({ egilim: { sonUcAy: 24, oncekiAltiAy: 14 } }) })).toEqual([]);
    expect(kodlar({ finans: finans({ egilim: { sonUcAy: 40, oncekiAltiAy: null } }) })).toEqual([]);
  });

  it("açık bakiye varken 90 günden uzun sessizlik bilgi verir", () => {
    expect(kodlar({ finans: finans({ acikBakiyeTry: 10, sonEtkilesim: new Date("2026-07-01T00:00:00Z") }) })).toEqual(["etkilesim_yok:bilgi"]);
    expect(kodlar({ finans: finans({ acikBakiyeTry: 10, sonEtkilesim: null }) })).toEqual(["etkilesim_yok:bilgi"]);
    expect(kodlar({ finans: finans({ acikBakiyeTry: 0, sonEtkilesim: null }) })).toEqual([]);
  });

  it("tedarikçi yönü: vadesi geçmiş ödememiz uyarı, yaklaşan bilgi", () => {
    expect(kodlar({ finans: finans({ borclarimiz: { vadesiGecmisTry: 100, yakinVadeTry: 50 } }) })).toEqual(["odememiz_gecikti:uyari"]);
    expect(kodlar({ finans: finans({ borclarimiz: { vadesiGecmisTry: 0, yakinVadeTry: 50 } }) })).toEqual(["odememiz_yaklasiyor:bilgi"]);
  });

  it("bulgular önem sırasıyla gelir: kritik, uyarı, bilgi", () => {
    const sonuc = kodlar({
      cari: { ...CARI, karaListe: true, karaListeNotu: "Ödeme yapmıyor" },
      finans: finans({ acikBakiyeTry: 500, vadesiGecmisTry: 500, enEskiGecikmeGun: 5, sorunluCekSayisi: 1, yaklasanCek: { sayi: 1, tutarTry: 200, enYakinVade: "2026-10-20" } }),
      satis: { bitenTeklifler: [{ id: "t1", no: "TKF2026000001", gecerlilikTarihi: "2026-10-20" }], bekleyenSiparisler: [] },
    });
    expect(sonuc).toEqual(["kara_liste:kritik", "vadesi_gecmis:uyari", "sorunlu_cek:uyari", "cek_vadesi:bilgi", "teklif_bitiyor:bilgi"]);
  });

  it("CARI-46: finans bölümü verilmezse finansal bulgu üretilmez", () => {
    const sonuc = kodlar({ satis: { bitenTeklifler: [], bekleyenSiparisler: [{ id: "s1", no: "SIP2026000003" }] } });
    expect(sonuc).toEqual(["teslim_bekliyor:bilgi"]);
  });

  it("her bulgu bir kanıt hedefi taşır; panel içi hedefler sekmedir", () => {
    const bulgular = durumBulgulari({ bugun: BUGUN, cari: CARI, finans: finans({ acikBakiyeTry: 500, vadesiGecmisTry: 500, enEskiGecikmeGun: 3 }) });
    expect(bulgular[0].kanit).toEqual({ etiket: "Ekstre", sekme: "ekstre" });
    expect(bulgular[0].mesaj).toContain("500,00 TL");
  });
});
