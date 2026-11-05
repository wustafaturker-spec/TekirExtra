# Kullanıma başlama takibi ve bekleyen operasyon işleri

Program: [T2 / IS-03–05](PLATFORM-GELISTIRME-IMALAT-PROGRAMI-2026-11-02.md). Önceki [günlük istatistik](PLATFORM-FIRMA-ISTATISTIKLERI-ILK-TESLIM-2026-11-02.md) ve [yaşam döngüsü ölçümü](PLATFORM-BUYUME-VE-DENEME-DONUSUMU-2026-11-02.md) üzerine eklenir. Mevcut veritabanı ve 3100 yayını bu teslimde değiştirilmedi.

## Kullanıma başlama takibi

`/platform/istatistikler` ekranında üç sınıf, bu sınıfların sayıları ve aynı kaynaktan üretilen sayfalı firma listesi bulunur:

| Sınıf | Koşul |
|---|---|
| Etkinliği gözlenen firma | Ölçüm başlangıcından kesim gününe kadar geçerli günlük özette en az bir etkin kullanıcı |
| Etkinlik kaydı olmayan yeni firma | Yaşam döngüsü ölçümü sonrasında oluşturulduğu gözlenmiş, başlangıç fotoğrafında olmayan firma; kayıt günü kullanım ölçüm başlangıcından önce değil ve kayıt gününden kesim gününe kadar her günün geçerli işaretçisi ile firmaya ait özeti var; hiç etkinlik kaydı yok |
| Geçmişi yetersiz firma | Gözlenen pozitif etkinlik yok ve yukarıdaki tam gözlem koşulları sağlanmıyor; eski, eksik günlü, eski hesaplama sürümlü veya firma özeti eksik kayıtlar |

Etkinlik tanımı önceki teslimle aynıdır: kayda geçen başarılı giriş veya izin verilen başarılı modül mutasyonu. Destek/sistem/salt okuma kayıtları bu sayıları artırmaz. Giriş yapmamak ve ürünü hiç kullanmamak eşit kabul edilmez. Kaynak denetimi mevcut mimaride başarı sonrasında asenkron olduğundan bu, **gözlenen etkinlik** sınıflandırmasıdır; bütün ürün kullanımını kesin olarak bildiği iddia edilmez.

Kesim, seçilen bitiş tarihinde kapanmış son Türkiye günüdür. Bitiş bugünse dün kullanılır; tamamlanmamış bugün bir firmayı başlamayan sınıfına sokmaz. Başlangıç filtresinden bağımsız olarak kayıt/ölçüm başlangıcından kesime kadarki gözlem kullanılır. Örneğin önceki hafta etkin olup seçili son günde işlem yapmayan firma yine etkinliği gözlenen sınıfındadır.

Firma kümesi kesim günü sonunda mevcut firmalardan, o andaki yaşam döngüsü paketinden seçilir. Bugünkü paket değişikliği veya silme geçmiş kesimi değiştirmez. Şimdi silinmiş firmanın adı artık bulunamıyorsa “Arşiv firma” gösterilir ve mevcut olmayan profile bağlantı verilmez.

Kesim günü için yaşam döngüsü veya kullanım ölçümü başlamamışsa toplamlar `null`, liste boş ve uyarı görünür. Bu durum sıfır firma gibi gösterilmez. Kayıt günü, son gözlenen etkinlik ve son günlük üretim zamanı ayrıntılarda bulunur. Sınıf değişiminde yalnız bu listenin sayfası, genel tarih/paket/firma değişiminde bütün rapor sayfaları sıfırlanır.

## Bekleyen operasyon işleri

Bu bölüm **canlı durumdur**; tarih aralığından bağımsız mevcut paket/firma kapsamına göre çalışır. Karttan tür seçilir; aynı kaynaktan firma bazında görev, fatura, iade, hata ve toplam sayıları listelenir. Sayılan birim firma değil işlem kaydıdır.

| Tür | Dahil | Hariç |
|---|---|---|
| Firma görevi | Firma bağı olan platform kapsamındaki açık/devam eden görev | Tamamlandı, iptal, firmasız veya mevzuat kapsamı |
| Abonelik faturası işlemi | `bekliyor`, `hata`, `kesinlesti` (tahsilat kaydı bekleyen) | Taslak, tahsil edilmiş |
| İade muhasebeleştirmesi | `faturalayan_durumu` bekliyor/hata | Yazıldı, gerekmiyor |

Gelecek oluşturma zamanlı kayıtlar dahil değildir. Fatura **ödeyen firma** üzerinden sınıflanır; faturalayan firmanın bütün müşterilerinin işleri yanlışlıkla ona yazılmaz. Hatalı fatura/iade, bekleyen toplamının alt kümesidir; toplama yeniden eklenmez. Aynı firma için iki görev ve üç fatura beş işlem kaydıdır; aralarında tek iş oldukları varsayılmaz.

Kartlar türe göre aynı firma tablosunu süzer. Tür değişiminde yalnız operasyon sayfası bire döner; sayfa büyüklüğü 25 ve sıralama toplam azalan/firma UUID artandır. Boş ileri sayfada toplam korunur ve ilk sayfaya dönülebilir. Kapanan görev/işlem canlı toplam ve ayrıntıdan birlikte düşer.

Firma işlemleri bağlantısı mevcut firma detayındaki abonelik/ödeme/iade/takip alanını açar. Görev bağlantısı firmanın açık ve devam eden görevlerini açar. E-belge/BullMQ kuyruğu bu toplama eklenmez; mevcut Sistem sağlığı ekranına ayrı bağlantı vardır. Yeniden deneme veya ödeme/iade eylemleri çoğaltılmadı.

## API ve erişim

Mevcut `GET /api/v1/platform/istatistikler` yanıtına `baslama` ve `operasyon` eklenir. Yeni isteğe bağlı sorgular:

- `baslamaDurum=baslamayan|baslayan|belirsiz`, `baslamaSayfa` (varsayılan 1).
- `operasyon=hepsi|gorev|fatura|iade`, `operasyonSayfa` (varsayılan 1).
- Sayfa sınırı 1–100000. Mevcut tarih/paket/firma doğrulamaları korunur.

Migration `20261103170000_platform_kullanim_ve_bekleyen_isler`, iki dar SECURITY DEFINER toplama işlevi ekler. Platform rolüne yeni kaynak tablo yetkisi açılmaz. Kiracı rolü işlevleri çağıramaz; editör servis/denetleyici erişiminde reddedilir. Ham görev başlığı/açıklaması, hata metni, ödeme/iade kimliği veya kullanıcı kimliği rapora eklenmez. İstatistik ekranındaki diğer metriklerle aynı RepeatableRead transaction'ı kullanılır; anlık operasyon ile tarihsel başlangıç kapsamı açıkça ayrı etiketlenir.

## Doğrulama

Gerçek PostgreSQL'de sınıflandırma, firma bazında eksik özet, eski sürüm, kapanmamış gün, geçmiş paket/silme, canlı iş kapanışı, kaynak durumları ve rol erişimi sınanır. Tarayıcı testleri taklit API ile URL'de sınıf/tür, bağımsız sayfalama sıfırlama, boş geçmiş, işlem bağlantıları, mobil ve klavye akışlarını doğrular. Kaynak hesaplaması yalnız taklit API testleriyle doğrulanmış sayılmaz.

Geniş koşuda 54 PostgreSQL kabul testi ve 11 Chromium senaryosu geçti. Atomik migration düzenlemesinden sonra başlama/operasyon ve RLS kapsamında 10 PostgreSQL testi yeniden geçti. API sözleşmesi/worker için 14 birim testi, API/web TypeScript kontrolleri ve değişen istatistik dosyalarının ESLint kontrolü temizdir. Ölçüm yokken sayfalama toplamını gizleyen son düzeltme mobil ve yeni ekranlar kapsamında 3 Chromium senaryosuyla ayrıca doğrulandı.

## Kalan kapsam

IS-03'ün hiç başlamayan ayrımı gözlenen kullanım tanımıyla ilk sürüme tamamlandı. IS-04'ün bekleyen operasyon kayıtları eklendi. Başarısız ödeme kartının ödeme raporuyla tam tarih/paket/firma kapsamı uzlaştırması ve tarihsel operasyon eğilimleri henüz tamamlanmış sayılmaz. T2 bütünü kapanmadı; ardından T3 paket kataloğu ve T4 duyuru sistemi izlenecek.
