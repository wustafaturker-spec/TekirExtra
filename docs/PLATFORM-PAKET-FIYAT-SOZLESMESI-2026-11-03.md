# Paket fiyat sözleşmesi ve sürüm fiyatları

PK-02'nin ortak hesaplama bölümü eklendi. `paket-fiyat-sozlesmesi.ts`, TRY cinsinden KDV hariç 1/3/6/12 aylık dönem bedellerini kabul eder. Bedeller dönemin toplamıdır; yıllık fiyat aylık fiyatın çarpımı olmak zorunda değildir. Para ve oran girdileri ondalık metindir; tutarda en fazla iki ondalık ve on iki tam sayı hanesi desteklenir. Negatif, üstel, bozuk veya yinelenen dönem verileri reddedilir. Tanımlanmamış dönem için fiyat türetilmez. Sıfır tutar ve sıfır vergi desteklenir. Desteklenmeyen para birimi ve KDV dahil fiyat reddedilir.

KDV Decimal ile hesaplanır ve yarım kuruş yukarı yuvarlanır; toplam, matrah ile yuvarlanmış KDV'nin toplamıdır. Mevcut `abonelikTutari` aynı sözleşmeye bağlandı; mevcut sabit fiyat ve vergi oranı kullanılır. Başlangıç, Profesyonel ve v1 tutarları dört dönemde korundu. Kurumsal ve bilinmeyen planlar için çevrim içi fiyat üretilmez.

## Sürüme fiyat kaydı

Devam tesliminde `PlatformPaketSurumu.fiyatlandirma` alanı eklendi. Fiyat sözleşmesi, saat içermeyen `YYYY-MM-DD` Türkiye takvim günü olarak geçerlilik tarihiyle saklanır. Bu tarih otomatik etkinleştirme işlemi başlatmaz. Taslak formunda dönem bedelleri, KDV ve tarih düzenlenir; boş bırakılan dönem satırı kayda girmez. Ondalık virgül girişte noktaya çevrilir; arka uç ondalık noktalı metin alır. Fiyat tanımı kapatılırsa açıkça `null` gönderilir. Eski istemcinin düzenlemede alanı göndermemesi fiyatı silmez.

API oluşturma/düzenleme sözleşmeleri beyaz listeyle doğrulanır. Servis de fiyat sözleşmesini doğrular. Tarih, en az 0001 yılından geçerli bir takvim günüdür; saat dilimi dönüştürmesi yapılmaz. Yayın önizlemesi ve sürüm geçmişi dönem toplamlarını KDV hariç gösterir. Yeni taslağa fiyat ve tarih aynen kopyalanır. Revizyon çakışması ve kayıt yenilemede fiyat alanları korunur.

Migration `20261104010000_platform_paket_fiyatlandirma` yalnız katalog sürümüne nullable JSONB sütunu ve fiyat koruma trigger'ı ekler. Eski yayınlara fiyat doldurmaz; eski tanım yayınları fiyat tanımı olmadan kalabilir. Doğrudan DB yazımında da sözleşme/tarih/dönem/ondalık kuralları kontrol edilir; yayınlanan fiyat arşivleme sırasında da değiştirilemez. Mevcut RLS ve rol izinleri geçerlidir. Fiyat değişikliği önceki/sonraki değerlerle mevcut atomik denetim kaydına girer. Oluşturma olayına ilk fiyat eklenir; kopyalama olayı değiştirilemez kaynak sürümü referanslar.

## Kalan ticari bağlantılar

Devam teslimlerinde mevcut sabit koşullar için [ödeme fiyat fotoğrafı ve fatura kaynağı](PLATFORM-ODEME-FIYAT-FOTOGRAFI-2026-11-03.md), ardından [bilinen eski aboneliklerin sürüm bağı ve yenileme/limit ortak kaynağı](PLATFORM-ABONELIK-KATALOG-BAGI-2026-11-03.md) eklendi. Yeni katalog fiyatından ticari koşul seçimi ve mevcut aboneye kontrollü atama devam eder. Katalog yayını ticari koşulları değiştirmez; tarih geçmiş olsa da yeni fiyat tahsilata otomatik geçmez. PK-02 bütünü kapanmadı. Yerel veritabanına migration veya çalışan uygulamaya yayın yapılmadı.

## Doğrulama

İlk hesaplama temelinde 27 test; son sürüm fiyatı devamında 23 hesaplama, 4 eski tutar ve 33 katalog sözleşmesi testi olmak üzere toplam 60 ilgili birim testi geçti. İzole PostgreSQL üzerinde 14 katalog kabulü ve 3 RLS kabulü geçti; tüm migration'lar bu geçici veritabanında uygulandı. Fiyatlı yayın/kopyalama/arşiv, doğrudan DB doğrulaması, eski istemcide fiyatın korunması, açık null, denetimde geri alma ve mevcut aboneliğin korunması doğrulandı. Test sonrası geçici PostgreSQL kaldırıldı.

Chromium'da 8 paket senaryosu geçti: mevcut liste/detay, oluşturma, yayın/arşiv, yetki, mobil/klavye ve çakışma senaryolarına ek olarak dönem fiyatı/tarih kaydı, yayın önizlemesi, yeni taslağa fiyat kopyalama, fiyatı kaldırma ve çakışmada fiyat alanlarını koruma doğrulandı. API ve web TypeScript kontrolleri, değişen kaynakların ESLint ve diff boşluk kontrolü temiz. İlk API tip kontrolü 2 GB heap sınırında durdu; 4 GB ile tamamlandı. İlk tarayıcı test sunucusu hazırlığında 120 saniye sınırı aşıldı; izole platform yapılandırmasının hazırlık süresi 240 saniyeye çıkarıldı. Son tarayıcı koşusu 3,7 dakikada 8/8 tamamlandı.
