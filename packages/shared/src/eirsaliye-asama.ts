/**
 * EBLG-106: `kuyrukta` duran e-İrsaliyenin entegratördeki gerçek aşaması.
 *
 * Programın durum ekseni kaba tutulur (kuyrukta → iletildi → kabul/ret); NES
 * ise `outgoingStatus` ile 16 ayrı aşama bildirir. Aralarındaki fark kullanıcı
 * için önemlidir: taslakta kalan belge kendiliğinden ilerlemez, GİB'de bekleyen
 * belge ilerler. Ham ad kayıtta saklanır, anlamı burada verilir.
 *
 * `Waiting`: NES belgeyi aldı ama resmîleştirmedi. 2026-09-27'de TEKİREXTRA2'de
 * görüldü — gönderilen alıcı etiketini NES kabul etmeyince belge etiketsiz
 * taslağa düştü; etiket verilip taslak gönderilince ilerler.
 */
export type EirsaliyeAsamasi = "taslak" | "entegratorde" | "gibde";

const ASAMALAR: Record<string, EirsaliyeAsamasi> = {
  Waiting: "taslak",
  WaitingToBeSigned: "entegratorde",
  WaitingToBeEnvelopeCreate: "entegratorde",
  WaitingToBeSend: "entegratorde",
  EnvelopeIsWaitingToBeProcessedByGib: "gibde",
  EnvelopeIsWaitingToBeSendedToReceiverByGib: "gibde",
  EnvelopeIsBeenWaitingToBeTransferredToReceiverByGib: "gibde",
};

const ACIKLAMALAR: Record<EirsaliyeAsamasi, string> = {
  taslak: "Entegratörde taslak olarak bekliyor: alıcı etiketi kabul edilmedi. Etiketi seçip gönderin; belge kendiliğinden ilerlemez.",
  entegratorde: "Entegratörde imzalanıp GİB'e gönderilmeyi bekliyor.",
  gibde: "GİB'e ulaştı; alıcıya iletilmesi bekleniyor.",
};

export function eirsaliyeAsamasi(hamDurum: string | null | undefined): EirsaliyeAsamasi | null {
  return (hamDurum && ASAMALAR[hamDurum]) || null;
}

export function eirsaliyeAsamaAciklamasi(hamDurum: string | null | undefined): string | null {
  const asama = eirsaliyeAsamasi(hamDurum);
  return asama ? ACIKLAMALAR[asama] : null;
}
