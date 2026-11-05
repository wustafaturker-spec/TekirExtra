# Katalog fiyat etkisi önizlemesi

PK-02/PK-08'in salt okuma ilk adımıdır. Kontrollü atama veya fiyat geçişi teslimi değildir.

Devam teslimi: [aynı planda firma seçimi ve kontrollü fiyat ataması](PLATFORM-PAKET-KONTROLLU-ATAMA-2026-11-04.md). Aşağıdaki açıklamalar ilk salt okuma tesliminin kapsamını kaydeder.

## Davranış

`GET /platform/paketler/fiyat-etkisi?surumId=...&sayfa=...` yalnız platform yöneticisine açıktır. UUID, sayfa sınırları ve sorgu beyaz listesi doğrulanır. Hedef sürüm yayınlanmış ve fiyat sözleşmesi geçerli olmalıdır. Hedef ve abonelik listesi tek RepeatableRead transaction içinde okunur. Mevcut katalog geçiş raporunun kararlı 25'lik sayfalaması ve tüm abonelik kapsamı kullanılır; sayfa dışı toplamlar korunur.

Her firmada kayıtlı abonelik koşulları ile hedefin 1/3/6/12 aylık matrah, KDV ve toplamı karşılaştırılır. Fark iki bağımsız hesaplamanın Decimal çıkarımıdır; her sözleşmenin kendi KDV oranı kullanılır. Negatif fark korunur. Yıllık bedel aylıktan türetilmez; iki taraftan birinde dönem fiyatı yoksa fark null kalır. Null ücretsiz anlamına gelmez.

Yalnız hedef paketin eski plan eşlemesiyle aynı plandaki, kayıtlı koşulları bulunan abonelikler karşılaştırılabilir. v1 Profesyonel olarak değerlendirilir. Diğer planlar, eşlenmeyen yeni paketler ve kayıtlı bağı olmayan abonelikler açık gerekçeyle gösterilir. Bozuk bağ sessizce eski fiyatlara dönmez. Rapor bütün abonelikleri listeler; toplam etkilenen veya atanmaya uygun firma sayısı değildir.

`/platform/paketler/fiyat-etkisi?surumId=...` ekranına paket detayındaki fiyatlı yayınlanmış sürümlerden gidilir. Dönem ve sayfa URL'de korunur; firma detayına bağlantı, yükleniyor/hata/boş sayfa ve yeniden deneme durumları vardır. Hedef geçerlilik tarihi gösterilir; otomatik aktivasyon anlamı taşımaz. Uygulama tarihi null, atama yapılmış bilgisi false kalır.

## Sınırlar ve devam

Hesaplanan fark dönem bedeli farkıdır; ara dönem mahsuplaşması veya tahsilat talimatı değildir. Kota/özellik sürümleme, kullanım limitine uygunluk, hedef firma seçimi, onaylanan etkinin kalıcı kaydı, uygulama tarihi ve atomik/idempotent atama devam eder. Bu nedenle PK-02/PK-08 bütünü açık kalır. Mevcut veritabanına migration veya çalışan yerel uygulamaya yayın yapılmadı.

## Doğrulama

İlgili dört dosyada 83 birim testi geçti; bunların 15'i yeni hesaplama/API sözleşmesini kapsar. Vergi oranı değişimi, negatif fark, yarım kuruş, eksik dönem, v1, bağı olmayan/farklı plan, bozuk koşul, taslak/arşiv/fiyatsız/bulunamayan sürüm, editör engeli ve sorgu doğrulaması sınandı. Gerçek PostgreSQL kabulü bu teslimde çalıştırılmadı.

API ve web TypeScript kontrolleri, değişen kaynakların ve yeni tarayıcı testinin ESLint kontrolü geçti. İzole 3112 Next geliştirme sunucusunda yeni Playwright senaryosu geçti (18,1 saniye; sunucu hazırlığı dahil 1,1 dakika): boş ileri sayfada toplam/ilk sayfaya dönüş, fiyat farkı, eşlenmeyen plan açıklaması, eksik dönem, URL'de dönem ve sayfa, yeniden yüklemede seçim korunması ve yazma isteği oluşmaması doğrulandı. Tarayıcı testi API yanıtlarını taklit eder; gerçek veritabanı kabulünün yerini almaz.
