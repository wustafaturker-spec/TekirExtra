/**
 * Zamanlayıcıların bağlamda kullandığı sabit sistem kimliği (kullanıcı
 * tablosunda yoktur; denetim izinde "sistem" olarak görünür).
 *
 * AI-96 (birleşik plan P-01): sistem kimliği yalnız belirli bir kullanıcının
 * adına OLMAYAN işlerde kullanılır. Kullanıcı adına çalışan arka plan işi
 * `kullaniciAdinaCalistir` (core/kullanici-baglami.ts) ile o kullanıcının
 * güncel yetkisinde çalışır. Her kullanım aşağıda sınıflandırılmıştır;
 * `sistem-kimligi.test.ts` yeni ve sınıflandırılmamış kullanımda kırılır.
 *
 *  - sistem_bakimi: kullanıcı verisini kullanıcı adına değiştirmez (bildirim,
 *    tarama, telemetri, endeks, platform faturası, sağlayıcı dönüşü).
 *  - firma_otomasyonu: firmanın açtığı bir ayar/entegrasyonla çalışır, kayıt
 *    üretir ama belirli bir kullanıcıya ait değildir (tekrarlayan fatura
 *    planında sahip alanı yoktur). Dar yetkili "otomasyon kimliği" D3'te
 *    (P-19) ele alınır.
 */
export const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

export type SistemKimligiSinifi = "sistem_bakimi" | "firma_otomasyonu";

export const SISTEM_KIMLIGI_KULLANIMLARI: Record<string, { sinif: SistemKimligiSinifi; is: string }> = {
  "abonelik-odeme/abonelik-fatura.service.ts": { sinif: "sistem_bakimi", is: "Platformun firmaya abonelik faturası kesmesi (platform firması bağlamı)" },
  "ai/ayarlar/ai-telemetri-bakim.service.ts": { sinif: "sistem_bakimi", is: "AI çağrı izi ve geçmiş saklama süresi temizliği" },
  "ai/teklif-talebi/teklif-talebi.service.ts": { sinif: "sistem_bakimi", is: "Bekleyen cari onaylarını izleme (devam talep sahibinin bağlamında, AI-95) ve tekliften öğrenme" },
  "belgeler/teklif-takibi/teklif-takip.service.ts": { sinif: "sistem_bakimi", is: "Açık teklif takiplerinin süresini tarayıp görev/bildirim açma" },
  "bildirimler/bildirim-zamanlayici.service.ts": { sinif: "sistem_bakimi", is: "Zamanlanmış bildirim taraması" },
  "cari/geciken-soz-zamanlayici.service.ts": { sinif: "sistem_bakimi", is: "Geciken ödeme sözü bildirimi" },
  "cari/odeme-sozu-hatirlatma.service.ts": { sinif: "firma_otomasyonu", is: "Firmanın açtığı ödeme sözü hatırlatma e-postası/SMS'i" },
  "cari/mutabakat-zamanlayici.service.ts": { sinif: "firma_otomasyonu", is: "Firmanın açtığı mutabakat hatırlatma e-postaları" },
  "duzeltmeler/duzeltme-tarama-zamanlayici.service.ts": { sinif: "sistem_bakimi", is: "Veri tutarlılığı (düzeltme) taraması" },
  "fatura/tekrarlayan-fatura-zamanlayici.service.ts": { sinif: "firma_otomasyonu", is: "Tekrarlayan fatura planlarından taslak üretimi" },
  "fiyat-endeks/endeks-artis.service.ts": { sinif: "sistem_bakimi", is: "Endeksli artış önerisi bildirimi (uygulama kullanıcı onayıyla)" },
  "fiyat-endeks/endeks-duyurusu.service.ts": { sinif: "sistem_bakimi", is: "Yeni endeks açıklanınca bildirim ve içgörü" },
  "kasa-banka/banka-senkron-zamanlayici.service.ts": { sinif: "firma_otomasyonu", is: "Firmanın bağladığı bankadan ekstre çekimi" },
  "masraflar/kira-tahakkuk-zamanlayici.service.ts": { sinif: "firma_otomasyonu", is: "Kira sözleşmesinden aylık tahakkuk" },
  "pazaryeri/pazaryeri-otomatik.service.ts": { sinif: "firma_otomasyonu", is: "Firmanın bağladığı pazaryerinden sipariş/kesinti senkronu" },
  "pos/pos.service.ts": { sinif: "sistem_bakimi", is: "POS sağlayıcı dönüş çağrısı ve iade sonucu kaydı" },
};
