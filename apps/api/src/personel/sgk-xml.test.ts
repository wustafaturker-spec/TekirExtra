import { describe, expect, it } from "vitest";
import { aphbDogrula, aphbXml, iseGirisXml, istenCikisXml, type XmlIsyeri } from "./sgk-xml";
import { belgeTuruSigortaKolu, CIKIS_NEDENI_SGK_KODU, isyeriSiciliAyristir, iseGirisSonTarihi, istenCikisSonTarihi, tesvikKanunNo } from "./sgk-kodlari";
import { CIKIS_NEDENLERI } from "./cikis-hesabi";

const t = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SICIL = "2 4567 01 01 1234567 034 01 12 000";
const isyeri: XmlIsyeri = { sicil: isyeriSiciliAyristir(SICIL)!, unvan: "TEKİR EKSTRA TİCARET VE SANAYİ ANONİM ŞİRKETİ İSTANBUL ŞUBESİ", adres: "Atatürk Cad. No:1 <A> & B Kadıköy İstanbul Türkiye", isKolu: 17, vergiNo: "1234567801" };

describe("SGK kodları (PRS-23/24/27)", () => {
  it("26 haneli sicili sicil + kontrol + aracı olarak ayırır", () => {
    expect(isyeriSiciliAyristir(SICIL)).toEqual({ sicil: "245670101123456703401", kontrolNo: "12", araciNo: "000" });
    expect(isyeriSiciliAyristir("24567010112345670340112")).toBeNull();
    expect(isyeriSiciliAyristir("24567010112345670340100000")).toBeNull(); // kontrol no 00 olamaz
    expect(isyeriSiciliAyristir(null)).toBeNull();
  });
  it("belge türünden sigorta kolu; eşlemesi olmayan null", () => {
    expect(["1", "01", "13", "2", "7", "22", "12"].map(belgeTuruSigortaKolu)).toEqual(["0", "0", "0", "8", "7", "19", null]);
  });
  it("her yasal çıkış nedeninin SGK kodu var", () => {
    for (const neden of Object.keys(CIKIS_NEDENLERI)) expect(CIKIS_NEDENI_SGK_KODU[neden as keyof typeof CIKIS_NEDENLERI]).toMatch(/^\d{2}$/);
  });
  it("teşvik kanun no önerisi", () => {
    expect(tesvikKanunNo(null, 5)).toBe("05510");
    expect(tesvikKanunNo(undefined, 0)).toBe("00000");
    expect(tesvikKanunNo("06111", 5)).toBe("06111");
  });
  it("bildirge son tarihleri: girişte bir gün önce, çıkışta 10 gün sonra (ay/yıl taşması dahil)", () => {
    expect(iseGirisSonTarihi(t("2026-11-01")).toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(istenCikisSonTarihi(t("2026-12-25")).toISOString().slice(0, 10)).toBe("2027-01-04");
  });
});

describe("e-Bildirge toplu XML (PRS-25)", () => {
  it("işe giriş: kılavuzdaki öğe ve öznitelikler, kaçış ve kesme", () => {
    const xml = iseGirisXml(isyeri, [{ tckn: "10000000146", ad: "ayşe", soyad: "yılmaz", girisTarihi: "2026-10-20", sigortaKolu: "0", engelli: true, eskiHukumlu: false, ogrenimKodu: 5, mezuniyetYili: 2015, mezuniyetBolumu: "İşletme", meslekKodu: "2411.01" }]);
    expect(xml).toContain('<ISYERI ISYERISICIL="245670101123456703401" ISYERIARACINO="000"');
    expect(xml).toContain('ISYERIADRES="Atatürk Cad. No:1 &lt;A&gt; &amp; B Kadıköy İstanbul Türkiye"');
    expect(xml).toContain('<SIGORTALI TCKNO="10000000146" AD="AYŞE" SOYAD="YILMAZ" ISEGIRISTARIHI="2026-10-20" SIGORTAKOLU="0" OZURLUKODU="E" ESKIHUKUMLU="H" OGRENIMKODU="5" MEZUNIYETYILI="2015" MEZUNIYETBOLUMU="İşletme" CSGBISKOLU="17" MESLEKKODU="2411.01" GOREVKODU="2"/>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<SGK4AISEGIRIS>')).toBe(true);
  });
  it("işten çıkış: önceki dönem yoksa yazılmaz, eksik gün yoksa neden 0", () => {
    const xml = istenCikisXml(isyeri, [{ tckn: "10000000146", ad: "Ali", soyad: "Kaya", cikisTarihi: "2026-10-15", meslekKodu: "2411.01", cikisKodu: "03", onceki: null, bulundugumuz: { belgeTuru: "1", hakEdilenUcret: "16515.00", primIkramiye: "0.00", eksikGunSayisi: 0, eksikGunNedeni: "02" } }]);
    expect(xml).toContain('ISTENCIKISTARIHI="2026-10-15" MESLEKKODU="2411.01" ISTENAYRILISNEDENI="3" CSGBISKOLU="17" UCRETYUZDEUSULU="H">');
    expect(xml).not.toContain("ONCEKIDONEM");
    expect(xml).toContain('<BULUNDUGUMUZDONEM BELGETURU="1" HAKEDILENUCRET="16515.00" PRIMIKRAMIYE="0.00" EKSIKGUNSAYISI="0" EKSIKGUNNEDENI="0"/>');
  });
});

describe("APHB XML (PRS-28)", () => {
  const sigortali = { tckn: "10000000146", ad: "Muhammed Mustafa Ahmet", soyad: "Yılmaz", pek: "33030.00", primIkramiye: "0.00", gun: 30, girisTarihi: null, cikisTarihi: null, eksikGunSayisi: 0, eksikGunNedeni: null, cikisKodu: null, meslekKodu: "2411.01" };
  it("şemaya uyar: iki bildirge, giriş/çıkış günü, eksik gün, 18 karaktere kesilen ad", async () => {
    const xml = aphbXml(isyeri, 2026, 10, [
      { belgeTuru: "1", kanun: "05510", sigortalilar: [sigortali, { ...sigortali, tckn: "10000000078", ad: "Ali", pek: "15000.00", primIkramiye: "2000.00", gun: 15, girisTarihi: null, cikisTarihi: "2026-10-15", cikisKodu: "03", eksikGunSayisi: 0 }] },
      { belgeTuru: "2", kanun: "00000", sigortalilar: [{ ...sigortali, tckn: "10000000210", gun: 12, girisTarihi: "2026-10-20", eksikGunSayisi: 3, eksikGunNedeni: "02", meslekKodu: null }] },
    ]);
    expect(await aphbDogrula(xml)).toEqual([]);
    expect(xml).toContain('<BORDRO TAHAKKUKNEDEN="A" BELGEMAHIYET="A" DONEMAY="10" DONEMYIL="2026"/>');
    expect(xml).toContain('KONTROLNO="12" ISYERIARACINO="000" ISYERIUNVAN="TEKİR EKSTRA TİCARET VE SANAYİ ANONİM ŞİRKETİ İSTA"');
    expect(xml).toContain('<BILDIRGELER BELGETURU="01" KANUN="05510">');
    expect(xml).toContain('SIRA="1" TCKNO="10000000146" AD="MUHAMMED MUSTAFA A"');
    expect(xml).toContain('SIRA="2" TCKNO="10000000078" AD="ALİ" SOYAD="YILMAZ" PEK="15000.00" PRIM_IKRAMIYE="2000.00" GUN="15" CIKISGUN="1510" ISTENCIKISNEDENI="03"');
    expect(xml).toContain('SIRA="1" TCKNO="10000000210" AD="MUHAMMED MUSTAFA A" SOYAD="YILMAZ" PEK="33030.00" GUN="12" GIRISGUN="2010" EKSIKGUNNEDENI="02" EKSIKGUNSAYISI="3"/>');
  });
  it("şema dışı değer hatayla döner", async () => {
    const xml = aphbXml(isyeri, 2026, 10, [{ belgeTuru: "1", kanun: "5510", sigortalilar: [sigortali] }]);
    expect((await aphbDogrula(xml)).join(" ")).toMatch(/KANUN/);
  });
});
