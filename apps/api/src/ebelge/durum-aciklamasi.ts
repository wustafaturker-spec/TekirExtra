import type { BelgeDurumSonuc } from "@tekirextra/baglanti";

/**
 * Entegratörün durum açıklamasından neyin saklanacağına karar verir.
 *
 * `hataMesaji` ekranda uyarı kutusu olarak gösterilir. Sağlayıcı açıklamayı her
 * durumda döndürüyor ("1300 BASARIYLA TAMAMLANDI", "ZARF BAŞARIYLA İŞLENDİ");
 * olduğu gibi yazılınca başarılı belge de uyarıyla açılıyordu. Açıklama yalnız
 * dikkat gerektirdiğinde tutulur:
 * - hata → hata mesajı olarak;
 * - sağlayıcıda iptal edilmiş e-Arşiv belgesi → uyarı olarak, çünkü bizde hâlâ
 *   geçerli görünüyor;
 * - alıcı reddi → alıcının notu olarak. Gelen yanıt taramasından gelmiş not
 *   (EBLG-13) yanıt belgesinin kendisinden okunduğu için ezilmez.
 */
export function durumAciklamasi(
  sonuc: Pick<BelgeDurumSonuc, "durum" | "detay" | "iptalEdilmis">,
  mevcutAliciNotu?: string | null,
): { hataMesaji: string | null; aliciYanitNotu?: string } {
  const detay = sonuc.detay?.trim() || null;
  if (sonuc.durum === "hata" || sonuc.iptalEdilmis) return { hataMesaji: detay };
  if (sonuc.durum === "ret" && detay && !mevcutAliciNotu) return { hataMesaji: null, aliciYanitNotu: detay.slice(0, 500) };
  return { hataMesaji: null };
}
