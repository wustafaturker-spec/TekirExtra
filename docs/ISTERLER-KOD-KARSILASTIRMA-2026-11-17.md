# İSTERLER — kod karşılaştırması

Tarih: 2026-11-17. Kaynak: çalışma ağacındaki `docs/ISTERLER.md`, API/web kaynakları, Prisma şeması, entegratör paketi ve ilgili testler.

**Takip teslimi:** kullanıcının seçtiği END-08/10/16/23/26 maddeleri bu incelemeden sonra uygulandı. Güncel davranış ve doğrulama [tamamlama kaydında](ENDEKS-TAMAMLAMA-2026-11-17.md); aşağıdaki bulgular inceleme anının kaydıdır.

## Kapsam ve sonuç

Dokümanda tablo biçiminde 916 benzersiz ister kimliği bulunuyor; bunlara tablo dışındaki NFR maddeleri dahil değil. Bu inceleme 916 maddenin tamamının uçtan uca kabulü değildir. Önceki doküman incelemesindeki bulguların kod karşılıkları, e-belge sağlayıcıları, yedekleme, fiyat/endeks analizi, fiyat güncelleme/onay yolları ve AI değerlendirme testleri incelendi. Kaynakta bulunmak, üretimde kurulu ve canlı sağlayıcıyla doğrulanmış olmak anlamına gelmez.

Ana sonuç: temel modüller ve önemli korumalar uygulanmış; bazı isterler gerçekten eksik, bazıları ise sonraki kararla değişmiş ama eski metni korunmuş. Bu iki durum ayrı izlenmelidir.

## 1. Yüksek: dört e-belge sağlayıcısı için gerçek adaptör yok

- İster: EBLG-01, A-01 ve §6 senaryo 6; özellikle İzibiz, Foriba, eLogo ve Uyumsoft.
- Kanıt: `apps/api/src/tenant/baglantilar.service.ts:28` gerçek adaptör haritasında yalnız `sovos` ve `nes` var. `:197` civarındaki çözümleyici diğerlerini geliştirmede mock'a yönlendiriyor; üretimde mock izni yoksa reddediyor. `packages/baglanti/src/index.ts` de yalnız Sovos ve NES gerçek adaptörlerini dışarı veriyor.
- Etki: enum'da bulunmaları gerçek entegrasyon desteği sağlamıyor. Dokümandaki Foriba/İzibiz kabul örneği mevcut varsayılan üretim davranışıyla tamamlanamaz. Foriba ile Sovos'un aynı hizmet olarak kabul edilip edilmeyeceği ayrıca karara bağlanmalı; kod `foriba` anahtarını Sovos'a yönlendirmiyor.
- Öneri: güncel destek sözleşmesi Sovos/NES olarak onaylanıp eski kararlar yürürlükten kaldırılmalı veya eksik adaptörler ayrı açık teslimler olarak izlenmeli. Mock ile geçen test canlı kabul sayılmamalı.

## 2. Yüksek: dış yedek ve şifreleme uygulanmamış

- İster: PLT-114/115/117.
- Kanıt: `scripts/yedekleme/yedek-ajani.sh:78` yerel PostgreSQL/rol/MinIO arşivleri üretir. Bu servis ve `apps/api/src/yedekleme/` içinde dış depoya aktarım veya yedek dosyasını şifreleme yolu bulunmadı. `yedek-kurallari.ts:69` dış kopya gelene kadar yıllık yedekleri yerelde tutar.
- Etki: sunucunun ve yerel yedeklerin birlikte kaybında dış kopyadan kurtarma bu kodla sağlanmıyor. Yerel yedeklemenin tamamlanmış olması PLT-115'i kapatmıyor.
- Durum: bölüm girişinde erteleme açıkça belirtilmiş; PLT-114'ün tamamlandı işareti yalnız yerel teslim için geçerli sayılmalı.

## 3. Orta: yedek ekranının dış kopya durumu eksik

- İster: PLT-113, listede dış kopya durumunu ister.
- Kanıt: `apps/api/src/yedekleme/yedekleme.service.ts:100` satır görünümünde yerel durum ve geri yükleme denemesi bulunuyor; dış kopya alanı yok. `yedek-kurallari.ts:95` alarm girdileri de dış kopya sonucunu kapsamıyor.
- Öneri: dış kopya teslimine bağlı açık iş olarak tutulmalı. Henüz desteklenmeyen durum, başarılı kopya gibi sunulmamalı.

## 4. Orta: açılışta kaçırılmış yedek için saat sınırı var

- İster: PLT-111, sunucu 04:00'te kapalıysa açılışta yedek alınmasını ister.
- Kanıt: `apps/api/src/yedekleme/yedek-kurallari.ts:22` İstanbul saati 04:00'ten önce koşulsuz `null` döner. Planlayıcı `yedekleme.service.ts:40` bugünün yedeğini ister; kaçırılmış önceki günü telafi eden ayrı yol yok.
- Örnek: bir önceki günün 04:00 yedeği kaçırılıp sunucu ertesi gün 02:00'de açılırsa, açılışta değil 04:00 sonrasında talep oluşur.
- Öneri: son başarılı yedeğin yaşına göre açılış telafisi tanımlanmalı veya isterde bu istisna açıklanmalı.

## 5. Orta: fiyat önerisi genel onay akışına bağlı değil

- İster: END-16, onay kuralı varsa ONY akışına girmesini ister.
- Kanıt: `apps/api/src/onay/onay-kurallari.ts:7` izinli onay işlemlerinde fiyat listesi değişikliği yok. `apps/api/src/fiyat-listeleri/fiyat-listeleri.service.ts:145` kalemi doğrudan upsert eder. `apps/web/src/components/endeks-fiyat-onerisi.tsx:61` civarı kullanıcı onayından sonra kalemleri ayrı isteklerle yazar.
- Etki: ekrandaki onay, talep eden ve onaylayan ayrımını sağlayan ONY onayı değildir. END-16'nın teslim notu da bu farkı kabul ediyor.
- Öneri: ONY bağlantısı açık iş olmalı veya güncel ister açıkça yalnız uygulayan kullanıcının önizleme/onayını istemeli.

## 6. Orta: kur karşılaştırmasında satış kuru seçeneği yok

- İster: END-08.
- Kanıt: `apps/api/src/fiyat-endeks/fiyat-endeks-veri.ts:14` serileri alış kuru olarak adlandırır; `:111` yedek sorgusu `AVG(doviz_alis)` kullanır. `fiyat-endeks.service.ts:19` ve `fiyat-endeks.controller.ts:49` sorgu sözleşmesinde alış/satış kuru seçimi yok.
- Durum: hesaplama ve alış kuru desteği mevcut; satış kuru seçeneği eksik. Tamamlandı işareti bütün ister için doğru değil.

## 7. Orta: birim kırılması tarihçesi ve doğrulaması eksik

- İster: END-10 ve END-24, birim değişikliğinde seri kırılması ve bunun testini ister.
- Kanıt: `apps/api/src/fiyat-endeks/fiyat-endeks-veri.ts:71` dönüşümü stok kartının mevcut ana birimi ve mevcut `stok_birimleri.katsayi` üzerinden yapar; karşılaştırma çıktısında tarihli birim kırılması üretilmez. Mevcut kabul testi sabit `koli=12` örneği ve tanımsız birimin dışlanmasını kapsar; tarihsel katsayı değişikliği senaryosunu kapsamıyor.
- Önemli korumalar: `apps/api/src/stok/stok.service.ts:579` hareketli kartta ana birim değişikliğini engeller; `:728` belgede kullanılan ek birimi sildirmez. Bu nedenle normal kullanıcı akışında geçmiş sonuçların bozulduğunu doğrulanmış hata olarak sınıflandırmıyorum.
- Öneri: mevcut korumalar kabul testine bağlanmalı; geçmiş birim değişikliği desteklenecekse belgeye dönüşüm katsayısı veya tarihçeli birim kaydı eklenmeli.

## 8. Orta: endeks yetkisi özel rol matrisindeki iki bağımsız izin değil

- İster: END-23.
- Kanıt: `apps/api/src/fiyat-endeks/fiyat-endeks-erisim.ts:18` iki temel rol listesi saklar. `:49` erişimi temel role göre hesaplar; özel rol üstten Raporlar kutusuyla daraltılır.
- Etki: aynı temel rolü paylaşan iki özel role, bu mekanizmayla bağımsız satış/alış endeks izinleri verilemiyor. Bu bir yetki sızıntısı tespiti değildir; istenen yetkilendirme ayrıntısı eksiktir.
- Durum: doküman teslim notu farkı açıklar; başlıktaki tüm END maddeleri bitti ifadesi bu kısmı kapsamamalı.

## 9. Düşük/orta: revizyon görevi ve seri kullanım sayısı yok

- END-04: `apps/api/src/fiyat-endeks/endeks-deposu.ts:51` revizyon geçmişi ve görülmedi durumunu yazar; platform görev kaydı oluşturmaz. Güncel alternatif, endeks ekranında uyarıdır.
- END-26: `apps/api/src/fiyat-endeks/platform-endeks.controller.ts:63` katalog/veri/revizyon sayılarını döndürür; seriyi kullanan kiracı sayısını döndürmez.
- Öneri: bunlar açık iş veya onaylanmış kapsam değişikliği olarak ayrı kaydedilmeli. Dokümandaki kısmi işaretler kodla uyumlu.

## 10. Doküman düzeltmesi: eksik uygulama sanılmaması gereken kararlar

| Konu | Kodda görülen | Dokümanda gereken |
|---|---|---|
| Personel, üretim, e-İrsaliye | `apps/api/src/app.module.ts` içinde modüller bağlı; e-belge gerçek adaptörlerinde irsaliye yolları var. | §1.2 güncel ürün kapsamından ayrılmalı. Modül varlığı tek başına tüm alt isterleri doğrulamaz. |
| ORM | API bağımlılığı ve şema Prisma. | §8'deki “Prisma veya TypeORM” kararı kapanmalı. |
| Yedekleme | Servis, planlayıcı ve geri yükleme deneme kodu mevcut. | 1899. satırdaki “zamanlanmış yedek yok” gerekçesi tarihsel not olarak işaretlenmeli. Canlı kurulum bu incelemede doğrulanmadı. |
| Endeks veri eşiği | `fiyat-endeks-hesap.ts:13`: 2 satır. | END-10'daki eski 5 ifadesi, bölümün sonraki 2 satırlık kullanıcı kararıyla uzlaştırılmalı. |
| PDF arşivi | `ebelge-gorunum.service.ts:121` sağlayıcıdan PDF alır veya XML'den üretir; arşiv alanındaki URL kalıcı PDF dosyası değildir. | EBLG-09 PDF arşivleme isterken EBLG-27 “PDF saklanmaz” der. Kod sonraki kararla uyumlu; eski ister güncellenmeli. |
| İdeaSoft/T-Soft | `packages/shared/src/entegrasyon-katalogu.ts:59` ve `:62`: ikisi de yakında; İdeaSoft adaptörü mevcut. | ETC-12'deki kısmi teslim ve canlı kabul bekliyor durumu korunmalı; kod yazılmış olması canlı kabul değildir. |

## Test doğrulaması

API dizininde şu hedefli komut çalıştırıldı:

```sh
./node_modules/.bin/vitest run src/fiyat-endeks src/yedekleme src/onay/onay-kurallari.test.ts src/ai/degerlendirme/degerlendirme.test.ts --maxWorkers=2
```

Sonuç: **14 dosya, 90 test geçti**. Endeks hesabı, EVDS istemcisi, öneri, artış hesabı, marj, reel hesap, yedek kuralları/servisi, onay kuralları ve değerlendirme düzeneği kapsandı. Gerçek model çağrısı yapılmadı.

İlk pnpm komutunda argüman aktarımı hedef filtrelerini uygulamadığı için genel birim koşusu başladı; kapsam dışında bir şema testi 5 saniye zaman aşımına uğradı. Koşu durduruldu ve yukarıdaki doğrudan hedefli komutla tekrarlandı. Genel test paketi başarılı sayılmadı; bu zaman aşımı doğrulanmış ürün hatası olarak raporlanmıyor.

Gerçek PostgreSQL kabul testleri, tarayıcı kabulü, canlı entegratör çağrıları, gerçek yedekten geri yükleme ve performans ölçümü bu incelemede çalıştırılmadı. Mevcut kabul dosyalarının bulunması başarı kanıtı sayılmadı. Özellikle `test/fiyat-endeks.kabul.test.ts` plan özelliğini taklit ettiği için tek başına gerçek paket ataması entegrasyonunu kanıtlamaz.

## Önerilen teslim sırası

1. Gerçek e-belge destek listesini ve kabul senaryolarını uzlaştır.
2. PLT-115 dış kopya/şifreleme ile durum ve alarm alanlarını tamamla.
3. Açılışta kaçırılmış yedek davranışını düzelt veya sözleşmesini netleştir.
4. END-16 ONY bağlantısı ve END-23 özel rol ayrımını karara bağla.
5. END-08/10/26 kalanlarını ve END-04 alternatif teslimini ayrı takip et.
6. Güncel isterlere test/kanıt ve canlı kabul durumunu bağla; modül başlığındaki toplu “bitti” ifadesi yerine madde bazında durum kullan.

Bu inceleme yalnız rapor ekler; uygulama kodunu ve onaylı isterleri değiştirmez.
