# Tarihsel abonelik ve operasyon eğilimleri

Program: T2 / IS-04–05. [Ödeme kapsam uzlaştırmasının](PLATFORM-ODEME-KAPSAM-UZLASTIRMASI-2026-11-03.md) ardından tarihsel operasyon gözlemleri eklendi. Bu teslim mevcut yerel veritabanına ve 3100 derlemesine uygulanmadı.

## Ölçüm sözleşmesi

Worker açılışta ve yaklaşık 10 dakikada bir, güncel abonelik/operasyon durumunun sayısal gözlemini alır. Türkiye günü başına son başarılı gözlem tutulur. Bu **kesin gün sonu kaydı değildir**: worker durduğunda son gözlem eskir; gözlem anı kullanıcıya gösterilir. İlk günün ölçümü başladığı andan önceki durum bilinmez. Geçmiş günler bugünkü verilerle yeniden oluşturulmaz. Kullanım özetlerini yeniden hesaplama bu gözlemleri değiştirmez.

Firma başına gözlenen paket, abonelik durumu, gecikme, yedi takvim gününde yenilenecek olma, gözlenen bağlantı hatası, açık görev, bekleyen abonelik faturası, bekleyen iade muhasebeleştirmesi ve bunların hatalı alt kümesi saklanır. Görev/fatura/iade kapsamı mevcut canlı `platform_bekleyen_isler` ile aynıdır; fatura ödeyen firmaya aittir. Gelecek oluşturma zamanlı işler sayılmaz. Kullanıcı, görev içeriği, ödeme/kart belirteci ve hata metni saklanmaz. Firma silinmesi sayısal geçmişi silmez.

Paket/firma filtresi her günün gözlemindeki kayıtları seçer. Firma bugün başka pakete geçmiş veya silinmiş olsa da eski sayıları değişmez. Firmanın bugünkü adı kullanılır; silinmiş firmada “Arşiv firma” yazılır ve bağlantı gösterilmez. Mevcut firmaya verilen bağlantı güncel çalışma alanını açar, tarihsel işlemleri yeniden uygulamaz.

Günlük iş sayıları bir stok gözlemidir; günler toplanarak yeni iş/iş hacmi sayılmaz. Dönem karşılaştırması seçili dönemin son günü ile önceki eşit süreli dönemin son gününün gözlemlerini karşılaştırır. Değişim açılan/kapanan iş sayısı değildir. Eksik uç noktada karşılaştırma yoktur; sıfır paydada yanıltıcı yüzde üretilmez; bugün devam ederken yüzde gösterilmez. Ara günlerin eksikliği ayrıca belirtilir.

Gün işaretçisi, hesaplama sürümü ve işaretçideki firma sayısıyla bütün firma satırlarının sayısı uyuşmalıdır. İşaretçisi olmayan, eski sürümlü veya firma satırı eksik günün toplamları `null`, ayrıntıları boştur; paket filtresi eksikliği gizlemez. Geçerli gözlemde boş paket/firma kapsamı gerçek sıfırdır.

## Ekran ve API

`/platform/istatistikler` içinde ayrı “Tarihsel abonelik ve operasyon” bölümü bulunur: dönem sonu karşılaştırma tablosu, günlük eğilim tablosu ve aynı gözlemden sayfalı firma ayrıntıları. Gün butonları klavyeyle kullanılabilir; geniş tablolar kapsayıcılarında kayar.

`GET /platform/istatistikler` yanıtına `operasyonGecmisi` eklenir. `operasyonGun` isteğe bağlıdır, varsayılan bitiş günüdür ve seçili aralığın içinde olmalıdır. `operasyonGecmisSayfa` 1–100000 aralığındadır. Sayfa büyüklüğü 25, sıralama toplam iş azalan/firma UUID artandır. Boş ileri sayfada toplam korunur, ilk sayfaya dönülebilir. Gün değişimi yalnız tarihsel sayfayı; genel tarih/paket/firma değişimi bütün ayrıntı sayfalarını ve seçili tarihsel günü sıfırlar. Canlı operasyon türü/sayfası bu bölümden bağımsızdır.

## Saklama ve erişim

Migration: `20261103210000_platform_operasyon_gecmisi`.

- `platform_operasyon_gunleri`: Türkiye günü, UTC gözlem anı, firma sayısı ve sürüm.
- `platform_operasyon_ozetleri`: firma/gün başına sayısal gözlem; tenant silinmesine bağlı FK yoktur.
- `platform_operasyon_gozle()`: tarih parametresi almaz, yalnız bugünü yazar. Advisory transaction kilidiyle yarışan worker atlanır. Firma satırları ile işaretçi tek transaction'da yazılır; hata tüm değişiklikleri geri alır.
- `platform_operasyon_gecmisi(...)`: sınırlandırılmış, salt okunur ve ham içerik içermeyen rapor.

Tablolarda RLS/FORCE ve kapalı politikalar vardır. Platform rolü dahi doğrudan okuyup yazamaz; yalnız dar SECURITY DEFINER işlevleri çağırır. Kiracı rolü işlevleri çağıramaz; editör servis ve mevcut platform erişim kurallarıyla reddedilir. Mevcut RepeatableRead rapor transaction'ı tarihsel bölümü de kapsar.

## Doğrulama ve kalanlar

PostgreSQL kabulü; canlı kapsam eşitliği, tekrar çalışma, paket değişimi, iş kapanışı, silinen firma, eksik gün/firma satırı, sayfalama, worker kilidi, atomik geri alma ve rol erişimini kapsar. Tarayıcı kabulü gün/URL/sayfa bağımsızlığı, eksik ölçüm, filtre sıfırlama, arşiv firma ve mobil/klavye akışlarını kapsar. Doğrulama sonucu: izole PostgreSQL üzerinde beş dosyada 29 kabul testi geçti; önceki dönem uç noktası ve değişmiş kaynakta atomik geri alma doğrulaması güçlendirildikten sonra 8 tarihsel operasyon testi yeniden geçti. 17 ilgili birim testi geçti. Chromium koşusunda 11 senaryo geçti; tablo başlığı ve mevcut UI rollerine ait test seçimleri düzeltildikten sonra kalan 3 senaryo da geçti. Mobil taşma ve klavye akışı bu kapsamdadır. API/web TypeScript, değişen dosyaların ESLint ve diff boşluk kontrolleri temiz.

Bu teslim gözlenen tarihsel abonelik/operasyon ilk sürümünü sağlar; geçmiş dönemlerin tam durumunu geri getirmez. T3 paket kataloğu ve T4 duyuru sistemi sıradadır. FR-03 duyuru sekmesi ve FR-05 birleşik zaman çizelgesi gibi diğer program maddeleri bu teslimle kapanmaz; birleşik T6/pilot kabulü ayrıca yapılır.
