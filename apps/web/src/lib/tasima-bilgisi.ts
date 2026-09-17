/**
 * Taşıma bilgisinin e-İrsaliye gönderimine yetip yetmediği (EBLG-49).
 *
 * Kural sunucudaki `gonderimEngelleri` ile ("tasiyan_yok", EBLG-42) birebir
 * aynıdır: taşıyıcı cari seçilmişse taşıyan bellidir, seçilmemişse şoför adı,
 * soyadı ve plakanın üçü birden istenir. Ekran kuralı kendi cümlesiyle
 * yazsaydı "kaydettim ama yine gönderilmiyor" durumu doğardı.
 */
export interface TasimaBilgisi {
  tasiyiciCariId: string | null;
  soforAdi: string | null;
  soforSoyadi: string | null;
  plaka: string | null;
}

const dolu = (deger: string | null | undefined): boolean => Boolean(deger && deger.trim());

export function tasiyanBelli(bilgi: TasimaBilgisi): boolean {
  return dolu(bilgi.tasiyiciCariId) || (dolu(bilgi.soforAdi) && dolu(bilgi.soforSoyadi) && dolu(bilgi.plaka));
}

/** Kendi aracıyla gönderimde hangi alanların eksik kaldığı; taşıyıcı cari seçiliyse boş. */
export function eksikTasiyanAlanlari(bilgi: TasimaBilgisi): string[] {
  if (tasiyanBelli(bilgi)) return [];
  return [
    ...(dolu(bilgi.soforAdi) ? [] : ["şoför adı"]),
    ...(dolu(bilgi.soforSoyadi) ? [] : ["şoför soyadı"]),
    ...(dolu(bilgi.plaka) ? [] : ["plaka"]),
  ];
}
