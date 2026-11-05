# Firma büyümesi ve deneme dönüşümü

Program: [T2 / IS-02](PLATFORM-GELISTIRME-IMALAT-PROGRAMI-2026-11-02.md). İstatistik ekranının ikinci teslimidir. Mevcut ortama migration/yayın uygulanmadı.

## Ekran

`/platform/istatistikler` içinde **Büyüme ve deneme dönüşümü** bölümü eklendi. Mevcut tarih, paket ve firma filtrelerini kullanır. Yaşam döngüsü ölçümünün başlangıcı, gözlem anı, eksik geçmiş ve devam eden gün açıklanır.

| Gösterge | Tanım |
|---|---|
| Dönem başı firma | Türkiye'de başlangıç günü 00:00'dan hemen önce mevcut firma kaydı |
| Dönem sonu firma | Bitiş gününün ertesi 00:00'dan hemen önce mevcut firma; bugün için rapor anı |
| Yeni firma | Aralıkta gözlenen firma oluşturma olayı |
| Silinen firma | Aralıkta gözlenen firma silme olayı |
| Net firma değişimi | Dönem sonu eksi dönem başı firma |
| Aboneliği iptale geçen firma | Aralıkta iptal durumuna geçen farklı firma; tekrar iptal aynı dönemde çoğaltmaz |

Firma sayısı abonelik aktifliği değildir. İptal, firma kaydı durdukça firma sayısını azaltmaz. Firma silinse de eski sayısal yaşam geçmişi saklanır. Geçmişe tarihli `created_at` verilmesi, yeni gözlem olayını geçmiş güne taşımaz.

Paket filtresi **her dönemin sonundaki paketle** sabit firma kümesi seçer. Silinen firmalarda son bilinen paket kullanılır. Dönem başı dahil tüm büyüme metrikleri bu kümeyi kullanır; günlük kullanımın gün bazındaki paket kapsamından farklıdır. Böylece bugünkü paket değişikliği kapalı geçmiş dönemi değiştirmez. Önceki eşit dönem kendi dönem sonu kapsamıyla hesaplanır.

## Deneme kohortu

Kohort, seçili dönemde **ilk denemesine başlayan yeni firmalardır**. Yeni firma, yaşam döngüsü ölçümü başladıktan sonra oluşturma olayı gözlenen firmadır. Başlangıç fotoğrafında bulunan firmaların önceki deneme/ödeme geçmişi bilinmediğinden bunlar kohorta katılmaz.

- Deneme başlangıcı, aboneliğin `deneme` durumuna ilk girişidir. Tekrarlanan deneme aynı firmayı çoğaltmaz.
- Deneme öncesinde gözlenmiş pozitif abonelik ödemesi olan firma yeni deneme müşterisi kabul edilmez.
- Dönüşüm, başlangıç anı dahil sonraki **14 gün içinde**, üst sınır hariç, pozitif tutarlı bir `abonelik_odemeleri` kaydıdır.
- Elle ve sağlayıcı ödemeleri dahildir. Başarısız ödeme girişimleri, sıfır tutar ve yalnız `aktif` durum dönüşüm değildir.
- Birden fazla ödeme firmayı bir kez dönüştürür. Sonraki iade ilk ödeme olayını geri almaz; bu metrik net gelir veya elde tutma oranı değildir.
- **Payda:** rapor anında 14 günlük gözlem süresini tamamlayan firmalar. **Pay:** bunlardan ilk 14 günde dönüşenler.
- 14 günü dolmayan firma ödeme yapmış olsa da paya/paydaya eklenmez; **gözlem süresi beklenen** sütunundadır.
- Payda sıfırsa oran `—`; yeterli gözlemi olup hiç dönüşmeyen kohortta `%0` gösterilir.
- Seçili dönem denemeye başlama tarihidir. Dönüşüm gözlemi dönem bitişinden sonraki 14 güne uzanabilir; rapor anı görünür. Önceki eşit dönem de aynı pencereyi kullanır.

Mevcut kayıt akışı yeni aboneliği `aktif` açıyorsa bu firma otomatik deneme kohortuna sokulmaz. Deneme politikası/paket değişikliği bu teslimin parçası değildir.

## Ölçüm geçmişi ve güvenilirlik

Migration: `20261103150000_platform_buyume_olcumu`. Önceki firma takip ve istatistik migration'larından sonra uygulanır.

Mevcut `abonelik_degisiklikleri` bütün yazım yollarını kapsamadığından geçmiş dönüşüm bu kayıtlardan tahmin edilmedi. Migration kaynak tablolara yazma kilidi alır; başlangıç fotoğrafı ve tetikleyicileri tek transaction'da kurar. Başlangıç anındaki firmalar `baslangic` olayıyla kaydedilir, yeni kayıt/deneme gibi sayılmaz. Eski ödemeler geriye doldurulmaz.

| Parça | İşlev |
|---|---|
| `platform_buyume_ayari` | Kesin UTC ölçüm başlangıç anı |
| `platform_firma_yasam_olaylari` | Firma/abonelik değişiminde mevcutluk, paket, durum ve sayım işaretleri |
| `platform_buyume_odemeleri` | Pozitif ödemenin yalnız referansı, firma ve gözlem anı |
| Kaynak tetikleyicileri | Firma oluşturma/silme, abonelik paket/durum değişimi, pozitif ödeme oluşturma |
| `platform_buyume_raporu` | Aralığı doğrulayan, yalnız toplamlardan oluşan dış rapor |
| `platform_buyume_donemi` | Doğrudan erişime kapalı dönem hesaplama yardımcısı |

Kaynak işlem geri alınırsa ölçüm olayı da geri alınır. Sadece dönem sonu/ödeme kilidi gibi alanların güncellenmesi yeni abonelik yaşam olayı üretmez. Aynı milisaniyedeki durum ve ödeme olayları ortak sıra numarasıyla ayrılır. Ekran büyüme sayıları için günlük worker'ı beklemez; yaşam olayları doğrudan tutarlı okuma transaction'ında özetlenir. Günlük kullanımın yeniden hesaplanması yaşam geçmişini değiştirmez.

Gün sınırları `Europe/Istanbul` ile hesaplanır. Ölçüm gün ortasında başladıysa o günün tam büyüme değerleri bilinmiyor kabul edilir. Başlangıcı ölçüm anından önce olan seçili/önceki dönemin bütün büyüme/kohort değerleri `null` döner; kısmi veri tam sonuç gibi gösterilmez. İlk tam rapor günü ölçüm başlangıcından sonraki Türkiye günüdür. Bugün içeren döneme yüzde karşılaştırması yapılmaz.

Rapor en çok 93 gün ve eşit uzunlukta önceki dönem içerir. Yeni tablolar RLS/FORCE ve kapalı politika kullanır. Uygulama ve platform rolleri ham geçmişi, ödeme referanslarını veya ayarı okuyamaz/yazamaz. Yalnız kaynak tetikleyicileri yazar, yalnız platform rolü dış toplama işlevini çağırır. API'ye isim, kullanıcı kimliği, ödeme kimliği, tutar veya kaynak içeriği eklenmez. Mevcut yönetici erişimi geçerlidir; editör erişemez.

## Doğrulama

Prisma doğrulama/istemci üretimi, API/web TypeScript ve değişen dosyalarda lint kontrolleri yapıldı. Gerçek PostgreSQL kabulü; tarih/paket kapsamı, iptal tekilliği, ödeme penceresi, olgunlaşmamış kohort, silme sonrası geçmiş, rollback, kiracı rolündeki tetikleyici ve UTC 21:00 gün sınırını kapsar. Tarayıcı kabulü taklit API yanıtlarıyla görünüm, filtre, eksik veri ve payda gösterimini doğrular; SQL ve rol kontrolleri gerçek PostgreSQL'de ayrı çalışır.

Son geniş koşuda 47 PostgreSQL kabul testi (9 yeni büyüme testi dahil) ve 9 Chromium senaryosu geçti. İlk tarayıcı koşusunda editör yönlendirmesi soğuk hedef sayfa derlemesinin 5 saniyelik assertion sınırını aşması nedeniyle zaman aşımına düştü; erişim engeli ve API çağrılmaması korunurken hedef yönlendirmeye 15 saniye tanındı. Son 9 senaryolu koşu tamamen geçti. Mobil taşma ve klavye akışı da bu koşudadır. API/web tip kontrolleri, Prisma doğrulama/üretimi ve ESLint temizdir.

```sh
node apps/api/scripts/platform-firma-kabul.mjs
pnpm --filter @tekirextra/web exec playwright test --config playwright.platform.config.ts e2e/platform-istatistik.spec.ts --timeout 120000
```

## Kalan işler

IS-03'te güvenilir hiç başlamayan ayrımı, IS-04'te bekleyen işler ve tarihsel operasyon eğilimleri sürer; T2 bütünü tamamlandı sayılmaz. Büyüme/kohort için firma bazında tarihsel ayrıntı ve dışa aktarma ek kapsam olarak ileride alınabilir. Paket kataloğu ve duyuru sistemi sonraki aşamalardır.
