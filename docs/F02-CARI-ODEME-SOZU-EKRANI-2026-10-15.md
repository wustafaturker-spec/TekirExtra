# F02 — Cari detayında ödeme sözü ekranı

Sonraki teslim: [Kalıcı takip, görüşme, sorumlu ve günlük iş listesi](F02-TAKIP-GORUSME-VE-IS-LISTESI-2026-10-15.md). Aşağıdaki metin ödeme sözü ekranının tarihli teslim kapsamıdır.

15 Ekim 2026. [Kalıcı ödeme sözü servislerinin](F02-KALICI-ODEME-SOZU-SERVISLERI-2026-10-15.md) cari ekranına bağlantısı çalışma alanında uygulandı. Kullanıcı cari detayındaki **Tahsilat** sekmesinde söz geçmişini ve güncel gerçekleşmeyi okuyabilir; yetkili rol ve şirket modunda söz oluşturabilir, revize edebilir veya gerekçeyle iptal edebilir. Canlıya yayın, gerçek şirkette açılış veya migration uygulaması yapılmadı.

## Kullanıcı akışı

- Tahsilat sekmesi yönetici, muhasebe, mali müşavir ve salt okunur rollerine görünür. Sekme açılmadan ödeme sözleri çağrılmaz. Satış rolünde sekme ve bu finans isteği yoktur.
- Yönetici/muhasebe, pilot veya açık modda yazabilir. Salt okunur şirket modunda yöneticiye de yazma eylemi gösterilmez. Mod/rol doğrulamasının asıl sınırı mevcut API servisidir.
- Geçmişte fatura bağlantısı, söz günü, veriliş zamanı, tutar/döviz, açıklama, gerçekleşen, sözden kalan ve durum gösterilir. Revizyon/iptal gerekçesi korunur. İptal/revize satırlarında gerçekleşen/kalan yerine çizgi gösterilir; özgün söz tutarı yeni alacak olarak sunulmaz.
- Yeni söz için mevcut `/fatura` listesi yalnız seçili cari, kesin durum ve satış tipiyle çağrılır. Borcu kalmayan veya zaten mantıksal aktif sözü bulunan faturalar seçilemez. Döviz faturadan gelir; kur dönüşümü yapılmaz.
- Fatura seçimi 50'lik sayfalarla ilerler; ilk sayfada uygun kayıt bulunmasa da sonraki sayfa yüklenebilir. Seçim en fazla ilk 20 sayfayı/1.000 faturayı tarar; kalan sayfa varsa sınır açıkça gösterilir. Tekrarlanan imleç hata sayılır. Bu ilk seçim ekranında metinle arama/tarih filtresi henüz yoktur.
- Tutar virgül veya noktayla en fazla iki ondalık olarak girilir. Binlik ayırıcı ve bilimsel yazım reddedilir. Örnek `1250,50` sunucuya `1250.50` olarak gider. Kuruş karşılaştırması `BigInt`, gösterim metin üzerinden yapılır; büyük tutarda bir kuruş kaybolmaz.
- Söz günü Türkiye takvimine göre geçmişte olamaz. Güncel fatura kalanı API'de yeniden doğrulanır; ekranda okunan kalan anlık kaynak garantisi değildir.
- Revizyon eski sözün tutarını/tarihini değiştirmez; yeni veriliş zamanından önceki ödemenin yeni sözde sayılmayacağı formda açıklanır. İptal ayrı form, gerekçe ve açık onay düğmesi ister.

## Hata ve tekrar davranışı

Oluşturma/revizyonda aynı içerikle yeniden deneme aynı UUID `istekAnahtari` ve `Idempotency-Key` başlığını kullanır. Başlık/gövde anahtarı aynıdır. Bekleyen yazımda ikinci gönderim ve formun Vazgeç düğmesi kapatılır. Başarılı yazımdan sonra sözler sunucudan yeniden okunur; gerçekleşme istemcide tahmin edilmez.

409 sürüm/tekillik çatışması veya 403 erişim değişikliğinde taslak korunur ve gönderim durdurulur. Kullanıcı listeyi yenileyip güncel kaydı incelemeli ve işlemi yeniden açmalıdır; sürüm sessizce güncellenip taslak otomatik gönderilmez. Geçici bağlantı/503 hatasında taslakla aynı içerik yeniden denenebilir. Taslak yalnız bileşenin belleğindedir; sekmeden/cari sayfasından ayrılma veya tarayıcı yenilemesi sonrasında kalıcılık taahhüdü yoktur.

Liste yenilenirken eski finans tablosu kaldırılır; hata boş geçmişe çevrilmez. Yeni yanıtın cari kimliği, mod, kayıt kimlikleri, sürüm, döviz, sabit ondalık tutarlar, gerçekleşme + kalan toplamı ve durum tutarlılığı kontrol edilir. Uyuşmazlıkta tablo ve yeni yazma eylemi açılmaz. Gerçek API yanıtı da bu tarayıcı sözleşmesinden geçirilerek kabul testinde doğrulandı.

Cari değişince söz bileşeni kimliğe göre yeniden kurulur. Kapanmış bileşenin ve önceki fatura isteğinin geç gelen yanıtları yeni formu değiştirmez. Fatura okuma hatası ayrı gösterilir; not/tutar taslağı korunur ve seçim yeniden denenebilir.

## Kaynak sınırı

API'nin gün hassasiyeti uyarısı, şirket modu ve ölçüm zamanı gösterilir. Aynı gün söz/ödeme sırası kanıtlanamıyorsa otomatik gerçekleşme sayılmadığı saklanmaz. Hedef taslak/iptal olmuşsa geçersiz kaynak durumu gösterilir; eski gerçekleşme tahsil edilmiş gibi sunulmaz. Ekran yalnız ödeme sözü uçlarına yazar; mali denkleştirme, fatura, ödeme, e-posta veya SMS oluşturmaz.

Bu teslimde şirket açılış ayarı değiştirilmedi ve Modül Ayarları ekranına açılış kartı eklenmedi. Önceki servis teslimindeki varsayılan kapalı davranışı sürer.

## Doğrulama

Toplam **150 ayrı test** geçti:

- 106 web birim testi: 36 yeni ödeme sözü para/tarih/yanıt sözleşmesi testi dahil.
- 28 geçici PostgreSQL/HTTP testi: gerçek API yanıtının yeni web doğrulayıcısıyla uyumu da kontrol edildi. Test veritabanı koşu sonunda silindi.
- 16 üretim Chromium testi: isteğe bağlı sekme yükleme, oluşturma, revizyon, iptal, rol/mod kısıtları, 409'da taslak, 503'te aynı anahtar, hatalı cari yanıtı, fatura okuma hatası, tutar sınırı, bekleyen yazımda tekrar engeli ve sayfalama.

Tarayıcı testleri gerçek üretilmiş Next.js arayüzünü çalıştırır; API yanıtları yönlendirilmiş sentetik veridir. Gerçek DB/servis/rol guard doğrulaması ayrı 28 senaryodur; canlı şirket üzerinde uçtan uca pilot değildir.

Web üretim derlemesi geçti: `apps/web/.next-f02-soz-release-20261015`, BUILD_ID `JHuUFSntyDlZq0KZUHJ_D`. API üretim kodu değişmediği için önceki tam API derlemesi tekrarlanmadı. Next'in ürettiği `next-env.d.ts` referansı önceki `.next` yoluna geri alındı.

```sh
# apps/web
pnpm test --maxWorkers=1 --no-file-parallelism
NEXT_DIST_DIR=.next-f02-soz-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F02_TEST_DIST=.next-f02-soz-release-20261015 pnpm exec playwright test --config playwright.odeme-sozu.config.ts --max-failures=1

# apps/api
node scripts/f01-yaris-kabul.mjs --f02
```

F02-02 ve F02-03 devam ediyor. Takip/görüşme/itiraz kayıtları, sorumlu ve sonraki işlem, günlük operasyon listesi, nakit planı ve kontrollü bildirim bağlantıları henüz uygulanmadı. Gerçek şirket pilotu ve tam F02 kabulü bekliyor.
