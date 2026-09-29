/**
 * FTR-31: müşterinin talep (teklif isteği) ve sipariş (PO) referansları.
 * Talep teklifte, sipariş siparişte girilir; ikisi de zincir boyunca
 * irsaliye ve faturaya taşınır. e-Belgenin `OrderReference`'ına sipariş
 * numarası, yoksa talep numarası yazılır; ikisi de varsa talep bir notla
 * bildirilir. Sunucu, ekran ve UBL üreteci aynı kuralı buradan kullanır.
 */

export type ReferansTarihi = Date | string | null | undefined;

export interface MusteriReferanslari {
  siparisNo?: string | null;
  siparisTarihi?: ReferansTarihi;
  talepNo?: string | null;
  talepTarihi?: ReferansTarihi;
}

export interface BelgeReferansi {
  no: string;
  tarih: ReferansTarihi;
  kaynak: "siparis" | "talep";
}

function temiz(no: string | null | undefined): string | null {
  return no?.trim() || null;
}

/** `ana`dan farklı, tekrarsız dolu numaralar. */
function farkliNolar(nolar: (string | null)[], ana: string | null): string[] {
  return [...new Set(nolar.filter((n): n is string => Boolean(n) && n !== ana))];
}

/** GG.AA.YYYY; tarih kolonları UTC gün olarak tutulur. */
function gunBicimi(tarih: ReferansTarihi): string | null {
  if (!tarih) return null;
  const iso = typeof tarih === "string" ? tarih : tarih.toISOString();
  const [y, a, g] = iso.slice(0, 10).split("-");
  return `${g}.${a}.${y}`;
}

/** e-Belge `OrderReference`: müşteri sipariş numarası, yoksa talep numarası. */
export function siparisReferansi(b: MusteriReferanslari): BelgeReferansi | null {
  const siparis = temiz(b.siparisNo);
  if (siparis) return { no: siparis, tarih: b.siparisTarihi ?? null, kaynak: "siparis" };
  const talep = temiz(b.talepNo);
  if (talep) return { no: talep, tarih: b.talepTarihi ?? null, kaynak: "talep" };
  return null;
}

/**
 * Faturaya kopyalanacak referanslar (dönüştürme, toplu faturalama). Her tür
 * için ilk dolu belgeninki alınır; farklı numaralar `digerSiparisNolari` ve
 * `digerTalepNolari`'nda döner — GİB faturada tek `OrderReference` kabul eder,
 * diğerleri nota yazılır.
 */
export function birlesikReferanslar(belgeler: MusteriReferanslari[]) {
  const siparisKaynagi = belgeler.find((b) => temiz(b.siparisNo));
  const talepKaynagi = belgeler.find((b) => temiz(b.talepNo));
  const siparisNo = temiz(siparisKaynagi?.siparisNo);
  const talepNo = temiz(talepKaynagi?.talepNo);
  return {
    siparisNo,
    siparisTarihi: siparisKaynagi?.siparisTarihi ?? null,
    talepNo,
    talepTarihi: talepKaynagi?.talepTarihi ?? null,
    digerSiparisNolari: farkliNolar(belgeler.map((b) => temiz(b.siparisNo)), siparisNo),
    digerTalepNolari: farkliNolar(belgeler.map((b) => temiz(b.talepNo)), talepNo),
  };
}

/** Toplu faturalamada kullanıcıya gösterilecek uyarı; referanslar tekse null. */
export function referansFarkiUyarisi(belgeler: MusteriReferanslari[]): string | null {
  const r = birlesikReferanslar(belgeler);
  const parcalar: string[] = [];
  if (r.digerSiparisNolari.length) parcalar.push(`sipariş referansları farklı (${[r.siparisNo, ...r.digerSiparisNolari].join(", ")})`);
  if (r.digerTalepNolari.length) parcalar.push(`talep referansları farklı (${[r.talepNo, ...r.digerTalepNolari].join(", ")})`);
  if (!parcalar.length) return null;
  return `Seçilen belgelerin ${parcalar.join(" ve ")}. Faturaya ilk belgeninki yazılır, diğerleri e-Belgede not olarak gider.`;
}

/**
 * e-Belgeye yazılacak referans notları. `OrderReference`'a girmeyen talep
 * referansı ile faturaya bağlı diğer belgelerin farklı referansları.
 */
export function referansNotlari(fatura: MusteriReferanslari, bagliBelgeler: MusteriReferanslari[] = []): string[] {
  const notlar: string[] = [];
  const talep = temiz(fatura.talepNo);
  if (temiz(fatura.siparisNo) && talep) {
    const tarih = gunBicimi(fatura.talepTarihi);
    notlar.push(`Müşteri talep ref.: ${talep}${tarih ? ` (${tarih})` : ""}`);
  }
  // Faturadaki numara elle silinmiş ya da değiştirilmişse bağlı belgelerin
  // numaralarının hepsi "diğer" sayılır; kıyas faturanın kendi değeriyledir.
  const digerSiparis = farkliNolar(bagliBelgeler.map((b) => temiz(b.siparisNo)), temiz(fatura.siparisNo));
  const digerTalep = farkliNolar(bagliBelgeler.map((b) => temiz(b.talepNo)), talep);
  if (digerSiparis.length) notlar.push(`Diğer sipariş ref.: ${digerSiparis.join(", ")}`);
  if (digerTalep.length) notlar.push(`Diğer talep ref.: ${digerTalep.join(", ")}`);
  return notlar;
}
