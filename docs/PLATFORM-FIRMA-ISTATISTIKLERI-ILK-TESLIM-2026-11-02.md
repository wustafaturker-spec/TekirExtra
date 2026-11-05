# Firma istatistikleri — ilk teslim

İlgili program: [T2 / IS-01–05](PLATFORM-GELISTIRME-IMALAT-PROGRAMI-2026-11-02.md). İsterler: PLT-54–58. Durum: uygulandı ve doğrulandı. Üretim ve 3100 derlemesi güncellenmedi.

## Kullanıcı akışı

Platform menüsündeki **Firma istatistikleri**, `/platform/istatistikler` ekranını açar. Firma detayındaki **Kullanım istatistikleri** bağlantısı aynı raporu firmaya göre süzer.

- Tarih aralığı, paket, firma, ayrıntı ölçütü ve sayfa URL'de korunur. Bugün, son 7 gün ve son 30 gün kısayolları vardır.
- Dönem kullanım kartları, günlük etkin firma grafiği, modül işlem tablosu ve sayfalı firma ayrıntıları aynı günlük özetlerden üretilir.
- Kullanım kartına tıklamak giriş/işlem/etkinlik ölçütünü seçer; grafik sütununa tıklamak veya klavyeyle etkinleştirmek o güne iner. Günlük değerler ayrıca HTML tablosunda okunabilir.
- Güncel abonelik/operasyon ve paket dağılımı ayrı bölümde gösterilir. Bunlar tarih aralığından bağımsız mevcut durumdur; paket/firma kapsamı uygulanır.
- Eksik ölçümde toplam kartları `—` gösterir, eksik gün sayısı açıklanır ve grafikte çizgili sütun kullanılır. Gerçekten ölçülmüş boş gün ise `0` gösterilir.

## Ölçüm sözlüğü

| Metrik | Kaynak ve hesap |
|---|---|
| Etkin firma | Dönemde uygun giriş veya modül işlem kaydı bulunan farklı tenant sayısı |
| Tekil etkin kullanıcı | Aynı tenant/kullanıcı hesabının dönem boyunca bir kez sayılması; günlük kullanıcı sayıları toplanmaz |
| Başarılı giriş | `audit_log.islem = giris_yapildi`; token yenilemesi sayılmaz |
| Modül işlemi | Başarılı HTTP mutasyonunun denetim kaydı; işlem `POST/PUT/PATCH/DELETE /api/v1/…`, varlık izin listesindedir |
| Modül dağılımı | Bu işlem kayıtlarının kök modüle göre sayısı; belge/fatura adedi değildir |
| Güncel abonelik | Mevcut dar `platform_firma_ozeti` işlevindeki durum ve dönem bilgisi |
| Bağlantı hatası | Mevcut `platform_baglanti_sagligi` işlevinde hata veya ardışık hata bildirilen farklı firmalar |
| Başarısız ödeme | Son 7 Türkiye takvim gününde, şu ana kadar oluşturulmuş başarısız abonelik ödeme denemeleri; firma sayısı değildir |

İşlem izin listesi: fatura, cari, stok, depo, kasa-banka, pos, personel, üretim, projeler, yapay zekâ, bağlantılar, rapor, belgeler, satın alma ve satış kökleri. Kullanıcı arayüzünün gönderdiği fatura formu telemetrisi bu sayaca eklenmez.

Sistem/destek için kullanılan iki sabit UUID, kullanıcı kimliği boş kayıtlar, `destek_istegi`, isimli otomasyon olayları ve GET istekleri kullanım sayılmaz. Böylece gerçek sorumlu hesabıyla çalışan zamanlanmış bir işin isimli denetim kaydı müşteri kullanımı gibi sayılmaz.

Bu metrikler kayda geçmiş etkinliği ölçer; salt sayfa okumalarını veya bütün ürün kullanımını kapsadığı iddia edilmez. Denetim yazımı mevcut yapıda başarı sonrasında asenkron olduğundan, geçici kayıt kaybı halinde sayılar yalnız mevcut kaynak kayıtlarını temsil eder.

## Tarih, paket ve eksik veri

- Gün sınırları `Europe/Istanbul`, kaynak zaman damgaları UTC'dir. UTC 21:00, sonraki Türkiye gününe dahildir.
- Ölçüm başlangıcı migration'ın uygulandığı Türkiye günüdür. Bundan önceki dönemler otomatik olarak dolu/sıfır kabul edilmez.
- Bugün, son üretim anına kadar olan kısmıyla gösterilir; bugün içeren dönem için tam önceki döneme göre yüzde üretilmez.
- Önceki dönem aynı gün sayısındadır. Eksik kaynakta veya sıfır paydada yanıltıcı yüzde yoktur.
- Günlük paket/durum yalnız gününde ölçüldüyse kaydedilir. Kaçırılmış geçmiş günün etkinliği yeniden hesaplanabilir, paketi bugünden türetilmez. Önceden bilinen geçmiş paket yeniden hesaplamada korunur.
- Paket filtresinde o günün paket bilgisi eksikse dönem toplamları da eksik sayılır. Güncel paket dağılımı mevcut pakete dayanır ve ayrı etiketlidir.
- Firma silinse de sayısal özet korunabilsin diye tarihsel özetlerde tenant FK'si yoktur. Firma adı dar ad işlevinde bulunmazsa ayrıntıda “Arşiv firma” gösterilir; olmayan profile bağlantı verilmez.

## Teknik yapı ve erişim

| Parça | Görev |
|---|---|
| `platform_istatistik_ayari` | Tek ölçüm başlangıç günü |
| `platform_istatistik_gunleri` | Üretilen gün, zaman ve hesaplama sürümü |
| `platform_firma_gunluk_ozetleri` | Firma/gün paket, durum ve sayısal kullanım özeti |
| `platform_firma_gunluk_kullanicilar` | Dönemsel tekil sayım için iç hesap izleri |
| `platform_firma_istatistik_uret(date)` | Günlük kaynak okuma ve atomik yeniden üretim |
| `platform_istatistik_tekil_kullanici` | İç izleri dışarı vermeden farklı hesap sayısı |
| `platform_istatistik_guncel` | Dar güncel abonelik/operasyon toplamları |

Yeni tablolarda RLS/FORCE vardır. Kiracı uygulama rolüne tablo/işlev erişimi verilmez. Platform rolü yalnız özet ve gün bilgilerini okur; günlük hesap izlerini doğrudan okuyamaz. Tekil sayım izleri tenant/kullanıcı UUID'lerinden türetilen iç anahtarlardır; ham kullanıcı kimliği veya e-posta değildir, anonimleştirme iddiası taşımaz. API bunları döndürmez.

Kaynak tenant tablolarına platform rolü için genel SELECT açılmaz; dar SECURITY DEFINER işlevleri yalnız sayısal özet üretir. İstek gövdesi, mali belge içeriği, IP, tarayıcı bilgisi ve denetim ayrıntıları istatistik API'sine taşınmaz. Mevzuat editörü uçlara erişemez ve menüde bağlantı görmez.

## İşletim ve yeniden hesaplama

`PlatformIstatistikZamanlayiciService` yalnız `TEKIR_WORKER=1` ve platform bağlantısı varken başlar. Açılışta ve 10 dakikada bir bugün/dünü yeniden üretir, son yedi gündeki eksik/sürümü eski günleri tamamlar. Yerel süreç kilidi üst üste çalışmayı önler; veritabanı gün kilidi farklı worker'ları korur. Kapanış zamanlayıcıları temizler.

Bir günlük işlem; hesap izleri, özetler ve tamamlanma işaretçisiyle aynı veritabanı transaction'ındadır. Gün işaretçisi yazılamazsa önceki özet ve izler korunur. Kaynak yeniden okunup sayılar değiştirilir, mevcut sayılara eklenmez.

Yönetici **Seçili günleri yeniden hesapla** ile en çok 31 günü işleyebilir. Ölçüm başlangıcından önce veya gelecekte üretim yoktur. Bir başka işlem gün kilidini tutuyorsa gün atlanır ve devam eden hesaplama açıkça bildirilir; tamamlandı diye gösterilmez. Tarih aralığı birden fazla günlük transaction'dır; yarıda hata olursa tamamlanan günler kalır, tekrar deneme güvenlidir. Manuel işlem kapsamı ve tamamlanan/bekleyen gün sayıları platform denetimine yazılır.

## API

| Yöntem | Yol | Parametreler |
|---|---|---|
| GET | `/api/v1/platform/istatistikler` | `baslangic`, `bitis`, isteğe bağlı `plan`, `firma`, `olcut=etkin/giris/islem`, `sayfa` |
| POST | `/api/v1/platform/istatistikler/yeniden-hesapla` | JSON `baslangic`, `bitis`; en çok 31 gün |

Rapor en çok 93 gün, ayrıntı sayfası 25 kayıt içerir. Arama/ölçüt değişiminde sayfa bire döner; eski ağ yanıtı yeni filtre sonucunu değiştiremez. Rapor sorguları tutarlı okuma transaction'ında çalışır. Eksik günlere ait eski veya uyumsuz özetler bilinen veri tablolarına eklenmez.

## Geçiş ve kalan kapsam

Migration: `20261103130000_platform_firma_istatistikleri`; önceki firma takip migration'ından sonra uygulanır. Prisma istemcisi üretildikten ve migration uygulandıktan sonra API/web/worker açılır. İlk worker turu bugünü üretir; daha eski geçmiş varmış gibi eklenmez. Mevcut veritabanına bu çalışmada migration uygulanmadı.

IS-01 altyapısı hazırdır. IS-03 ve IS-04'ün ilk sayısal ekranı, IS-05'in filtre/grafik/karşılaştırma davranışı uygulanmıştır. IS-02 büyüme, deneme kohortu ve ücretliye dönüşüm; güvenilir “hiç kullanıma başlamayan” ayrımı, bekleyen iş kuyruğu istatistikleri ve bunların tarihsel eğilimleri sonraki işlerdir. Bunlar bugünkü hesap/paket durumundan türetilip tamamlandı sayılmadı.

## Doğrulama kaydı

Geniş geçici PostgreSQL koşusunda 38 platform kabul testi geçti. Son eşzamanlı hesaplama davranışı ayrıca istatistik ve RLS kapsamında 10 PostgreSQL testiyle doğrulandı. Yeni API/worker için 10 ve karşılaştırma yardımcısı için 2 birim testi geçti. API/web TypeScript kontrolleri, yeni istatistik dosyalarının ESLint kontrolü ve diff boşluk kontrolü temizdir. Firma detayının 6 tarayıcı senaryosu önceki birleşik koşuda geçti; istatistiğin son 7 Chromium senaryosu da geçti (masaüstü, mobil, klavye, filtre yarışları, eksik günler, erişim ve eşzamanlı hesaplama uyarısı). Tarayıcı API yanıtları taklit edilir; SQL, roller ve yarışlar gerçek PostgreSQL'de ayrı doğrulanır.

```sh
node apps/api/scripts/platform-firma-kabul.mjs
pnpm --filter @tekirextra/web exec playwright test --config playwright.platform.config.ts e2e/platform-istatistik.spec.ts e2e/platform-firma-detay.spec.ts --timeout 120000
```

## Devam teslimi

Büyüme ve deneme dönüşümünün sonraki uygulaması ayrı [teslim kaydında](PLATFORM-BUYUME-VE-DENEME-DONUSUMU-2026-11-02.md) yer alır. Yukarıdaki kalan kapsam ve test sayıları ilk teslimin durumudur.
