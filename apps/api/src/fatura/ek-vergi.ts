/**
 * EBLG-120/126: fatura satırının KDV dışı vergileri. Girdide kod ile tutar
 * (gelen belge) ya da hesap türü ile oran/birim tutar (karttan gelen) bulunur;
 * ad, stopaj ve KDV matrahı kuralı belge tarihindeki merkezi vergi türü
 * kaydından türer (istemcinin gönderdiği davranışa güvenilmez).
 */
import type { Prisma } from "@prisma/client";
import { vergiTuruBul, type EkVergiHesapGirdisi, type VergiTuru } from "@tekirextra/shared";

export interface EkVergiGirdisi { kod: string; hesap?: "oran" | "birim" | null; oran?: string | null; birimTutar?: string | null; matrah?: string | null; tutar?: string | null }
export interface EkVergi {
  kod: string; ad: string; hesap: "oran" | "birim" | null; oran: string | null; birimTutar: string | null; matrah: string | null; tutar: string; stopaj: boolean; kdvMatrahinaDahil: boolean;
  /**
   * EBLG-131: maktu vergide birim tutar kartın ana birimi başınadır; satır ek
   * birimle (koli) girildiyse katsayı (1 koli = 12 adet) ve ana birim burada
   * durur. Vergi = satır miktarı × katsayı × birim tutar; UBL'de miktar ana birimle.
   */
  anaBirim?: string | null;
  katsayi?: string | null;
}

/** Ek vergi taşıyabilen fatura tipleri; iade ve proforma kapsam dışı (EBLG-126). */
const EK_VERGI_TIPLERI = new Set(["alis", "satis"]);

/** Satır başına çözülmüş vergiler ve hatalar; tutar hesaplı vergide faturaHesapla sonrası yazılır. */
export function ekVergileriCoz(tip: string, satirlar: { ekVergiler?: EkVergiGirdisi[] | null }[], turler: readonly VergiTuru[]): { satirlar: EkVergi[][]; hatalar: string[] } {
  const hatalar: string[] = [];
  const sonuc = satirlar.map((s, i) => (s.ekVergiler ?? []).flatMap((v) => {
    const tur = vergiTuruBul(v.kod, turler);
    if (!tur) { hatalar.push(`${i + 1}. satırdaki ${v.kod} vergi türü kodu belge tarihinde tanımlı değil`); return []; }
    const hesap = v.hesap ?? null;
    return [{ kod: tur.kod, ad: tur.ad, hesap, oran: v.oran ?? null, birimTutar: hesap === "birim" ? v.birimTutar ?? null : null, matrah: v.matrah ?? null, tutar: Number(v.tutar ?? 0).toFixed(2), stopaj: tur.stopaj, kdvMatrahinaDahil: tur.kdvMatrahinaDahil }];
  }));
  if (!EK_VERGI_TIPLERI.has(tip) && sonuc.some((l) => l.length)) hatalar.push("KDV dışı vergiler (ÖTV, ÖİV, stopaj…) yalnız satış ve alış faturasında taşınır; iade ve proformada kullanılamaz");
  return { satirlar: sonuc, hatalar };
}

/** faturaHesapla girdisi: hesaplı vergide oran/birim tutar, belgedekinde tutar. */
export function hesapGirdisi(v: EkVergi): EkVergiHesapGirdisi {
  // EBLG-131: hesap satır miktarıyla yapılır; birim tutar satır birimine (koli) ölçeklenir.
  return { stopaj: v.stopaj, kdvMatrahinaDahil: v.kdvMatrahinaDahil, hesap: v.hesap, tutar: Number(v.tutar), oran: Number(v.oran ?? 0), birimTutar: Number(v.birimTutar ?? 0) * Number(v.katsayi ?? 1) };
}

/**
 * EBLG-131: maktu (birim başı) vergisi olan satırlara kartın ana birimini ve
 * satır biriminin katsayısını işler. Tanımsız ek birim 1 sayılmaz — birim
 * doğrulaması satır kaydında hata verir; burada yalnız bilinen katsayı yazılır.
 */
export async function maktuBirimleriniBagla(
  tx: Prisma.TransactionClient,
  satirlar: { stokId: string; birim?: string | null }[],
  vergiler: EkVergi[][],
): Promise<void> {
  const ilgili = satirlar.map((s, i) => ({ s, l: vergiler[i] ?? [] })).filter(({ l }) => l.some((v) => v.hesap === "birim"));
  if (!ilgili.length) return;
  const stokIdleri = [...new Set(ilgili.map(({ s }) => s.stokId))];
  const kartlar = await tx.stokKart.findMany({ where: { id: { in: stokIdleri } }, select: { id: true, anaBirim: true, birimler: { select: { ad: true, katsayi: true } } } });
  for (const { s, l } of ilgili) {
    const kart = kartlar.find((k) => k.id === s.stokId);
    if (!kart) continue;
    const birim = s.birim || kart.anaBirim;
    const katsayi = birim === kart.anaBirim ? null : kart.birimler.find((b) => b.ad === birim)?.katsayi;
    for (const v of l.filter((x) => x.hesap === "birim")) {
      v.anaBirim = kart.anaBirim;
      v.katsayi = katsayi ? katsayi.toString() : null;
    }
  }
}

/** Hesap sonrası saklanacak hâl: tutar hesaptan, oranlı verginin matrahı satır matrahı. */
export function saklanacakEkVergiler(vergiler: EkVergi[], satir: { matrah: number; ekVergiTutarlari: number[] }): EkVergi[] {
  return vergiler.map((v, i) => ({ ...v, tutar: satir.ekVergiTutarlari[i].toFixed(2), matrah: v.hesap === "oran" ? satir.matrah.toFixed(2) : v.matrah }));
}

/** Saklı JSON → girdi biçimi (taslak yeniden hesaplanırken). */
export function sakliEkVergiler(json: unknown): EkVergiGirdisi[] {
  return Array.isArray(json) ? (json as EkVergi[]).map((v) => ({ kod: v.kod, hesap: v.hesap ?? null, oran: v.oran, birimTutar: v.birimTutar ?? null, matrah: v.matrah, tutar: v.tutar })) : [];
}

/** EBLG-128: saklı vergilerden KDV matrahına dahil olanların toplamı (KDV matrahı = satır matrahı + bu). */
export function kdvMatrahinaDahilToplam(json: unknown): number {
  return Array.isArray(json)
    ? Math.round((json as EkVergi[]).filter((v) => !v.stopaj && v.kdvMatrahinaDahil).reduce((t, v) => t + Math.round(Number(v.tutar) * 100), 0)) / 100
    : 0;
}
