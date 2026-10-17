# F02 — Takip, görüşme ve günlük iş listesi

15 Ekim 2026. Ödeme sözlerinin yanına kalıcı tahsilat takibi, sorumlu, sonraki işlem, görüşme/not ve itiraz nedeni eklendi. Cari detayındaki Tahsilat sekmesinde takip açılır; `/panel/cari/tahsilat` ekranında günlük işler izlenir. Migration gerçek şirket veritabanına uygulanmadı; şirket modu açılmadı ve canlı yayın yapılmadı.

## İş kuralları

- Cari başına tek açık/bekleyen takip vardır. Tamamlanan veya iptal edilen kayıt yeniden açılmaz; gerektiğinde yeni takip oluşturulur. Eski konu ve kimlik değiştirilmez.
- Takip durumu `acik`, `beklemede`, `tamamlandi`, `iptal`; nedeni `tahsilat` veya `itiraz` olur. İtiraz bu sürümde cari takibinin nedenidir; ayrı fatura/kalem itiraz dosyası değildir.
- Açık/bekleyen takipte sonraki işlem açıklaması ve günü zorunludur. Yeni planlanan işlem günü Türkiye gününden önce olamaz. Sonlandırmada sonraki işlem alanları boşaltılır, gerekçe zorunludur; önceki değerler audit snapshot'ında saklanır.
- Sorumlu yalnız aynı şirketin aktif yönetici/muhasebe kullanıcısı olabilir. Mevcut sorumlu sonradan pasif olursa geçmiş korunur ve ekranda pasif olduğu gösterilir; yeni atamada güncel uygunluk denetlenir.
- Görüşmede kanal (`telefon/eposta/ziyaret/not`), görüşme günü ve 2–2.000 karakter not bulunur. Gelecek gün kabul edilmez. Kayıt zamanı ve kullanıcı sunucudan alınır. Görüşme değiştirilemez/silinemez; düzeltme yeni notla yapılır.
- Görüşme eklemek ve takip değiştirmek sürümü artırır. Aynı eski sürümle yarışan görüşme/sonlandırma işlemlerinden yalnız biri başarılı olur. Görüşme veya takip oluşturma aynı istek anahtarıyla tekrarlandığında ikinci kayıt/audit üretilmez. Farklı içerikle anahtar kullanımı 409'dur.
- Takibi tamamlamak ödeme almak, fatura kapatmak veya ödeme sözünü gerçekleştirmek değildir. Bu kayıtlar para/bakiye yaratmaz. Kanal seçimi e-posta/SMS göndermez; mevcut otomatik hatırlatma politikaları bu sürümde itiraz kaydına bağlanmadı.

## Kalıcılık ve yalıtım

`TahsilatTakibi` ve `TahsilatGorusmesi` modelleri eklendi. Her iki tabloda RLS ve FORCE RLS; cari/atanan/kullanıcı bağlarında DB kapsam trigger'ları bulunur. Cari başına açık takip tekilliği kısmi unique index ile korunur. Uygulama rolü takip silemez, görüşme güncelleyemez/silemez. Takipte kimlik, konu ve oluşturulma bilgisi değiştirilemez; kapalı takip güncellenemez.

Servisler mevcut `tahsilat_operasyonu` şirket ayarını ve rol sınırlarını kullanır. Varsayılan kapalıdır; salt okunur modda yönetici de yazamaz. Yazan roller yönetici/muhasebe, okuyan roller ayrıca mali müşavir/salt okunurdur. Tüm erişimler tenant transaction'ında ve açık tenant koşuluyla yapılır.

Yazımlar mevcut cari kilit sırasını kullanır; kilit alındıktan sonra takip yeniden okunup sürüm kontrol edilir. Sorumlu atanırken kullanıcı satırı paylaşılmış kilitle doğrulanır. Takip/görüşme, sürüm ve audit aynı transaction'dadır. Audit hatasında not ve sürüm birlikte geri alınır. Audit önceki/sonraki takip snapshot'ını saklar; zaman için işlemde alınan DB saati kullanılır.

## API

| Yol | İşlev |
|---|---|
| `GET /cari/tahsilat-takipleri` | 50'lik cursor sayfası; `gorunum=bugun/itiraz/tum`, isteğe bağlı `cariId`, `sorumluUserId`, `imlec` |
| `GET .../sorumlular` | En fazla 1.000 uygun kullanıcı ve varsayılan sorumlu; aşımda kısmi liste yok |
| `GET .../:id` | Takip, son 100 görüşme ve son 100 audit açıklaması; toplam sayaçlarıyla |
| `POST /cari/tahsilat-takipleri` | Konu, cari, sorumlu, neden, sonraki işlem/gün ve istek anahtarıyla açma |
| `PATCH .../:id` | Beklenen sürüm, sorumlu, neden, durum, sonraki işlem/gün ve gerekçeyle değiştirme |
| `POST .../:id/gorusmeler` | Beklenen sürüm, kanal, gün, not ve istek anahtarıyla görüşme ekleme |

Liste ve detay `RepeatableRead` snapshot'ıyla okunur; GET yanıtları `no-store` taşır. Bugün görünümü açık/bekleyen ve sonraki günü bugün veya geçmişte olanları; itiraz görünümü günü ne olursa olsun açık/bekleyen itirazları getirir. Tüm görünümü sonlandırılmış geçmişi de içerir. Sıra sonraki gün + kimliktir; tarih boş olan kapalı takipler sona gelir. Filtreye uymayan/başka kapsamdaki cursor 409 üretir; yeniden başlama istenir. Ayrı sayfa istekleri arasında sabit snapshot garantisi yoktur; liste değişirse baştan yenilenebilir.

## Ekran

Cari içindeki takip paneli ilgili carinin tüm geçmişini getirir. Günlük iş listesi menüye eklendi; bugün/gecikenler, açık itirazlar, tüm kayıtlar ve yalnız bana atananlar filtreleri vardır. Yeni takip cari içinden açılır. Detayda görüşmeler ve işlem geçmişi, uygun rol/modda düzenleme ve görüşme formları bulunur. Pasif sorumlu, geciken işlem ve kapalı durum görünür.

Geçici hatada form taslağı korunur. 403/409'da otomatik yeniden gönderim engellenir; kullanıcı güncel kaydı inceleyip işlemi yeniden açar. Taslak bileşen belleğindedir; sayfadan ayrılmada kalıcı değildir. Yenileme sırasında eski liste kaldırılır; hata boş sonuç gibi gösterilmez. Cari/sorumlu/görünüm ve detay kimliği ile kayıt durumu/alanları istemcide doğrulanır; gerçek API yanıtı da bu doğrulayıcıdan geçirilir.

## Kalan kapsam

Ödeme sözü ile takip cari üzerinden yan yana izlenir; doğrudan söz–takip/fatura itiraz dosyası bağı henüz yoktur. Gecikmiş sözlerden otomatik iş üretimi, nakit planında sözün aynı faturanın beklenen tarihine uygulanması, kontrollü bildirim, gerçek şirket pilotu ve üretim kapasitesi kabulü sonraki dilimlerdir. F02 paketi tamamlanmış sayılmıyor.

## Doğrulama

Toplam **289 ayrı test** geçti:

- 93 API birim testi: 18 takip/görüşme sözleşmesi, 50 ödeme sözü uzlaştırma ve 25 ödeme sözü/ayar testi.
- 123 web birim testi: 17 yeni takip kapsamı, görünüm, tarih, durum ve rol sınırı testi dahil.
- 47 geçici PostgreSQL/HTTP testi: 19 yeni takip senaryosu ve 28 mevcut ödeme sözü senaryosu. Yeni testler RLS/FORCE RLS, iki bağlantıda tekrar, görüşme/sonlandırma yarışı, audit hatasında atomik geri alma, immutable not, 51 kayıtta cursor, rol/şirket modu ve gerçek controller/guard'ı kapsar. Gerçek yanıtlar web doğrulayıcılarından da geçirilir. JWT oturum açma testi değildir; test kimliği middleware ile verilir. Veritabanı koşu sonunda silinir.
- 26 üretim Chromium senaryosu: 10 yeni takip/günlük iş listesi ve 16 mevcut ödeme sözü regresyonu. Tarayıcı testleri gerçek üretilmiş arayüzü, yönlendirilmiş sentetik API yanıtlarıyla çalıştırır; gerçek şirket pilotu değildir.

Prisma şeması doğrulandı ve güncel istemci üretildi. Web üretim derlemesi geçti: `.next-f02-takip-release-20261015`, BUILD_ID `fWeu2AarKXCC6q-5giqTd`. Yeni controller/servis bağımlılıklarının bağımsız strict TypeScript kontrolü geçti. Next'in oluşturduğu `next-env.d.ts` referansı önceki `.next` yoluna geri alındı.

```sh
# apps/api
pnpm exec prisma validate
pnpm exec prisma generate
pnpm exec vitest run src/cari/tahsilat-takibi.semalar.test.ts src/cari/odeme-sozu-uzlastirma.test.ts src/cari/odeme-sozu.semalar.test.ts --maxWorkers=1 --no-file-parallelism
node scripts/f01-yaris-kabul.mjs --f02

# apps/web
pnpm test --maxWorkers=1 --no-file-parallelism
NEXT_DIST_DIR=.next-f02-takip-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F02_TAKIP_DIST=.next-f02-takip-release-20261015 pnpm exec playwright test --config playwright.tahsilat-takibi.config.ts --max-failures=1
F02_TEST_DIST=.next-f02-takip-release-20261015 pnpm exec playwright test --config playwright.odeme-sozu.config.ts --max-failures=1
```
