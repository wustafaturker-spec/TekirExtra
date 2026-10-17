# F01 — Önceki ölçümle karşılaştırma

15 Ekim 2026. Çalışma alanındaki web geliştirmesi. Gerçek şirket pilotu ve canlı yayın yapılmadı. API uygulama kodu veya veritabanı şeması değiştirilmedi.

## Kullanım

Satış Maliyet Kontrolü → **Dönem inceleme özeti → Önceki ölçümle karşılaştır** bölümünde daha önce indirilmiş JSON ölçüm dosyası seçilir. Dosya, ekrandaki güncel sunucu ölçümüyle karşılaştırılır. Önceki ve güncel değerler ile **güncel − önceki** farkı gösterilir.

Dosya tarayıcıda okunur; sunucuya gönderilmez, kalıcı tarayıcı deposuna yazılmaz. En fazla 64 KB UTF-8 JSON kabul edilir. UTF-8 BOM desteklenir. “Karşılaştırmayı temizle” seçimi ve tabloyu kaldırır. Yeni dosya seçilirken eski sonuç hemen kaldırılır; bozuk dosya, önceki başarılı sonucu ekranda bırakmaz. Dosyalar hızlı değiştirildiğinde eski okuma yeni seçimin üzerine yazamaz. Dönem özeti yenilendiğinde dosya yeniden seçilir.

## Uyum kuralları

Hem güncel API yanıtı hem önceki dosya sürüm 1 sözleşmesiyle doğrulanır. Alan adları/tipleri, şirket UUID'si, gerçek ve sıralı tarihler, en fazla 366 günlük dönem, ölçüm zamanı, kaynak kümesi özeti, mod, sayı sınırları ve temel toplam eşitlikleri denetlenir. Kayıt/satır sayıları 0–20.000 aralığındadır. Uyarı ve durum toplamı ile süre örneği/medyan tutarlı olmalıdır. Ciro iki, medyan saniye üç ondalık basamaklı string olmalıdır. Eksik/fazla alanlar ve desteklenmeyen sürümler kabul edilmez.

Güncel yanıtın dönemi istenen dönemle de eşleşmelidir. Geçersiz güncel yanıt, indirilebilir veya karşılaştırılabilir başarılı ölçüm gibi sunulmaz. Gerçek API'nin ilk/son F01 ölçüm yanıtları, HTTP kabulünde aynı web doğrulayıcısından geçirilir; sözleşme yalnız tarayıcı taklitlerine dayanmaz.

Karşılaştırma için:

- Şirket kimliği aynı olmalıdır; yalnız unvanın değişmesi engel değildir. UUID harf büyüklüğü normalize edilir.
- Satış başlangıç/bitiş tarihleri aynı olmalıdır.
- Kaynak satırı sayısı ve `kaynakKimlikOzeti` aynı olmalıdır. Aynı sayıda farklı satış satırı da karşılaştırmayı engeller.
- Önceki ölçüm zamanı güncel ölçümden eski olmalıdır. Aynı dosya veya ters zamanlı ölçüm baz sayılmaz.
- Kullanım modu değişebilir; pilot/açık/salt okunur farkı tabloda ayrıca belirtilir.

Kaynak özeti bulunmayan eski geliştirme dosyaları için kapsam tahmin edilmez. Uygulamadan geçerli dosya alınmalıdır. JSON alanları ve kaynak özeti bir dosya imzası değildir; düzenlenmiş ama biçimsel olarak geçerli bir dosyanın gerçek kaynaktan geldiği kanıtlanmaz. Karşılaştırma, dosyadaki değerleri kullanır ve mali kayıtları değiştirmez.

## Gösterilen farklar

Uyarı satırı/cirosu, aktif takipli ve takipsiz uyarılar, açık/incelemede/bekleyen kayıtlar, doğrulanmış/diğer kapanışlar, yoksayılmış kayıtlar, medyan süre ve süre örneği sayısı gösterilir. Örnek olmayan medyan `null` kalır; farkı “Hesaplanamadı” gösterilir. Yeni kapanış örneklerinin medyanı değiştirebileceği belirtilir. Bir fark, maliyet doğruluğu veya kâr artışı sonucu olarak etiketlenmez.

Ciro ve süre farkları sabit ondalık basamak üzerinden `BigInt` ile hesaplanır; büyük tutarlar `Number`a çevrilmez. Mevcut dönem özeti cirosu da string üzerinden biçimlenir. Örneğin `9007199254740993.12 → 9007199254740993.13`, tam `0.01 TRY` farkı verir. Negatif farklar ve kuruş taşıması korunur. Sayım farkları güvenli tam sayı aralığındadır.

## Kabul

38 yeni dosya/sözleşme ve karşılaştırma testi, web paketindeki toplam 70 birim testiyle birlikte geçti. Kapsam: bozuk/eksik/fazla alanlar, geçersiz tarihler, sayım/medyan tutarsızlığı, farklı şirket/dönem/kaynak, aynı/ters zaman, null medyan, büyük tutar/kuruş taşıması, UTF-8 boyut sınırı, BOM ve prototip anahtarı.

Gerçek PostgreSQL/Nest HTTP/JWT/RLS kabulü geçti; test kayıtları rollback edildi. API yanıtlarının web doğrulayıcısıyla kabul edildiği de bu koşumda kontrol edildi.

Web üretim derlemesi `.next-f01-karsilastirma-release-20261015`, build kimliği `3NOZldCJ4XMpSKX1_TGA2` ile geçti. Bu çıktı üzerinde 24 Chromium senaryosu geçti. Dört yeni senaryo büyük tutardaki 0,01 TRY farkını, dosya işleminin ağ yazması üretmemesini, bozuk seçim sonrası eski tablonun kaldırılmasını/temizlemeyi, şirket/kaynak uyuşmazlıklarını ve bozuk güncel yanıtın engellenmesini kapsar. Tarayıcı API yanıtları taklittir; gerçek HTTP sözleşmesi ayrıca çalıştırıldı.

Toplam **95 ayrı test** geçti: 70 web birim testi, 24 üretim Chromium senaryosu ve 1 gerçek PostgreSQL/HTTP kabulü. Tekrar koşular ayrıca sayılmadı; yalnız bu teslimde çalıştırılan kapsam sayılmıştır. `git diff --check` temizdir. Web derlemesinin ürettiği `next-env.d.ts` referansı başlangıç değerine geri getirildi. Gerçek şirket ayarları veya mali kayıtlar değiştirilmedi.

```sh
# apps/web
pnpm test --maxWorkers=1 --no-file-parallelism
NEXT_DIST_DIR=.next-f01-karsilastirma-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-karsilastirma-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts

# apps/api — gerçek yanıt/web sözleşmesi
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts
```

## Kalan işler

Gerçek pilot şirketi/kullanıcısı, gerçek baz/sonuç dosyaları ve muhasebe alan kabulü henüz yoktur. Kapsam değişmiş dosyaları zorla eşleme, dosyaya güvenerek otomatik veri yazma ve pilot başarı kararı bu teslimde eklenmedi. Gerçek trafik/hacim bütçesi, yayın adayı ve canlı yayın işleri sürer. F01 görevleri `devam_ediyor` kalır.

Önceki teslim: [Dönem inceleme özeti ve pilot ölçüm dosyası](F01-PILOT-OLCUMU-2026-10-15.md).
