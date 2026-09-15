import type { BildirimGirdisi } from "../bildirimler/bildirim.service";

export const ENTEGRATOR_IPTAL_ANAHTAR_ONEKI = "earsiv-entegrator-iptal:";

/**
 * e-Arşiv belgesi entegratörde (ör. portaldan) iptal edilmiş ama fatura
 * uygulamada hâlâ kesin (EBLG-39). Durum sorgusu bildirimi hemen üretir; tarama
 * aynı durumdan aynısını türetir ve fatura iptal edilince kapatır. Metin iki
 * yerde aynı olmalı, yoksa her tarama bildirimi yeniden yazar.
 */
export function entegratorIptalBildirimi(faturaId: string, faturaNo: string | null): BildirimGirdisi {
  return {
    tur: "ebelge",
    onem: "uyari",
    baslik: `${faturaNo ?? "e-Arşiv faturası"} entegratörde iptal edilmiş`,
    aciklama: "e-Arşiv belgesi entegratör tarafında (ör. portaldan) iptal edildi ama fatura uygulamada hâlâ kesin. Faturayı iptal ederek stok ve cari hareketlerini geri alın.",
    birlesimAnahtari: `${ENTEGRATOR_IPTAL_ANAHTAR_ONEKI}${faturaId}`,
    kaynakTur: "fatura",
    kaynakRef: faturaId,
    hedefYol: `/panel/fatura?fatura=${faturaId}`,
    roller: ["muhasebe", "yonetici"],
  };
}
