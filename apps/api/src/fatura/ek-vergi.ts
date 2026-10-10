/**
 * EBLG-120: fatura satırının KDV dışı vergileri. Girdide yalnız kod ve tutar
 * gelir; ad, stopaj ve KDV matrahı kuralı belge tarihindeki merkezi vergi
 * türü kaydından türer (istemcinin gönderdiği davranışa güvenilmez).
 */
import { vergiTuruBul, type VergiTuru } from "@tekirextra/shared";

export interface EkVergiGirdisi { kod: string; oran?: string | null; matrah?: string | null; tutar: string }
export interface EkVergi { kod: string; ad: string; oran: string | null; matrah: string | null; tutar: string; stopaj: boolean; kdvMatrahinaDahil: boolean }

/** Satır başına çözülmüş vergiler ve hatalar. Ek vergi yalnız alış faturasında taşınır. */
export function ekVergileriCoz(tip: string, satirlar: { ekVergiler?: EkVergiGirdisi[] | null }[], turler: readonly VergiTuru[]): { satirlar: EkVergi[][]; hatalar: string[] } {
  const hatalar: string[] = [];
  const sonuc = satirlar.map((s, i) => (s.ekVergiler ?? []).flatMap((v) => {
    const tur = vergiTuruBul(v.kod, turler);
    if (!tur) { hatalar.push(`${i + 1}. satırdaki ${v.kod} vergi türü kodu belge tarihinde tanımlı değil`); return []; }
    return [{ kod: tur.kod, ad: tur.ad, oran: v.oran ?? null, matrah: v.matrah ?? null, tutar: Number(v.tutar).toFixed(2), stopaj: tur.stopaj, kdvMatrahinaDahil: tur.kdvMatrahinaDahil }];
  }));
  if (tip !== "alis" && sonuc.some((l) => l.length)) hatalar.push("KDV dışı vergiler (ÖTV, ÖİV, stopaj…) yalnız alış faturasında taşınır");
  return { satirlar: sonuc, hatalar };
}

/** Saklı JSON → girdi biçimi (taslak yeniden hesaplanırken). */
export function sakliEkVergiler(json: unknown): EkVergiGirdisi[] {
  return Array.isArray(json) ? (json as EkVergi[]).map((v) => ({ kod: v.kod, oran: v.oran, matrah: v.matrah, tutar: v.tutar })) : [];
}
