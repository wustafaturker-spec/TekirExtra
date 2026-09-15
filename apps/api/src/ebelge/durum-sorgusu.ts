/**
 * Durumu entegratöre sorulmayan, son durum sayılan e-Belge durumları (EBLG-14).
 * İptal de son durumdur: sorgu iptal edilmiş belgeyi "iletildi"ye geri
 * çevirmemeli (EBLG-39).
 */
export const SON_EBELGE_DURUMLARI: readonly string[] = ["kabul", "ret", "hata", "iptal"];

/**
 * Faturanın durum sorgusu neden açılamaz (EBLG-38); açılabiliyorsa null.
 *
 * Bu engeller geçicidir değil kalıcıdır: işi kuyruğa alıp yeniden denemek
 * aynı sonuca varır, 5 denemeden sonra dead-letter'a düşer ve o faturanın
 * sonraki sorgularını engellerdi. Bu yüzden istek anında kullanıcıya söylenir.
 */
export function durumSorgusuEngeli(kayit: { durum: string; entegratorRef: string | null } | null): string | null {
  if (!kayit) return "Faturaya ait e-belge kaydı bulunamadı";
  if (!kayit.entegratorRef) return "Gönderimi yapılmamış belgenin durumu sorgulanamaz";
  if (SON_EBELGE_DURUMLARI.includes(kayit.durum)) return "Belge son durumuna ulaşmış, durumu yeniden sorgulanmaz";
  return null;
}
