/**
 * PRS-25/28 (P3-3): SGK yükleme dosyaları. İşe giriş (`SGK4AISEGIRIS`) ve
 * işten ayrılış (`SGK4AISTENCIKIS`) SGK 4A toplu XML kılavuzuna, aylık prim ve
 * hizmet belgesi (`AYLIKBILDIRGELER`) APHB-3.1.xsd'ye göre yazılır (docs/sgk/).
 * Dosyalar yalnız indirilir; yüklemeyi kullanıcı kendi SGK/GİB oturumunda yapar.
 */
import { validateXML } from "xmllint-wasm";
import { APHB_XSD } from "./aphb-xsd";
import type { IsyeriSicili } from "./sgk-kodlari";

export interface XmlIsyeri { sicil: IsyeriSicili; unvan: string; adres: string; isKolu: number; vergiNo?: string | null }

export interface IseGirisKisisi {
  tckn: string; ad: string; soyad: string; girisTarihi: string; sigortaKolu: string; engelli: boolean; eskiHukumlu: boolean;
  ogrenimKodu: number; mezuniyetYili: number | null; mezuniyetBolumu: string | null; meslekKodu: string;
}

export interface CikisDonemi { belgeTuru: string; hakEdilenUcret: string; primIkramiye: string; eksikGunSayisi: number; eksikGunNedeni: string | null }

export interface IstenCikisKisisi { tckn: string; ad: string; soyad: string; cikisTarihi: string; meslekKodu: string; cikisKodu: string; onceki: CikisDonemi | null; bulundugumuz: CikisDonemi }

export interface AphbSigortali {
  tckn: string; ad: string; soyad: string; pek: string; primIkramiye: string; gun: number;
  girisTarihi: string | null; cikisTarihi: string | null; eksikGunSayisi: number; eksikGunNedeni: string | null; cikisKodu: string | null; meslekKodu: string | null;
}

export interface AphbBildirge { belgeTuru: string; kanun: string; sigortalilar: AphbSigortali[] }

const kacis = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** Kurumun azami uzunluğuna kesilir; metin içindeki satır sonları tek boşluğa iner. */
const metin = (v: string | null | undefined, azami: number) => kacis((v ?? "").replace(/\s+/g, " ").trim().slice(0, azami));
const buyuk = (v: string, azami: number) => metin(v.toLocaleUpperCase("tr-TR"), azami);
const eh = (v: boolean) => (v ? "E" : "H");
const iki = (n: number) => String(n).padStart(2, "0");
/** APHB giriş/çıkış günü GGAA (ör. 15 Ekim → 1510). */
const ggaa = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const XML_BASI = '<?xml version="1.0" encoding="UTF-8"?>\n';

function isyeriOgesi(i: XmlIsyeri) {
  return `  <ISYERI ISYERISICIL="${i.sicil.sicil}" ISYERIARACINO="${i.sicil.araciNo}" ISYERIUNVAN="${metin(i.unvan, 250)}" ISYERIADRES="${metin(i.adres, 200)}"/>`;
}

export function iseGirisXml(isyeri: XmlIsyeri, kisiler: IseGirisKisisi[]): string {
  const satirlar = kisiler.map((k) => `    <SIGORTALI TCKNO="${k.tckn}" AD="${buyuk(k.ad, 50)}" SOYAD="${buyuk(k.soyad, 50)}" ISEGIRISTARIHI="${k.girisTarihi}" SIGORTAKOLU="${k.sigortaKolu}" OZURLUKODU="${eh(k.engelli)}" ESKIHUKUMLU="${eh(k.eskiHukumlu)}" OGRENIMKODU="${k.ogrenimKodu}" MEZUNIYETYILI="${k.mezuniyetYili ?? 0}" MEZUNIYETBOLUMU="${metin(k.mezuniyetBolumu, 100)}" CSGBISKOLU="${isyeri.isKolu}" MESLEKKODU="${k.meslekKodu}" GOREVKODU="2"/>`);
  return `${XML_BASI}<SGK4AISEGIRIS>\n${isyeriOgesi(isyeri)}\n  <SIGORTALILAR>\n${satirlar.join("\n")}\n  </SIGORTALILAR>\n</SGK4AISEGIRIS>\n`;
}

const donemOgesi = (etiket: string, d: CikisDonemi) =>
  `      <${etiket} BELGETURU="${Number(d.belgeTuru)}" HAKEDILENUCRET="${d.hakEdilenUcret}" PRIMIKRAMIYE="${d.primIkramiye}" EKSIKGUNSAYISI="${d.eksikGunSayisi}" EKSIKGUNNEDENI="${d.eksikGunSayisi > 0 && d.eksikGunNedeni ? Number(d.eksikGunNedeni) : 0}"/>`;

export function istenCikisXml(isyeri: XmlIsyeri, kisiler: IstenCikisKisisi[]): string {
  const satirlar = kisiler.map((k) => [
    `    <SIGORTALI TCKNO="${k.tckn}" AD="${buyuk(k.ad, 50)}" SOYAD="${buyuk(k.soyad, 50)}" ISTENCIKISTARIHI="${k.cikisTarihi}" MESLEKKODU="${k.meslekKodu}" ISTENAYRILISNEDENI="${Number(k.cikisKodu)}" CSGBISKOLU="${isyeri.isKolu}" UCRETYUZDEUSULU="H">`,
    ...(k.onceki ? [donemOgesi("ONCEKIDONEM", k.onceki)] : []),
    donemOgesi("BULUNDUGUMUZDONEM", k.bulundugumuz),
    "    </SIGORTALI>",
  ].join("\n"));
  return `${XML_BASI}<SGK4AISTENCIKIS>\n${isyeriOgesi(isyeri)}\n  <SIGORTALILAR>\n${satirlar.join("\n")}\n  </SIGORTALILAR>\n</SGK4AISTENCIKIS>\n`;
}

/**
 * PRS-28: asıl (A) mahiyetli, süresinde (A) verilen aylık prim ve hizmet
 * belgesi. Belge türü + kanun ikilisi başına bir BILDIRGELER; sıra her
 * bildirgede 1'den başlar. PEK = ücret + prim/ikramiye (şema notu).
 */
export function aphbXml(isyeri: XmlIsyeri, yil: number, ay: number, bildirgeler: AphbBildirge[]): string {
  const vergiNo = (isyeri.vergiNo ?? "").replace(/\D/g, "");
  const kisi = (s: AphbSigortali, sira: number) => {
    const oznitelik: [string, string | number | null][] = [
      ["SIRA", sira], ["TCKNO", s.tckn], ["AD", buyuk(s.ad, 18)], ["SOYAD", buyuk(s.soyad, 18)], ["PEK", s.pek],
      ["PRIM_IKRAMIYE", Number(s.primIkramiye) > 0 ? s.primIkramiye : null], ["GUN", s.gun],
      ["GIRISGUN", s.girisTarihi ? ggaa(s.girisTarihi) : null], ["CIKISGUN", s.cikisTarihi ? ggaa(s.cikisTarihi) : null],
      ["EKSIKGUNNEDENI", s.eksikGunSayisi > 0 && s.eksikGunNedeni ? s.eksikGunNedeni : null], ["EKSIKGUNSAYISI", s.eksikGunSayisi > 0 ? s.eksikGunSayisi : null],
      ["ISTENCIKISNEDENI", s.cikisTarihi && s.cikisKodu ? s.cikisKodu : null], ["MESLEKKOD", s.meslekKodu],
    ];
    return `        <SIGORTALI ${oznitelik.filter(([, v]) => v !== null && v !== "").map(([a, v]) => `${a}="${v}"`).join(" ")}/>`;
  };
  const govde = bildirgeler.map((b) => `  <BILDIRGELER BELGETURU="${iki(Number(b.belgeTuru))}" KANUN="${b.kanun}">\n    <SIGORTALILAR>\n${b.sigortalilar.map((s, i) => kisi(s, i + 1)).join("\n")}\n    </SIGORTALILAR>\n  </BILDIRGELER>`);
  return `${XML_BASI}<AYLIKBILDIRGELER>\n  <ISYERI ISYERISICIL="${isyeri.sicil.sicil}" KONTROLNO="${isyeri.sicil.kontrolNo}" ISYERIARACINO="${isyeri.sicil.araciNo}" ISYERIUNVAN="${metin(isyeri.unvan, 50)}" ISYERIADRES="${metin(isyeri.adres, 50)}"${vergiNo ? ` ISYERIVERGINO="${vergiNo}"` : ""}/>\n  <BORDRO TAHAKKUKNEDEN="A" BELGEMAHIYET="A" DONEMAY="${ay}" DONEMYIL="${yil}"/>\n${govde.join("\n")}\n</AYLIKBILDIRGELER>\n`;
}

/** APHB dosyasını şemaya karşı doğrular; hata satırlarını döner (boşsa geçerli). */
export async function aphbDogrula(xml: string): Promise<string[]> {
  const sonuc = await validateXML({ xml: [{ fileName: "aphb.xml", contents: xml }], schema: [{ fileName: "APHB-3.1.xsd", contents: APHB_XSD }] });
  return sonuc.valid ? [] : sonuc.errors.map((h) => h.message ?? h.rawMessage);
}
