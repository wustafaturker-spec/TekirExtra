/**
 * KSB-34: internet şubesinden indirilen metin katmanlı PDF ekstreyi tabloya çevirir.
 *
 * PDF'te tablo yoktur, yalnız sayfaya konumlanmış yazılar vardır. Yazılar
 * yüksekliklerine göre satırlara, satır içinde aralıklarına göre parçalara
 * toplanır; sütunlar başlık satırındaki ("Tarih", "Açıklama", "Tutar",
 * "Bakiye"…) parçaların konumlarından kurulur. Çıkan tablo CSV/Excel ile aynı
 * eşleme adımına gider ({@link ekstreSatirlariOku}); OCR yapılmaz.
 */
import { EkstreOkumaHatasi, metniNormalle, tarihCoz, type EkstreSatiri } from "./ekstre-oku";

export const PDF_EN_FAZLA_SAYFA = 200;

export class PdfEkstreHatasi extends EkstreOkumaHatasi {}

export interface PdfEkstre {
  /** İlk satır başlık; sonrakiler veri satırları (devam satırları birleştirilmiş). */
  tablo: string[][];
  sayfaSayisi: number;
  /** Tablo başlığından önceki alanda (hesap bilgileri) geçen TR IBAN'lar. */
  ustIbanlar: string[];
  /** Dosyanın herhangi bir yerinde geçen TR IBAN'lar. */
  tumIbanlar: string[];
}

export interface Parca { x0: number; x1: number; metin: string }
export interface Satir { sayfa: number; ust: number; yukseklik: number; parcalar: Parca[] }
interface Sutun { x0: number; x1: number; baslik: string; sayisal: boolean }

const TUTAR_SONU = /\d[.,]\d{2}\)?(?:\s?(?:TL|TRY|USD|EUR|₺))?\s*$/;
const TUTAR = /^[-−+(]?\s*\d[\d.,\s]*[.,]\d{2}\)?(?:\s?(?:TL|TRY|USD|EUR|₺))?$/;
const TUTAR_BASI = /^\s*[-−+(]?\d/;

export function pdfMi(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).toString("latin1").includes("%PDF-");
}

const IBAN = /TR\d{2}(?:\s?\d{4}){5}\s?\d{2}/g;
const ibanlariBul = (metin: string) => [...new Set((metin.toUpperCase().match(IBAN) ?? []).map((i) => i.replace(/\s/g, "")))];

/** Başlıkta en az tarih + bir tutar sütunu aranır; "Devreden" gibi satırlar başlık sayılmasın. */
const TARIH_IPUCU = ["tarih", "valor", "date"];
const TUTAR_IPUCU = ["tutar", "borc", "alacak", "bakiye", "amount", "balance", "debit", "credit"];
const SAYISAL_IPUCU = [...TUTAR_IPUCU, "miktar", "kalan"];

function baslikMi(parcalar: Parca[]): boolean {
  if (parcalar.length < 3) return false;
  const p = parcalar.map((x) => metniNormalle(x.metin));
  // Başlık parçaları kısa etikettir; uzun açıklama satırı başlığa benzemesin.
  if (p.some((x) => x.length > 40)) return false;
  return p.some((x) => TARIH_IPUCU.some((i) => x.includes(i))) && p.some((x) => TUTAR_IPUCU.some((i) => x.includes(i)));
}

/** Başlık bandına girebilecek satır: kısa etiketler, tarih ya da tutar yok. */
const etiketSatiri = (s: Satir) => s.parcalar.every((p) => p.metin.length <= 25 && tarihCoz(p.metin) === null && !TUTAR.test(p.metin));

/**
 * Başlık satırını bulur. Bazı bankalar başlığı iki-üç satıra böler ("İşlem /
 * Tarihi"); birbirine yazı yüksekliğinden yakın etiket satırları bir bant
 * sayılır, yatayda örtüşen parçalar üstten alta birleştirilir.
 */
function baslikBul(satirlar: Satir[]): { bant: number[]; parcalar: Parca[] } | null {
  for (let i = 0; i < satirlar.length; i++) {
    if (baslikMi(satirlar[i].parcalar)) return { bant: [i], parcalar: satirlar[i].parcalar };
    if (!etiketSatiri(satirlar[i])) continue;
    const bant = [i];
    for (let k = i + 1; k < satirlar.length; k++) {
      const onceki = satirlar[bant.at(-1)!];
      const s = satirlar[k];
      if (s.sayfa !== onceki.sayfa || s.ust - onceki.ust > 1.1 * Math.max(s.yukseklik, onceki.yukseklik) || !etiketSatiri(s)) break;
      bant.push(k);
    }
    if (bant.length < 2) continue;
    const kumeler: Parca[] = [];
    for (const k of bant) {
      for (const p of satirlar[k].parcalar) {
        const kume = kumeler.find((c) => p.x0 < c.x1 + 2 && p.x1 > c.x0 - 2);
        if (kume) { kume.metin += ` ${p.metin}`; kume.x0 = Math.min(kume.x0, p.x0); kume.x1 = Math.max(kume.x1, p.x1); }
        else kumeler.push({ ...p });
      }
    }
    kumeler.sort((a, b) => a.x0 - b.x0);
    if (baslikMi(kumeler)) return { bant, parcalar: kumeler };
  }
  return null;
}

/** pdf.js yazı öğelerini satır ve parçalara toplar. */
export async function pdfSatirlari(buffer: Buffer): Promise<{ satirlar: Satir[]; sayfaSayisi: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const yukleme = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Yazı tipi yüklenmez; konum ve metin için gerekmiyor. pdf.js 6 yazı tipinden kod üretmez (CVE-2024-4367 sınıfı).
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let belge: Awaited<typeof yukleme.promise>;
  try {
    belge = await yukleme.promise;
  } catch (hata) {
    if ((hata as { name?: string })?.name === "PasswordException") throw new PdfEkstreHatasi("PDF parolalı. Bankadan parolasız PDF ya da Excel ekstre indirin.");
    throw new PdfEkstreHatasi("PDF okunamadı. Dosya bozuk olabilir.");
  }
  try {
    if (belge.numPages > PDF_EN_FAZLA_SAYFA) throw new PdfEkstreHatasi(`PDF ${belge.numPages} sayfa; en çok ${PDF_EN_FAZLA_SAYFA} sayfalık ekstre yüklenebilir. Dönemi bölerek indirin.`);
    const satirlar: Satir[] = [];
    for (let no = 1; no <= belge.numPages; no++) {
      const sayfa = await belge.getPage(no);
      const yukseklik = sayfa.getViewport({ scale: 1 }).height;
      const icerik = await sayfa.getTextContent();
      const ogeler = icerik.items
        .filter((o): o is typeof o & { str: string; transform: number[]; width: number; height: number } => "str" in o && o.str.trim() !== "")
        .map((o) => ({ metin: o.str, x0: o.transform[4], x1: o.transform[4] + o.width, ust: yukseklik - o.transform[5], h: Math.abs(o.height) || Math.abs(o.transform[3]) || 8 }))
        .sort((a, b) => a.ust - b.ust || a.x0 - b.x0);
      sayfa.cleanup();

      const sayfaSatirlari: { ust: number; h: number; ogeler: typeof ogeler }[] = [];
      for (const o of ogeler) {
        const son = sayfaSatirlari.at(-1);
        if (son && Math.abs(o.ust - son.ust) <= Math.max(2, 0.5 * Math.min(o.h, son.h))) son.ogeler.push(o);
        else sayfaSatirlari.push({ ust: o.ust, h: o.h, ogeler: [o] });
      }
      for (const s of sayfaSatirlari) {
        s.ogeler.sort((a, b) => a.x0 - b.x0);
        const parcalar: Parca[] = [];
        for (const o of s.ogeler) {
          const son = parcalar.at(-1);
          const bosluk = son ? o.x0 - son.x1 : Infinity;
          // Kelime arası boşluk yazı yüksekliğinin yarısını geçmez; sütun arası daha geniştir.
          // Dar sütunlu düzende yan yana iki tutar ("15,96 −45.625,96") birleşmesin.
          const ikiTutar = son && bosluk > 0.15 * s.h && TUTAR_SONU.test(son.metin) && TUTAR_BASI.test(o.metin);
          if (son && !ikiTutar && bosluk < Math.max(3, 0.6 * s.h)) {
            son.metin += bosluk > 0.15 * s.h && !son.metin.endsWith(" ") ? ` ${o.metin}` : o.metin;
            son.x1 = Math.max(son.x1, o.x1);
          } else parcalar.push({ x0: o.x0, x1: o.x1, metin: o.metin });
        }
        for (const p of parcalar) p.metin = p.metin.replace(/\s+/g, " ").trim();
        satirlar.push({ sayfa: no, ust: s.ust, yukseklik: s.h, parcalar: parcalar.filter((p) => p.metin) });
      }
    }
    return { satirlar, sayfaSayisi: belge.numPages };
  } finally {
    await yukleme.destroy();
  }
}

/**
 * Parçayı sütununa verir. Tutarlar sağa yaslıdır ve başlıktan sağa taşar: sağ
 * kenarı bu başlığın solu ile sonraki başlığın solu arasında kalan sütuna
 * düşer. Yazı, başka satırlarda bir sütunun yazılarının başladığı sol kenarla
 * aynı yerden başlıyorsa o sütuna (devam satırındaki kısa açıklama başlığın
 * altına düşmeyebilir); değilse sütun aralığıyla en çok örtüştüğü sütuna
 * verilir. Aralık sınırı iki başlığın arasındaki boşluğun ortasıdır.
 */
/** Yazı sütunlarının aralığı: sınır iki başlığın arasındaki boşluğun ortası. */
const sutunSinirlari = (sutunlar: Sutun[]) => sutunlar.map((s, i) => [
  i === 0 ? -Infinity : (sutunlar[i - 1].x1 + s.x0) / 2,
  i === sutunlar.length - 1 ? Infinity : (s.x1 + sutunlar[i + 1].x0) / 2,
]);

function sutunlaraDagit(parcalar: Parca[], sutunlar: Sutun[], solKenarlar?: Map<number, number>): string[] {
  const sinirlar = sutunSinirlari(sutunlar);
  const hucreler = sutunlar.map(() => "");
  for (const p of parcalar) {
    let enIyi = 0;
    if (TUTAR.test(p.metin)) {
      const i = sutunlar.findIndex((s, k) => p.x1 > s.x0 && (k === sutunlar.length - 1 || p.x1 <= sutunlar[k + 1].x0 + 1));
      enIyi = Math.max(0, i);
    } else {
      const kenar = solKenarlar?.get(Math.round(p.x0));
      if (kenar !== undefined) enIyi = kenar;
      else {
        let enCok = -Infinity;
        sinirlar.forEach(([sol, sag], i) => {
          const ortusme = Math.min(p.x1, sag) - Math.max(p.x0, sol);
          if (ortusme > enCok) { enCok = ortusme; enIyi = i; }
        });
      }
    }
    hucreler[enIyi] = hucreler[enIyi] ? `${hucreler[enIyi]} ${p.metin}` : p.metin;
  }
  return hucreler;
}

/** "Devir", "Toplam" gibi satırlar harekete eklenmez, kendi satırı olarak kalır (eşlemede atlanır). */
const AYRI_SATIR = ["devir", "devreden", "toplam", "nakli yekun"];

/**
 * PDF'i tabloya çevirir. Bir hareket birden çok satıra yayılabilir: tarih
 * sütunu dolu satır hareketin çapasıdır, diğer satırlar bir çapaya eklenir.
 * Bankalar uzun açıklamayı çapanın altına (çoğu), üstüne (YKB) ya da çapayı
 * dikeyde ortalayıp iki yanına (Kuveyt Türk; tutar bile alt satırda) yazar.
 * Düzen dosyadan çıkarılır: ilk çapadan önce sahipsiz satır yoksa alta,
 * son çapadan sonra yoksa üste, ikisi de varsa en yakın çapaya eklenir.
 * Tekrar eden başlık atılır; "Devreden"/"Toplam" satırları, sayfa başı/sonu
 * yazıları ayrı satır kalır ve eşleme adımında tarih/tutar kuralıyla atlanır.
 */
export async function pdfEkstreOku(buffer: Buffer): Promise<PdfEkstre> {
  const { satirlar, sayfaSayisi } = await pdfSatirlari(buffer);
  const harf = satirlar.reduce((t, s) => t + s.parcalar.reduce((u, p) => u + p.metin.length, 0), 0);
  if (harf < 20) throw new PdfEkstreHatasi("PDF'te okunabilir yazı yok (taranmış belge olabilir). Bankadan dijital PDF ya da Excel ekstre indirin.");

  const baslik = baslikBul(satirlar);
  if (!baslik) throw new PdfEkstreHatasi("PDF'te ekstre tablosunun başlık satırı (Tarih, Açıklama, Tutar/Bakiye…) bulunamadı.");
  const sutunlar: Sutun[] = baslik.parcalar.map((p) => {
    const n = metniNormalle(p.metin);
    return { x0: p.x0, x1: p.x1, baslik: p.metin, sayisal: SAYISAL_IPUCU.some((i) => n.includes(i)) && !TARIH_IPUCU.some((i) => n.includes(i)) };
  });
  const tarihSutunu = sutunlar.findIndex((s) => TARIH_IPUCU.some((i) => metniNormalle(s.baslik).includes(i)));
  const satirMetni = (s: Satir) => metniNormalle(s.parcalar.map((p) => p.metin).join("|"));
  const bantMetinleri = new Set(baslik.bant.map((i) => satirMetni(satirlar[i])));
  const ilkBaslik = satirlar[baslik.bant[0]];
  const sonBant = baslik.bant.at(-1)!;

  const tumMetin = satirlar.map((s) => s.parcalar.map((p) => p.metin).join(" ")).join("\n");
  const ustMetin = satirlar.filter((s, i) => i < baslik.bant[0] || (s.sayfa > ilkBaslik.sayfa && s.ust < ilkBaslik.ust)).map((s) => s.parcalar.map((p) => p.metin).join(" ")).join("\n");

  // Sonraki sayfalarda tekrar eden başlık satırları atılır.
  const veri = satirlar.slice(sonBant + 1).filter((s) => !bantMetinleri.has(satirMetni(s)));
  const tarihli = (s: Satir) => tarihSutunu >= 0 && tarihCoz(sutunlaraDagit(s.parcalar, sutunlar)[tarihSutunu]) !== null;
  const capalar = veri.filter(tarihli);

  // Her sütunun yazılarının başladığı sol kenarlar; yalnız çoğu sütun aralığına giren yazılardan öğrenilir.
  const sinirlar = sutunSinirlari(sutunlar);
  const kenarSayaci = new Map<number, Map<number, number>>();
  for (const s of veri) {
    for (const p of s.parcalar) {
      if (TUTAR.test(p.metin) || p.x1 - p.x0 < 1) continue;
      const i = sinirlar.findIndex(([sol, sag]) => (Math.min(p.x1, sag) - Math.max(p.x0, sol)) / (p.x1 - p.x0) > 0.5);
      if (i < 0) continue;
      const x = Math.round(p.x0);
      // Uzun yazı sütununu kısa yazıdan daha kesin gösterir; oy genişlikle ağırlıklandırılır.
      const m = kenarSayaci.get(x) ?? new Map<number, number>();
      m.set(i, (m.get(i) ?? 0) + (p.x1 - p.x0));
      m.set(-1, (m.get(-1) ?? 0) + 1);
      kenarSayaci.set(x, m);
    }
  }
  const solKenarlar = new Map<number, number>();
  for (const [x, m] of kenarSayaci) {
    const adet = m.get(-1) ?? 0;
    const [[sutun]] = [...m].filter(([i]) => i >= 0).sort((a, b) => b[1] - a[1]);
    // Tek seferlik konum kural sayılmaz; komşu piksellere de uygulanır (yuvarlama farkı).
    if (adet >= 2) for (const d of [-1, 0, 1]) if (!solKenarlar.has(x + d)) solKenarlar.set(x + d, sutun);
  }

  type Kalem = { satir: Satir; hucreler: string[]; capa: boolean; ekler: Satir[] };
  const kalemler: Kalem[] = veri.map((s) => ({ satir: s, hucreler: sutunlaraDagit(s.parcalar, sutunlar, solKenarlar), capa: capalar.includes(s), ekler: [] }));
  // Devam satırı tarih sütununa yazı koymaz; koyan satır sayfa altı/üstü yazısıdır ("T. Garanti Bankası A.Ş. … 1/2").
  const ayri = (k: Kalem) => (tarihSutunu >= 0 && k.hucreler[tarihSutunu] !== "") || AYRI_SATIR.some((a) => metniNormalle(k.hucreler.filter((_, i) => !sutunlar[i].sayisal).join(" ")).startsWith(a));
  const uzaklik = (a: Satir, b: Satir) => (a.sayfa === b.sayfa ? Math.abs(a.ust - b.ust) : Infinity);
  // Açıklama çapadan en çok birkaç satır uzağa taşar; sayfa altı yazıları çok daha uzaktadır.
  const ulasir = (a: Satir, b: Satir) => uzaklik(a, b) <= 6 * Math.max(a.yukseklik, b.yukseklik);
  const komsular = kalemler.map((k, i) => {
    if (k.capa || ayri(k)) return null;
    let ust: Kalem | null = null;
    let alt: Kalem | null = null;
    for (let j = i - 1; j >= 0 && !ust; j--) if (kalemler[j].capa) ust = kalemler[j];
    for (let j = i + 1; j < kalemler.length && !alt; j++) if (kalemler[j].capa) alt = kalemler[j];
    return { ust: ust && ulasir(ust.satir, k.satir) ? ust : null, alt: alt && ulasir(alt.satir, k.satir) ? alt : null };
  });
  // Düzen yalnız tablonun uçlarından okunur: sayfanın ilk çapasından önceki ya da son çapasından sonraki satır.
  const ustsuz = komsular.filter((k) => k && !k.ust && k.alt).length;
  const altsiz = komsular.filter((k) => k && k.ust && !k.alt).length;
  const duzen: "alt" | "ust" | "yakin" = ustsuz === 0 ? "alt" : altsiz === 0 ? "ust" : "yakin";

  const sahipsiz: Kalem[] = [];
  kalemler.forEach((k, i) => {
    const n = komsular[i];
    if (!n) { if (!k.capa) sahipsiz.push(k); return; }
    const hedef = duzen === "alt" ? n.ust ?? n.alt
      : duzen === "ust" ? n.alt ?? n.ust
      : n.ust && n.alt ? (uzaklik(n.ust.satir, k.satir) <= uzaklik(n.alt.satir, k.satir) ? n.ust : n.alt) : n.ust ?? n.alt;
    if (hedef) hedef.ekler.push(k.satir); else sahipsiz.push(k);
  });

  const satirlarSirali = [...kalemler.filter((k) => k.capa), ...sahipsiz].sort((a, b) => a.satir.sayfa - b.satir.sayfa || a.satir.ust - b.satir.ust);
  const tablo: string[][] = [sutunlar.map((s) => s.baslik)];
  for (const k of satirlarSirali) {
    if (!k.capa || !k.ekler.length) { tablo.push(k.hucreler); continue; }
    const grup = [k.satir, ...k.ekler].sort((a, b) => a.ust - b.ust);
    const hucreler = sutunlar.map(() => "");
    for (const s of grup) {
      const h = s === k.satir ? k.hucreler : sutunlaraDagit(s.parcalar, sutunlar, solKenarlar);
      h.forEach((m, i) => { if (m) hucreler[i] = hucreler[i] ? `${hucreler[i]} ${m}` : m; });
    }
    tablo.push(hucreler);
  }
  return { tablo, sayfaSayisi, ustIbanlar: ibanlariBul(ustMetin), tumIbanlar: ibanlariBul(tumMetin) };
}

export interface BakiyeTutarsizligi { tarih: string; tutar: string; bakiye: string; beklenen: string; aciklama: string }

/**
 * Bakiye sütunu okunduysa her satırda önceki bakiye + tutar = bakiye olmalı.
 * Bankalar eskiden yeniye ya da yeniden eskiye sıralar; iki yön denenir,
 * daha az tutarsızlık veren kullanılır. Tutmayan satır olası yanlış okumadır.
 */
export function bakiyeSaglamasi(satirlar: EkstreSatiri[]): { denetlenen: number; tutarsizlar: BakiyeTutarsizligi[] } {
  const bakiyeli = satirlar.filter((s) => s.bakiye !== undefined);
  if (bakiyeli.length < 2) return { denetlenen: 0, tutarsizlar: [] };
  const kurus = (n: number) => Math.round(n * 100);
  const yon = (sira: EkstreSatiri[]) => {
    const hatalar: BakiyeTutarsizligi[] = [];
    for (let i = 1; i < sira.length; i++) {
      const beklenen = kurus(sira[i - 1].bakiye!) + kurus(sira[i].tutar);
      if (beklenen !== kurus(sira[i].bakiye!)) {
        hatalar.push({ tarih: sira[i].tarih.toISOString().slice(0, 10), tutar: sira[i].tutar.toFixed(2), bakiye: sira[i].bakiye!.toFixed(2), beklenen: (beklenen / 100).toFixed(2), aciklama: sira[i].aciklama.slice(0, 120) });
      }
    }
    return hatalar;
  };
  const ileri = yon(bakiyeli);
  const geri = yon([...bakiyeli].reverse());
  return { denetlenen: bakiyeli.length - 1, tutarsizlar: geri.length < ileri.length ? geri : ileri };
}
