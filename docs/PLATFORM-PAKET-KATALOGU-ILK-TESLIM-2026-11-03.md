# Paket kataloğu: tanım ve sürüm yönetimi

Program: T3 / PK-01 tanım-sürüm bölümü; HZ-01 ticari akış envanteri. Yeni ekranlar `/platform/paketler` ve `/platform/paketler/[id]`. Bu teslim mevcut yerel veritabanına veya 3100 derlemesine uygulanmadı.

## Teslim sınırı

Bu sürüm paket kodu, adı, açıklaması, özellik listesi, katalog sırası ve taslak/yayın/arşiv yaşam döngüsünü yönetir. Satışa açıklık, fiyat, ödeme/yenileme, kota ve abonelik ataması henüz kataloğa bağlanmadı. Dolayısıyla PK-01'in satışa açıklık kısmı ve T3 bütünü kapanmış sayılmaz. Katalog yayını ürün satışına açılma anlamına gelmez; bu ayrım ekranlarda ve yayın onayında açıklanır. Satışa açıkmış gibi görünen, ticari akışların okumadığı bir anahtar eklenmedi.

Başlangıç, Profesyonel ve Kurumsal paketlerinin mevcut tanımları birinci yayın sürümleri olarak aktarılır. `v1`, mevcut Profesyonel eşlemesidir; ayrı katalog paketi oluşturulmaz ve yeni kod olarak kullanılamaz. Hiçbir tenant aboneliğine sürüm bağlanmaz, dönem/fiyat/limit/ödeme geçmişi değiştirilmez. Mevcut ücret ve limitler eski kaynağından salt okunur gösterilir; bunlar düzenlenen tanım sürümünün fiyatı olarak sunulmaz. Yeni paket, ticari bağlantıları tamamlanana kadar müşteri aboneliğine atanamaz.

## Davranış

- Benzersiz küçük harf/rakam/alt çizgi kodu kayıttan sonra değişmez. Kod, ad, açıklama ve özellikler düz metindir; HTML çalıştırılmaz.
- Paket oluşturma ilk taslağı da aynı transaction'da açar. Paket başına yalnız bir açık taslak vardır.
- Taslak kaydı `kilitSurumu` ile kontrol edilir. Çakışmada eski alanlar kaybolmaz; kullanıcı güncel kaydı inceleyip düzenlemeyi yeniden açabilir.
- Yayın, kaydedilmiş içerik ve revizyon üzerinden önizlenip onaylanır. En az bir özellik gerekir. Yayınlanan içerik yerinde değiştirilemez; yeni içerik için yayın veya arşiv sürümünden ardışık numaralı taslak kopyalanır.
- Birden fazla yayın sürümü tarihsel olarak kalabilir. Bu aşamada aboneliklerin okuyacağı “etkin ticari sürüm” seçilmez.
- Arşivleme içeriği ve geçmişi korur; arşiv tekrar yayına çevrilemez. Fiziksel silme ucu yoktur, DB rolünde silme yetkisi yoktur; sürüm trigger'ı fiziksel silmeyi ve yayın içeriği değişikliğini de reddeder.
- Liste son sürümün adı/sırasıyla çalışır. Taslak sıralaması da yönetim listesini etkiler; müşteri paket sıralaması değişmez. Kod veya son sürüm adı aranabilir.
- Paket ve sürüm listeleri sunucuda 25 kayıtlık kararlı sayfalama kullanır. Boş ileri sayfada toplam korunur. Liste filtresi güvenli dönüş bağlantısıyla korunur.

## Ticari kaynak envanteri ve sonraki geçiş

| Kaynak | Bugünkü sorumluluk | Katalog entegrasyonunda korunacak |
|---|---|---|
| `tenant/abonelik.service.ts` | `ABONELIK_PLANLARI`, v1 eşleme, plan özeti/talebi, dört kullanım limiti | Geçerli abonelik sürümü; eski kodlar, sınırsız değerler ve plan düşürme kontrolü |
| `tenant/abonelik.controller.ts` | Üç sabit koda izin veren plan talebi doğrulaması | Satışa uygun, fiyat/erişim koşulları tamamlanmış sürüm doğrulaması |
| `abonelik-odeme/abonelik-tutari.ts` | 1/3/6/12 ay, KDV hariç 399/999 TL ve teklifle Kurumsal; %20 KDV, Decimal hesap | Para birimi, vergi, dönem fiyatları ve kuruş yuvarlama; canlı mali hesap mevzuatının ayrı doğrulanması |
| `abonelik-odeme/abonelik-odeme.service.ts` | Ödeme seçenekleri, sağlayıcı/bağlantı/otomatik kanaldan deneme açma, tutar fotoğrafı | Denemeyi açan fiyat sürümünü sabitle; sonraki yayın başlamış ödemeyi değiştirmesin |
| `abonelik-odeme/otomatik-yenileme.service.ts` | Kayıtlı kartla yenileme ve deneme akışı | Abonenin koşullarından fiyat; katalog yayınıyla sessiz fiyat geçişi olmaması |
| `abonelik-odeme/abonelik-fatura.service.ts` | Ödeme tutarından fatura, plan adı için sabit kaynak | Ödeme ve faturada aynı fiyat/tanım sürümü; eski fatura içeriği korunmalı |
| `abonelik-odeme/platform-odeme-raporu.service.ts` | Yaklaşan yenilemelerde beklenen tutar ve plan adı | Yenilemenin gerçekten kullanacağı koşullarla önizleme uzlaştırması |
| `mevzuat/tahsilat-hatirlatma.service.ts` | Ödeme bağlantısı uygunluğu ve hatırlatma | Aynı satış/ödeme kuralları; yanlış fiyata bağlantı üretmeme |
| `mevzuat/platform-firma.service.ts` ve `platform.controller.ts` | Platform plan onayı/ataması, ad eşleme, manuel tahsilat | Paket/sürüm geçişi ve denetim; mevcut elle tahsilat/iade akışını çoğaltmama |
| Stok/cari/fatura/kullanıcı controller'ları | `limitDogrula` ile stok, cari, aylık fatura ve kullanıcı sınırları | PK-04'te kota kaynağı, dönem sınırı ve eşzamanlılık; bu teslim yeni kota garantisi vermez |
| `core/abonelik-erisim.service.ts` | Abonelik durumuna göre yazma/erişim politikası | Durum kuralı ile PK-03 özellik politikasını birlikte doğrulama |
| Web `panel/ayarlar/abonelik` | API'den plan kartları, limitler, talep ve ödeme | Katalog satış sürümünden aynı koşulları gösterme |
| Web `lib/platform-firmalar.ts`, firma yönetimi ve istatistik ekranları | Sabit paket seçenekleri/etiketleri ve eski v1 gösterimi | Yayınlı sürüm seçenekleri, eski kod/istatistik referansları korunmalı |

Bu envanterdeki ticari tüketiciler bu teslimde değiştirilmedi. PK-02–09 kapsamında fiyat/vergi/dönem ve erişim koşulları tanımlanmalı; mevcut abonelikler kontrollü sürüme bağlanmalı, bilinmeyen planlar raporlanmalı ve önce/sonra yenileme tutarı-limit-dönem sonuçları uzlaştırılmalıdır. Ardından satışa açıklık ve uygun sürümlere geçiş etkinleştirilir. Eski sabitlerden yeni kataloğa sessiz bir fiyat geçişi yapılmaz.

## Veri, API ve yetki

Migration `20261103230000_platform_paket_katalogu`, `platform_paketler` ve `platform_paket_surumleri` tablolarını ekler. Tablolar RLS/FORCE ile yalnız `tekir_platform` rolüne açıktır. Kiracı rolü okuyup yazamaz. Paket kimliğine UPDATE/DELETE, sürümlere DELETE yetkisi verilmez. Yayın içeriği, kimlik/revizyon kuralı ve sürüm sırası DB trigger'ı ile de korunur.

Yalnız platform yöneticisi erişebilir. Yazmada mevcut yetki değiştirme kilidi altında yöneticinin aktif rolü ve kurulum durumu yeniden doğrulanır; ardından paket kilidi alınır. Aynı paket için taslak/güncelleme/yayın/arşiv işlemleri serileştirilir. İşlem ve `mevzuatOlay` kaydı aynı transaction'dadır; denetim kaydı başarısızsa değişiklik de geri alınır. Yeni olaylar mevzuat editörü izin listesinde bulunmadığından editör denetimden de göremez.

- `GET/POST /platform/paketler`: arama/sayfa ve ilk taslaklı paket oluşturma.
- `GET /platform/paketler/:id?sayfa=...`: paket ve sayfalı sürümler.
- `POST /platform/paketler/:id/taslak`: yalnız aynı paketteki yayın/arşiv sürümünden kopya.
- `PATCH /platform/paketler/:id/surumler/:surumId`: taslak içeriği ve beklenen kilit revizyonu.
- `POST .../:surumId/yayinla` ve `POST .../:surumId/arsivle`: yalnız beklenen kilit revizyonu.

İstekler beyaz listeyle doğrulanır; fiyat/satış gibi desteklenmeyen alanlar sessizce kabul edilmez. Rol, paket ve sürüm uyuşmazlıkları reddedilir.

## Doğrulama

Son doğrulama: izole PostgreSQL üzerinde 10 katalog kabul testi ve 3 RLS kabul testi, 31 ilgili birim testi geçti. Chromium koşusunda 4 senaryo geçti; yenilemede formun korunması düzeltildikten ve soğuk Next dev detay derlemesi test öncesi tamamlandıktan sonra kalan 2 senaryo da geçti. Böylece 6 tarayıcı senaryosu doğrulandı. API/web TypeScript, değişen dosyaların ESLint ve diff boşluk kontrolleri temiz. İlk geniş API tip kontrolünde 2 GB heap yetersiz kaldı; 4 GB ile sonraki kontrol tamamlandı. Yoğun eşzamanlı doğrulama sırasında bir geçici DB bağlantı hatası alındı; kaynak baskısı giderilip test bağlantı zaman aşımı 30 saniye yapıldıktan sonra son 13 PostgreSQL testi geçti. Gerçek PostgreSQL kabulü aktarım eşitliği, eski abonelik/fiyatın korunması, eşzamanlı revizyon/taslak yarışları, DB içerik koruması, arşiv, sayfalama, denetim atomikliği ve rol erişimini kapsar. Tarayıcı kabulü URL, yeni taslak, kopyalama, düzenleme, yayın önizlemesi, arşiv, çatışmada alan koruma, mobil/klavye ve editör erişimini kapsar.
