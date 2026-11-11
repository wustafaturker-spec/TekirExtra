import * as ExcelJS from "exceljs";
import { DOVIZ_CINSLERI, metinNormalize } from "@tekirextra/shared";
import { hucreMetni, tabloOku, type BaslikEslemeleri, type OkunanTablo, type SutunTanimi } from "../veri-aktarimi/tablo";

export { hucreMetni };

/**
 * CARI-31 (karar 2026-10-03): cari Excel içe aktarma şablonu ve satır
 * çözümleme. Saf fonksiyonlardır; eşleştirme, kimlik ve kur denetimi
 * `cari-ice-aktarma.service.ts`'tedir. Sütunlar başlığa göre okunur, sıra
 * değişse de çalışır; başlığı tanınmayan eski 6 sütunlu dosya konumuna göre okunur.
 */

export const SUTUNLAR = [
  { anahtar: "kod", baslik: "Kod", aciklama: "Boşsa VKN/TCKN ile eşleşir; o da yoksa CARI-NNN verilir", ornek: "MUS-010" },
  { anahtar: "unvan", baslik: "Ünvan", aciklama: "Tüzel kişide zorunlu; gerçek kişide ad soyaddan türer", ornek: "Örnek Ticaret A.Ş." },
  { anahtar: "tip", baslik: "Tip", aciklama: "Müşteri, Tedarikçi, Her ikisi, Personel, Ortak, Diğer (boşsa yeni kartta Müşteri)", ornek: "Müşteri" },
  { anahtar: "kisiTipi", baslik: "Kişi tipi", aciklama: "Tüzel ya da Gerçek (boşsa yeni kartta Tüzel)", ornek: "Tüzel" },
  { anahtar: "ad", baslik: "Ad", aciklama: "Gerçek kişide zorunlu", ornek: "" },
  { anahtar: "soyad", baslik: "Soyad", aciklama: "Gerçek kişide zorunlu", ornek: "" },
  { anahtar: "vknTckn", baslik: "VKN/TCKN", aciklama: "10 haneli VKN ya da 11 haneli TCKN", ornek: "1234567890" },
  { anahtar: "vergiDairesi", baslik: "Vergi dairesi", aciklama: "", ornek: "Kadıköy" },
  { anahtar: "eposta", baslik: "E-posta", aciklama: "", ornek: "muhasebe@ornek.com" },
  { anahtar: "telefon", baslik: "Telefon", aciklama: "", ornek: "0216 000 00 00" },
  { anahtar: "adres", baslik: "Adres", aciklama: "Fatura adresi; doluysa adres sütunları işlenir", ornek: "Örnek Mah. 1. Sok. No:1" },
  { anahtar: "il", baslik: "İl", aciklama: "", ornek: "İstanbul" },
  { anahtar: "ilce", baslik: "İlçe", aciklama: "", ornek: "Kadıköy" },
  { anahtar: "postaKodu", baslik: "Posta kodu", aciklama: "", ornek: "34710" },
  { anahtar: "ulke", baslik: "Ülke", aciklama: "İki harfli kod (boşsa TR)", ornek: "TR" },
  { anahtar: "dovizCinsi", baslik: "Döviz", aciklama: "Cari dövizi (TRY, USD, EUR…)", ornek: "TRY" },
  { anahtar: "varsayilanVadeGun", baslik: "Vade (gün)", aciklama: "0–365", ornek: "30" },
  { anahtar: "varsayilanIskonto", baslik: "İskonto %", aciklama: "0–100", ornek: "" },
  { anahtar: "riskLimiti", baslik: "Risk limiti", aciklama: "TL", ornek: "100000" },
  { anahtar: "etiketler", baslik: "Etiketler", aciklama: "Virgülle ayrılmış; olmayan etiket oluşturulur, mevcut etiketler korunur", ornek: "Bayi, VIP" },
  { anahtar: "acilisTutari", baslik: "Açılış bakiyesi", aciklama: "Yalnız yeni kartta ya da açılışı olmayan kartta yazılır", ornek: "" },
  { anahtar: "acilisYonu", baslik: "Açılış yönü", aciklama: "Borç (cari bize borçlu) ya da Alacak", ornek: "" },
  { anahtar: "acilisDovizi", baslik: "Açılış dövizi", aciklama: "Boşsa cari dövizi", ornek: "" },
  { anahtar: "acilisKuru", baslik: "Açılış kuru", aciklama: "Dövizde boşsa TCMB kuru; 1 olamaz", ornek: "" },
  { anahtar: "acilisTarihi", baslik: "Açılış tarihi", aciklama: "Açılış tutarı varsa zorunlu (gg.aa.yyyy)", ornek: "" },
  { anahtar: "acilisVadesi", baslik: "Açılış vadesi", aciklama: "gg.aa.yyyy", ornek: "" },
] as const;

export type SutunAnahtari = (typeof SUTUNLAR)[number]["anahtar"];
export type HamSatir = { satir: number; hucreler: Partial<Record<SutunAnahtari, string>> };

const ESKI_DUZEN: SutunAnahtari[] = ["kod", "unvan", "tip", "vknTckn", "eposta", "telefon"];
export const AZAMI_SATIR = 5000;

/**
 * Elle hazırlanmış dosyalardaki ve kaynak programların (Logo, Mikro, Netsis, Paraşüt)
 * dışa aktarımlarındaki yaygın başlık yazımları (VAK-03).
 */
const BASLIK_TAKMA_ADLARI: Record<string, SutunAnahtari> = {
  "cari kodu": "kod", "cari kod": "kod", "cari hesap kodu": "kod", "hesap kodu": "kod", "musteri kodu": "kod", "tedarikci kodu": "kod",
  "unvani": "unvan", "firma adi": "unvan", "cari adi": "unvan", "cari unvani": "unvan", "cari hesap unvani": "unvan", "cari unvani 1": "unvan", "cari isim": "unvan", "cari ismi": "unvan", "musteri adi": "unvan", "tedarikci adi": "unvan", "isim": "unvan", "ad / unvan": "unvan",
  "cari tipi": "tip", tur: "tip", "hesap turu": "tip", "cari hesap turu": "tip",
  vkn: "vknTckn", tckn: "vknTckn", "vkn / tckn": "vknTckn", "vkn/tckn": "vknTckn", "vergi no": "vknTckn", "vergi numarasi": "vknTckn", "vergi kimlik no": "vknTckn", "tc kimlik no": "vknTckn", "tc kimlik numarasi": "vknTckn", "vergi dairesi no": "vknTckn",
  "vergi dairesi adi": "vergiDairesi", "v.d.": "vergiDairesi", vd: "vergiDairesi",
  eposta: "eposta", "e-mail": "eposta", email: "eposta", "e-posta adresi": "eposta", "eposta adresi": "eposta", "mail": "eposta",
  tel: "telefon", "telefon 1": "telefon", "telefon no": "telefon", "cep tel": "telefon", "cep telefonu": "telefon", "gsm": "telefon",
  "adres 1": "adres", "fatura adresi": "adres", "il / sehir": "il", sehir: "il", "ilce adi": "ilce", "posta kodu": "postaKodu", "ulke kodu": "ulke",
  "para birimi": "dovizCinsi", "doviz cinsi": "dovizCinsi", "doviz turu": "dovizCinsi", vade: "varsayilanVadeGun", "vade gunu": "varsayilanVadeGun", "odeme vadesi": "varsayilanVadeGun",
  "risk limiti tl": "riskLimiti", "kredi limiti": "riskLimiti",
};

/** VAK-03: ortak okuyucunun kullandığı sütun tanımı (şablon başlığı + eşanlamlılar). */
export const CARI_SUTUNLARI: SutunTanimi<SutunAnahtari>[] = SUTUNLAR.map((s) => ({
  ...s,
  esanlamlilar: Object.entries(BASLIK_TAKMA_ADLARI).filter(([, a]) => a === s.anahtar).map(([b]) => b),
}));


/**
 * Cari tablosu. Başlıklar tanınmazsa (en az iki başlık) eski 6 sütunlu dosya düzeni
 * (Kod, Ünvan, Tip, VKN, E-posta, Telefon) varsayılır; elle eşleme verilmişse bu yapılmaz.
 */
export async function cariTablosunuOku(buffer: Buffer, eslemeler: BaslikEslemeleri = {}): Promise<OkunanTablo<SutunAnahtari>> {
  const tablo = await tabloOku(buffer, CARI_SUTUNLARI, eslemeler);
  const taninan = tablo.basliklar.filter((b) => b.anahtar).length;
  if (taninan >= 2 || Object.keys(eslemeler).length) return tablo;
  const kitap = new ExcelJS.Workbook();
  await kitap.xlsx.load(buffer as unknown as ArrayBuffer);
  const sayfa = kitap.worksheets[0];
  const satirlar: HamSatir[] = [];
  sayfa.eachRow((row, no) => {
    if (no === 1) return;
    const hucreler: HamSatir["hucreler"] = {};
    row.eachCell({ includeEmpty: false }, (hucre, s) => {
      const anahtar = ESKI_DUZEN[s - 1];
      const metin = hucreMetni(hucre.value);
      if (anahtar && metin) hucreler[anahtar] = metin;
    });
    if (Object.keys(hucreler).length) satirlar.push({ satir: no, hucreler });
  });
  if (satirlar.length > AZAMI_SATIR) throw new Error(`Bir dosyada en fazla ${AZAMI_SATIR} satır içe aktarılabilir`);
  return { satirlar, basliklar: ESKI_DUZEN.map((a) => ({ baslik: SUTUNLAR.find((s) => s.anahtar === a)!.baslik, anahtar: a, elle: false })), taninmayanlar: [] };
}

export async function excelSatirlariniOku(buffer: Buffer, eslemeler: BaslikEslemeleri = {}): Promise<HamSatir[]> {
  return (await cariTablosunuOku(buffer, eslemeler)).satirlar;
}

// ─── Değer çözümleyicileri: geçersizse hata metni döner ─────────────────────

export type Cozum<T> = { deger: T } | { hata: string };

const TIP_ESLEMESI: Record<string, "musteri" | "tedarikci" | "her_ikisi" | "personel" | "ortak" | "diger"> = {
  musteri: "musteri", tedarikci: "tedarikci", "her ikisi": "her_ikisi", her_ikisi: "her_ikisi", "ikisi de": "her_ikisi",
  personel: "personel", ortak: "ortak", diger: "diger",
};
export function tipCoz(metin: string): Cozum<(typeof TIP_ESLEMESI)[string]> {
  const t = TIP_ESLEMESI[metinNormalize(metin)];
  return t ? { deger: t } : { hata: `Tip "${metin}" tanınmadı (Müşteri, Tedarikçi, Her ikisi, Personel, Ortak, Diğer)` };
}

export function kisiTipiCoz(metin: string): Cozum<"tuzel" | "gercek"> {
  const t = metinNormalize(metin);
  if (t.startsWith("tuzel")) return { deger: "tuzel" };
  if (t.startsWith("gercek")) return { deger: "gercek" };
  return { hata: `Kişi tipi "${metin}" tanınmadı (Tüzel ya da Gerçek)` };
}

/** "1.234,56", "1234,56", "1234.56" ve Excel sayısı. */
export function sayiCoz(metin: string, alan: string, enAz = 0, enCok?: number): Cozum<number> {
  const temiz = metin.replace(/\s|TL|₺/gi, "");
  const normal = temiz.includes(",") ? temiz.replace(/\./g, "").replace(",", ".") : temiz;
  const n = Number(normal);
  if (!normal || !Number.isFinite(n)) return { hata: `${alan} sayı değil: "${metin}"` };
  if (n < enAz || (enCok !== undefined && n > enCok)) return { hata: `${alan} ${enAz}${enCok !== undefined ? `–${enCok}` : " veya üstü"} olmalı` };
  return { deger: Math.round(n * 1_000_000) / 1_000_000 };
}

/** gg.aa.yyyy, gg/aa/yyyy ya da yyyy-aa-gg → yyyy-aa-gg. */
export function tarihCoz(metin: string, alan: string): Cozum<string> {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(metin);
  let [y, a, g] = m ? [m[1], m[2], m[3]] : ["", "", ""];
  if (!m) {
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(metin);
    if (m) [g, a, y] = [m[1].padStart(2, "0"), m[2].padStart(2, "0"), m[3]];
  }
  const iso = `${y}-${a}-${g}`;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (!m || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { hata: `${alan} geçersiz: "${metin}" (gg.aa.yyyy)` };
  return { deger: iso };
}

export function dovizCoz(metin: string, alan: string): Cozum<string> {
  const d = metin.toLocaleUpperCase("tr-TR").replace("TL", "TRY").trim();
  return (DOVIZ_CINSLERI as readonly string[]).includes(d) ? { deger: d } : { hata: `${alan} "${metin}" desteklenmiyor` };
}

export function yonCoz(metin: string): Cozum<"borc" | "alacak"> {
  const t = metinNormalize(metin);
  if (t.startsWith("borc") || t === "b") return { deger: "borc" };
  if (t.startsWith("alacak") || t === "a") return { deger: "alacak" };
  return { hata: `Açılış yönü "${metin}" tanınmadı (Borç ya da Alacak)` };
}

export const EPOSTA_DESENI = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Şablon: başlıklar, örnek satır ve sütun açıklamaları ikinci sayfada. */
export async function sablonOlustur(): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet("Cariler");
  sayfa.columns = SUTUNLAR.map((s) => ({ header: s.baslik, key: s.anahtar, width: Math.max(12, s.baslik.length + 4) }));
  sayfa.getRow(1).font = { bold: true };
  sayfa.addRow(Object.fromEntries(SUTUNLAR.map((s) => [s.anahtar, s.ornek])));
  sayfa.views = [{ state: "frozen", ySplit: 1 }];
  const aciklama = kitap.addWorksheet("Açıklama");
  aciklama.columns = [{ header: "Sütun", key: "baslik", width: 18 }, { header: "Açıklama", key: "aciklama", width: 90 }];
  aciklama.getRow(1).font = { bold: true };
  for (const s of SUTUNLAR) aciklama.addRow({ baslik: s.baslik, aciklama: s.aciklama });
  aciklama.addRow({});
  aciklama.addRow({ baslik: "Kural", aciklama: "Eşleşen kartta yalnız dolu hücreler yazılır; boş hücre mevcut değeri silmez." });
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

/** Hatalı satırlar: dosyadaki değerler + en sağda hata nedeni. */
export async function hataliSatirlarDosyasi(satirlar: Array<HamSatir & { hatalar: string[] }>): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet("Hatalı satırlar");
  sayfa.columns = [...SUTUNLAR.map((s) => ({ header: s.baslik, key: s.anahtar, width: Math.max(12, s.baslik.length + 4) })), { header: "Satır", key: "_satir", width: 8 }, { header: "Hata", key: "_hata", width: 70 }];
  sayfa.getRow(1).font = { bold: true };
  for (const s of satirlar) sayfa.addRow({ ...s.hucreler, _satir: s.satir, _hata: s.hatalar.join("; ") });
  return Buffer.from(await kitap.xlsx.writeBuffer());
}
