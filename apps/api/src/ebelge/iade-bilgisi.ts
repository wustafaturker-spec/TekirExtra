import { type IadeEngeli, iadeEngelleri } from "@tekirextra/shared";

/**
 * İade faturasının referans bilgisini tek yerde çözer (EBLG-58). Sihirbaz
 * önizlemesi ile gönderim aynı işlevi çağırır; iki taraf "bu belge iade mi,
 * eksiği var mı" sorusunu ayrı yanıtlamasın.
 *
 * Karar (2026-09-19): e-belge olarak gönderilen iade **alış iadesidir** — malı
 * tedarikçiye geri gönderen biz olduğumuz için iade faturasını biz keseriz.
 * Satış iadesinin faturasını müşteri keser, bize gelen belgedir.
 */

/** e-Belge olarak kesilebilen fatura tipleri. */
export const EBELGE_GONDERILEBILIR_TIPLER = ["satis", "alis_iade"] as const;

export const ebelgeGonderilebilirTipMi = (tip: string): boolean =>
  (EBELGE_GONDERILEBILIR_TIPLER as readonly string[]).includes(tip);

export interface IadeFaturaGirdisi {
  tip: string;
  tarih: Date;
  iadeReferanslari: { sira: number; belgeNo: string; tarih: Date; kaynakFaturaId: string | null }[];
}

export interface IadeOzeti {
  iade: boolean;
  referanslar: { belgeNo: string; tarih: Date; kaynakFaturaId: string | null }[];
  engeller: IadeEngeli[];
}

export function iadeOzeti(fatura: IadeFaturaGirdisi): IadeOzeti {
  if (fatura.tip !== "alis_iade") return { iade: false, referanslar: [], engeller: [] };
  const referanslar = [...fatura.iadeReferanslari]
    .sort((a, b) => a.sira - b.sira)
    .map(({ belgeNo, tarih, kaynakFaturaId }) => ({ belgeNo, tarih, kaynakFaturaId }));
  return { iade: true, referanslar, engeller: iadeEngelleri(referanslar, fatura.tarih) };
}
