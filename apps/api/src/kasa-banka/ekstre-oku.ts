/**
 * KSB-06 banka ekstresi okuyucu.
 *
 * Türk bankalarının ekstre dosyaları ortak bir düzen izlemiyor: ayırıcı `;`
 * ya da `,`, sayılar `1.234,56` ya da `1234.56`, tarih `gg.aa.yyyy` ya da
 * `yyyy-aa-gg`, tutar kimi bankada tek işaretli sütun kimi bankada ayrı
 * borç/alacak sütunları. Bu dosya ham metni sütunlara ayırır; hangi sütunun ne
 * olduğu {@link SutunEslemesi} ile dışarıdan söylenir (kullanıcı bir kez eşler,
 * eşleme banka hesabına kaydedilir).
 */
import { createHash } from "node:crypto";
import * as ExcelJS from "exceljs";

export interface SutunEslemesi {
  /** Başlık satırının 0-tabanlı indisi; veri bir sonraki satırdan başlar. */
  baslikSatiri: number;
  tarih: number;
  aciklama: number;
  /** İşaretli tek tutar sütunu. Yoksa borc+alacak verilmelidir. */
  tutar?: number | null;
  /** Ayrı sütunlu ekstrelerde para çıkışı. */
  borc?: number | null;
  /** Ayrı sütunlu ekstrelerde para girişi. */
  alacak?: number | null;
  dekontNo?: number | null;
  karsiIban?: number | null;
  karsiUnvan?: number | null;
  bakiye?: number | null;
}

export interface EkstreSatiri {
  tarih: Date;
  /** Artı = hesaba giriş (tahsilat), eksi = çıkış (tediye). */
  tutar: number;
  aciklama: string;
  dekontNo?: string;
  karsiIban?: string;
  karsiUnvan?: string;
  bakiye?: number;
  satirOzeti: string;
}

export class EkstreOkumaHatasi extends Error {}

/* ─── Ham metni tabloya çevirme ─────────────────────────────────────────── */

/** Türk bankalarının dosyaları çoğunlukla `;`; virgül ondalık ayırıcı olduğu için. */
function ayiriciBul(metin: string): string {
  const ilkSatirlar = metin.split(/\r?\n/).slice(0, 10).join("\n");
  const adaylar = [";", "\t", ","];
  let enIyi = ";";
  let enCok = 0;
  for (const a of adaylar) {
    const sayi = ilkSatirlar.split(a).length - 1;
    if (sayi > enCok) {
      enCok = sayi;
      enIyi = a;
    }
  }
  return enIyi;
}

/** Tırnaklı alanları ve alan içi ayırıcıları doğru ele alan CSV bölücü. */
function satirBol(satir: string, ayirici: string): string[] {
  const alanlar: string[] = [];
  let mevcut = "";
  let tirnakta = false;

  for (let i = 0; i < satir.length; i++) {
    const k = satir[i];
    if (k === '"') {
      // Tırnak içinde çift tırnak kaçış demektir ("" → ")
      if (tirnakta && satir[i + 1] === '"') {
        mevcut += '"';
        i++;
      } else {
        tirnakta = !tirnakta;
      }
    } else if (k === ayirici && !tirnakta) {
      alanlar.push(mevcut.trim());
      mevcut = "";
    } else {
      mevcut += k;
    }
  }
  alanlar.push(mevcut.trim());
  return alanlar;
}

/**
 * Dosyayı satır/sütun dizisine çevirir. Bankalar dosyayı UTF-8 ya da
 * windows-1254 verebiliyor; UTF-8 çözümü bozuk karakter üretiyorsa 1254'e
 * düşülür.
 */
export function ekstreTabloOku(buffer: Buffer): string[][] {
  let metin = new TextDecoder("utf-8").decode(buffer);
  // U+FFFD = çözülemeyen bayt; Türkçe karakterli 1254 dosyalarda görülür.
  if (metin.includes("�")) {
    try {
      metin = new TextDecoder("windows-1254").decode(buffer);
    } catch {
      /* çözücü yoksa UTF-8 sonucuyla devam */
    }
  }
  metin = metin.replace(/^﻿/, ""); // BOM

  const ayirici = ayiriciBul(metin);
  const satirlar = metin
    .split(/\r?\n/)
    .filter((s) => s.trim() !== "")
    .map((s) => satirBol(s, ayirici));

  if (satirlar.length === 0) throw new EkstreOkumaHatasi("Dosya boş");
  return satirlar;
}

/* ─── Alan çözümleyiciler ───────────────────────────────────────────────── */

/** `1.234,56`, `1,234.56`, `1234.56`, `(1.234,56)` ve `1.234,56 TL` biçimleri. */
export function tutarCoz(ham: string): number | null {
  let s = (ham ?? "").trim();
  if (!s) return null;

  // Muhasebe biçimi: parantez içi = eksi
  let negatif = false;
  if (/^\(.*\)$/.test(s)) {
    negatif = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negatif = true;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);

  // Para birimi eki/simgesi at
  s = s.replace(/(TL|TRY|USD|EUR|₺|\$|€)/gi, "").trim();
  s = s.replace(/\s/g, "");
  if (!s) return null;

  const sonNokta = s.lastIndexOf(".");
  const sonVirgul = s.lastIndexOf(",");

  if (sonNokta >= 0 && sonVirgul >= 0) {
    // Hangisi sonda ise ondalık ayırıcıdır, diğeri binlik
    if (sonVirgul > sonNokta) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (sonVirgul >= 0) {
    // Tek virgül: 3 haneli grup ise binlik (1,234), değilse ondalık (12,5)
    const sonrasi = s.length - sonVirgul - 1;
    s = sonrasi === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  }

  const d = Number(s);
  if (!Number.isFinite(d)) return null;
  return negatif ? -d : d;
}

/** .xlsx dosyaları ZIP kabıdır; ilk dört bayt `PK\x03\x04`. */
export function excelMi(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * KSB-06: ekstre dosyasını tabloya çevirir; CSV/TXT ya da Excel (.xlsx).
 * Excel'de ilk çalışma sayfası okunur; tarih hücreleri `yyyy-aa-gg`, sayılar
 * noktalı ondalıkla yazılır (tarih/tutar çözücüleri ikisini de anlar). Sütun
 * eşlemesi CSV'deki gibi kullanıcıdan alınır.
 */
export async function ekstreDosyasiOku(buffer: Buffer): Promise<string[][]> {
  if (!excelMi(buffer)) return ekstreTabloOku(buffer);
  const kitap = new ExcelJS.Workbook();
  try {
    await kitap.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new EkstreOkumaHatasi("Excel dosyası okunamadı; dosyanın .xlsx biçiminde olduğundan emin olun (eski .xls desteklenmez)");
  }
  const sayfa = kitap.worksheets[0];
  if (!sayfa) throw new EkstreOkumaHatasi("Excel dosyasında çalışma sayfası yok");
  const tablo: string[][] = [];
  sayfa.eachRow({ includeEmpty: true }, (satir) => {
    const hucreler: string[] = [];
    for (let i = 1; i <= sayfa.columnCount; i++) hucreler.push(hucreMetni(satir.getCell(i).value));
    tablo.push(hucreler);
  });
  while (tablo.length && tablo[tablo.length - 1].every((h) => !h.trim())) tablo.pop();
  if (tablo.length === 0) throw new EkstreOkumaHatasi("Excel dosyası boş");
  return tablo;
}

function hucreMetni(deger: ExcelJS.CellValue): string {
  if (deger === null || deger === undefined) return "";
  if (deger instanceof Date) return deger.toISOString().slice(0, 10);
  if (typeof deger === "number") return String(deger);
  if (typeof deger === "string" || typeof deger === "boolean") return String(deger).trim();
  if (typeof deger === "object") {
    if ("richText" in deger) return deger.richText.map((p) => p.text).join("").trim();
    if ("result" in deger) return hucreMetni(deger.result as ExcelJS.CellValue);
    if ("text" in deger) return String(deger.text).trim();
  }
  return String(deger);
}

/** `gg.aa.yyyy`, `gg/aa/yyyy`, `yyyy-aa-gg` (+ isteğe bağlı saat). */
export function tarihCoz(ham: string): Date | null {
  const s = (ham ?? "").trim();
  if (!s) return null;

  const sadeceTarih = s.split(/[ T]/)[0];

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(sadeceTarih);
  if (m) return gunOlustur(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(sadeceTarih);
  if (m) return gunOlustur(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(sadeceTarih);
  if (m) return gunOlustur(2000 + Number(m[3]), Number(m[2]), Number(m[1]));

  return null;
}

/** Saat dilimi kayması olmasın diye tarihler UTC gün başına sabitlenir. */
function gunOlustur(yil: number, ay: number, gun: number): Date | null {
  if (ay < 1 || ay > 12 || gun < 1 || gun > 31) return null;
  const t = new Date(Date.UTC(yil, ay - 1, gun));
  return Number.isNaN(t.getTime()) ? null : t;
}

function hucre(satir: string[], indis?: number | null): string {
  if (indis === undefined || indis === null || indis < 0) return "";
  return satir[indis] ?? "";
}

/* ─── Sütun eşlemesi tahmini ────────────────────────────────────────────── */

/** İpuçları da {@link basligiNormalle} ile aynı biçime indirgenmiş yazılır. */
const BASLIK_IPUCLARI: Record<keyof Omit<SutunEslemesi, "baslikSatiri">, string[]> = {
  tarih: ["tarih", "islem tarihi", "valor tarihi", "valor", "date"],
  aciklama: ["aciklama", "islem", "description", "detay"],
  tutar: ["tutar", "islem tutari", "amount", "miktar"],
  borc: ["borc", "cikan", "debit", "gider"],
  alacak: ["alacak", "giren", "credit", "gelir"],
  dekontNo: ["dekont", "dekont no", "fis", "referans", "reference", "islem no"],
  karsiIban: ["iban", "karsi iban", "hesap no"],
  karsiUnvan: ["unvan", "karsi unvan", "gonderen", "alici", "karsi taraf", "ad soyad"],
  bakiye: ["bakiye", "balance", "kalan"],
};

/**
 * Metni karşılaştırılabilir biçime indirger: küçük harf + Türkçe harfler ASCII.
 *
 * İki yerde gerekli:
 * 1. **Başlık tahmininde** — `"IBAN".toLocaleLowerCase("tr")` noktasız `"ıban"`
 *    üretiyor, "iban" ipucu tutmuyordu.
 * 2. **Cari unvanı eşleştirmesinde** — bankalar açıklamayı aksansız yazıyor
 *    ("TEDARIK MALZEME AS"), kayıtlı unvan ise aksanlı ("Tedarik Malzeme AŞ").
 */
export function metniNormalle(ham: string): string {
  return ham
    .toLowerCase()
    .replace(/i̇/g, "i")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Başlık satırındaki metinlerden sütunları tahmin eder — kullanıcı onay
 * ekranında düzeltebilir. Hiçbir şey bulunamazsa alanlar null döner.
 */
export function eslemeTahminEt(basliklar: string[]): SutunEslemesi {
  const normal = basliklar.map(metniNormalle);

  const bul = (ipuclari: string[]): number | null => {
    // Önce birebir eşleşme, sonra "içeriyor" — "tutar" ararken "bakiye tutarı"
    // sütununa yapışmasın diye.
    for (const ipucu of ipuclari) {
      const i = normal.indexOf(ipucu);
      if (i >= 0) return i;
    }
    for (const ipucu of ipuclari) {
      const i = normal.findIndex((b) => b.includes(ipucu));
      if (i >= 0) return i;
    }
    return null;
  };

  const borc = bul(BASLIK_IPUCLARI.borc);
  const alacak = bul(BASLIK_IPUCLARI.alacak);
  // Borç/alacak ikilisi varsa tek tutar sütunu aranmaz.
  const tutar = borc !== null && alacak !== null ? null : bul(BASLIK_IPUCLARI.tutar);

  return {
    baslikSatiri: 0,
    tarih: bul(BASLIK_IPUCLARI.tarih) ?? 0,
    aciklama: bul(BASLIK_IPUCLARI.aciklama) ?? 1,
    tutar,
    borc,
    alacak,
    dekontNo: bul(BASLIK_IPUCLARI.dekontNo),
    karsiIban: bul(BASLIK_IPUCLARI.karsiIban),
    karsiUnvan: bul(BASLIK_IPUCLARI.karsiUnvan),
    bakiye: bul(BASLIK_IPUCLARI.bakiye),
  };
}

/* ─── Satırlara çevirme ─────────────────────────────────────────────────── */

/**
 * Eşlemeye göre veri satırlarını okur. Tarihi ya da tutarı çözülemeyen satırlar
 * **sessizce atlanır** — ekstre dosyalarının başında/sonunda "Hesap Özeti",
 * "Toplam" gibi veri olmayan satırlar bulunur.
 */
export function ekstreSatirlariOku(
  tablo: string[][],
  esleme: SutunEslemesi,
): { satirlar: EkstreSatiri[]; atlanan: number } {
  const veri = tablo.slice(esleme.baslikSatiri + 1);
  const satirlar: EkstreSatiri[] = [];
  let atlanan = 0;

  /** Aynı gün/tutar/açıklamalı gerçek tekrarlar ezilmesin diye sayaç. */
  const ozetSayaci = new Map<string, number>();

  for (const ham of veri) {
    const tarih = tarihCoz(hucre(ham, esleme.tarih));
    if (!tarih) {
      atlanan++;
      continue;
    }

    let tutar: number | null = null;
    if (esleme.tutar !== undefined && esleme.tutar !== null) {
      tutar = tutarCoz(hucre(ham, esleme.tutar));
    } else {
      const borc = tutarCoz(hucre(ham, esleme.borc)) ?? 0;
      const alacak = tutarCoz(hucre(ham, esleme.alacak)) ?? 0;
      // Borç sütunu eksi yazılmış olabilir; mutlak değer alınıp yön kurulur.
      tutar = Math.abs(alacak) - Math.abs(borc);
    }
    if (tutar === null || tutar === 0) {
      atlanan++;
      continue;
    }

    const aciklama = hucre(ham, esleme.aciklama).slice(0, 500);
    const dekontNo = hucre(ham, esleme.dekontNo).slice(0, 100) || undefined;

    const temelOzet = createHash("sha256")
      .update(
        [tarih.toISOString().slice(0, 10), tutar.toFixed(2), aciklama, dekontNo ?? ""].join("|"),
      )
      .digest("hex")
      .slice(0, 32);
    const tekrar = (ozetSayaci.get(temelOzet) ?? 0) + 1;
    ozetSayaci.set(temelOzet, tekrar);

    satirlar.push({
      tarih,
      tutar,
      aciklama,
      dekontNo,
      karsiIban: hucre(ham, esleme.karsiIban).replace(/\s/g, "").slice(0, 34) || undefined,
      karsiUnvan: hucre(ham, esleme.karsiUnvan).slice(0, 255) || undefined,
      bakiye: tutarCoz(hucre(ham, esleme.bakiye)) ?? undefined,
      satirOzeti: `${temelOzet}#${tekrar}`,
    });
  }

  return { satirlar, atlanan };
}
