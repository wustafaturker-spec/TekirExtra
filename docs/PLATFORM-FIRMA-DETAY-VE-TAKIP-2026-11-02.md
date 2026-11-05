# Firma detay ve takip teslimi

İlgili program: [FR-03/04 ve FR-02 takip görünümü](PLATFORM-GELISTIRME-IMALAT-PROGRAMI-2026-11-02.md). İsterler: PLT-50–53. Durum: uygulandı ve doğrulandı. Mevcut yerel/üretim veritabanına migration uygulanmadı.

## Kullanım

- Firma listesinde **Detay**, `/platform/firmalar/[id]` çalışma alanını açar; dönüş bağlantısı liste filtrelerini korur.
- Genel bilgiler, takip, iç notlar, bağlı görevler, abonelik ve ödemeler, işlem geçmişi aynı sayfada bölüm bağlantılarıyla sunulur. Tarihsel kullanım ve duyurular ilgili teslimlerde eklenecektir.
- Eski `?firma=` pencereleri korunur. Penceredeki **Firma detayını aç** bağlantısı kalıcı sayfaya gider.
- Takipte sorumlu, durum ve görüşme günü tutulur. Tarihi geçmiş açık/bekleyen kayıtlar `goster=takibiGeciken`; sorumlusu pasif, davetli veya editöre dönüşmüş kayıtlar `goster=sorumluUygunDegil` ile süzülür.
- İç notlar eklemelidir; düzeltme yeni notla yapılır. Not metni, yazarı ve Türkiye saatindeki kayıt zamanı görünür.
- **Firma görevi oluştur**, mevcut görev merkezini platform kapsamı ve firma kimliğiyle açar. Bağ oluşturulduktan sonra görev düzenlemesinde değiştirilmez; görevler çoğaltılmaz.

## API

Tüm uçlar platform yöneticisi oturumu ister. Mevzuat editörü firma verisini ve bu olayları alamaz.

| Yöntem | Yol | Sözleşme |
|---|---|---|
| GET | `/platform/firmalar/takip-sorumlulari` | Aktif, kurulumu tamamlanmış yöneticiler |
| GET | `/platform/firmalar/:id/takip` | Kayıt yoksa sürüm 0; olmayan firmada 404 |
| PATCH | `/platform/firmalar/:id/takip` | `sorumluId`, `durum`, `sonrakiGorusme`, `surum`; eski sürümde 409 |
| GET | `/platform/firmalar/:id/notlar?sayfa=1` | 25 kayıtlık kararlı sayfalama ve toplam |
| POST | `/platform/firmalar/:id/notlar` | `metin`, UUID `islemAnahtari`; tekrar aynı notu döndürür |
| GET | `/platform/firmalar/:id/olaylar?sayfa=1` | Firma kimliğiyle ilişkilendirilmiş platform denetim olayları |
| GET | `/platform/gorevler?firma=<UUID>` | Mevcut yetki kapsamı içinde firmaya bağlı görevler |
| POST | `/platform/gorevler` | İsteğe bağlı `tenantId`; yalnız platform kapsamında |

## Güvenlik ve tutarlılık

- Yeni takip/not tablolarında kiracı uygulama rolüne yetki yoktur; RLS/FORCE ve yalnız platform rolüne politika vardır. Görev tablosu da aynı platform politikasına alınır.
- Firma varlığı dar `platform_firma_adlari` işleviyle kontrol edilir; platforma tenant tablolarını doğrudan okuma izni verilmez.
- Takip ilk oluşturma/güncellemesi tenant bazlı kilitle ve sürümle korunur. Atama, kullanıcı yetki değişimiyle aynı global kilit sırasını kullanır.
- Sorumlunun sonradan pasife alınması/rol değişmesi geçmiş atamayı silmez; yeniden atama uyarısı verir. Yeni atama aktif yönetici gerektirir.
- Not tekrar koruması veritabanı benzersiz kısıtındadır; iki eşzamanlı istek tek kayıt/tek denetim üretir. Farklı metinle aynı anahtar reddedilir.
- Takip/not yazımı denetimle atomiktir. Denetim yazılamazsa işlem geri alınır. Not metni denetim olayına taşınmaz.
- Çakışmada form taslağı korunur; kullanıcı güncel kaydı görüp güncel değerleri veya kendi taslağını seçer. Başka bölümün yenilenmesi yazılmamış notu silmez.

## Migration ve geçiş

`20261103110000_platform_firma_takip`, mevcut `20261103090000_kiraci_bag_denetimi` sonrasına sıralanmıştır. Tarih adı uygulama tarihi taahhüdü değildir.

Yeni web/API sürümü açılmadan önce migration uygulanmalı ve Prisma istemcisi üretilmelidir. Yeni alanlar eklemelidir; mevcut görevler `tenant_id=NULL` kalır. Eski sürüme dönüşte yeni sütunlar/kayıtlar silinmez. Mevcut firma listesinin yeni sorgusu takip tablosunu kullandığından API güncellemesini migration'dan önce yayınlamak uygun değildir.

Kabul için `node apps/api/scripts/platform-firma-kabul.mjs` kullanılır. Betik rastgele adla tek kullanımlık PostgreSQL açar, tüm migration'ları uygular, kabul testlerini çalıştırır ve yalnız kendi konteynerini kaldırır. Yerel `.env` veritabanına migration uygulamaz. Bu geçici veritabanında `fsync`/`synchronous_commit` kapalıdır; transaction, yarış ve rol kontrolleri doğrulanır, güç kesintisi sonrası kalıcılık testi yapılmaz.

## Sınırlar ve sonraki işler

- İşlem geçmişi, denetim olayında firma kimliği bulunan kayıtları gösterir. Eski abonelik geçmişi mevcut abonelik bileşeninde görünür; tüm ödeme/iade/bağlantı olaylarını tek zaman çizelgesinde birleştirme FR-05'te sürer.
- Firma profili mevcut kullanıcı sayısı ve son girişi gösterir; günlük modül kullanımı IS-01–03 kapsamında geliştirilecektir.
- Ekranlarda yeni ödeme veya iade uygulaması oluşturulmadı; mevcut bileşen paylaşıldı.

## Doğrulama kaydı

| Kontrol | Sonuç |
|---|---|
| Takip controller'ı, firma filtresi/servisi, görev ve platform kullanıcı servisleri | 58 birim testi geçti |
| Tek kullanımlık PostgreSQL, tüm migration'lar | Başarıyla uygulandı; takip 9, sayfalama 8, firma yönetimi 4, görev aktarımı 4, olay görünürlüğü 3 ve RLS kapsaması 3 olmak üzere 31 kabul testi geçti |
| Yeni kalıcı detay, çakışma, not tekrar denemesi, firma görevi, mobil ve iki ayrı ödeme | 6 Chromium senaryosu geçti |
| Önceki firma listesi, görev merkezi, listeler, ödeme raporu ve iade | 23 Chromium regresyon senaryosu geçti |
| Yeni görev parametresinin kayıt sonrası temizlenmesi | İlgili Chromium senaryosu yeniden koşuldu ve geçti |
| Prisma schema doğrulaması | Geçti |
| API genel TypeScript kontrolü | 4096 MB Node heap sınırıyla geçti |
| Web TypeScript kontrolü | Geçti |
| Değişen uygulama dosyalarında ESLint ve `git diff --check` | Geçti |

Tarayıcı senaryoları API'yi taklit eder; SQL davranışı ve yetkiler ayrıca gerçek PostgreSQL rolleriyle doğrulanır. İlk geniş koşuda sistem kaynak/disk beklemeleri nedeniyle zaman aşımına uğrayan eski testler son tam veritabanı koşusunda geçti.

Tarayıcı komutları:

```sh
pnpm --filter @tekirextra/web exec playwright test --config playwright.platform.config.ts e2e/platform-firma-detay.spec.ts --timeout 120000
pnpm --filter @tekirextra/web exec playwright test --config playwright.platform.config.ts e2e/platform-firma-sayfalama.spec.ts e2e/platform-listeler.spec.ts e2e/platform-odeme-raporu.spec.ts e2e/platform-gorev.spec.ts --timeout 120000
```
