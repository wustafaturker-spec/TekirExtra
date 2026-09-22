/**
 * `datetime-local` alanı yerel saatle çalışır, sunucuya ise ISO gider.
 * Dönüşümü iki ekran birden yapıyor (taşıma bilgisi paneli ve e-Belge
 * sihirbazı), bu yüzden kural tek yerde durur. Saniye ve salise alana hiç
 * yazılmaz: tarayıcı saniyeli değeri kabul etse de kullanıcıya gereksiz
 * hassasiyet gösterir (EBLG-49'daki saniye tuzağı).
 */
const ikiHane = (sayi: number) => String(sayi).padStart(2, "0");

/** ISO zaman damgasını alanın beklediği yerel metne çevirir. */
export function zamanAlaniDegeri(iso: string | null | undefined): string {
  if (!iso) return "";
  return zamanAlaniMetni(new Date(iso));
}

/** Tarayıcının yerel saatiyle `YYYY-MM-DDTHH:mm`. */
export function zamanAlaniMetni(an: Date): string {
  if (Number.isNaN(an.getTime())) return "";
  return `${an.getFullYear()}-${ikiHane(an.getMonth() + 1)}-${ikiHane(an.getDate())}T${ikiHane(an.getHours())}:${ikiHane(an.getMinutes())}`;
}

/** Alandaki yerel metni sunucuya gidecek ISO damgasına çevirir. */
export function zamanAlaniIso(deger: string): string | null {
  if (!deger) return null;
  const an = new Date(deger);
  return Number.isNaN(an.getTime()) ? null : an.toISOString();
}
