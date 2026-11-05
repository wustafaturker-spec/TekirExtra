# Paket modül ve kota sözleşmesi ilk teslimi

Devam teslimi: [kontrollü kapsam ataması, erişim tüketicileri ve atomik kota](PLATFORM-KAPSAM-ATAMASI-VE-ATOMIK-KOTA-2026-11-04.md). Aşağıdaki açık iş ve atama engeli açıklamaları ilk teslimin tarihsel durumudur.

PK-03/PK-04 için katalog sürümünde saklanan modül seçimleri ve ölçüm tanımlı ilk dört kota eklendi. Bu teslim tanım, doğrulama, sürümleme ve yayın önizlemesidir. Kiracı erişim politikası veya yeni kota ataması tamamlandı sayılmaz; mevcut aboneliklerin erişim/limitleri değiştirilmedi. Mevcut yerel veritabanına migration veya çalışan uygulamaya yayın yapılmadı.

## Ortak sözleşme

`packages/shared/src/paket-kapsami.ts` tanımları `@tekirextra/shared` ortak paket dışa aktarımından sunulur. Sözleşme şema 1, `moduller` ve tam dört anahtarlı `kotalar` nesnesidir. UI/API aynı Zod şemasını kullanır; DB trigger'ı doğrudan yazımlarda aynı şekil, sınır ve bağımlılık kurallarını doğrular. Açıklayıcı `ozellikler: string[]` pazarlama metnidir; bu alan erişim kararı üretmez.

17 modül kodu mevcut ortak rol/modül envanteriyle aynıdır: satış, fatura, e-belge, cari, kasa/banka, masraf/gelir, satın alma, stok, üretim, personel, demirbaş/araç, projeler, bütçe/nakit, raporlar, mali müşavir, dönem kapatma ve yapay zekâ. Modül adları ortak envanterden alınır. Ayarlar/hesap/abonelik yönetimi paket seçimiyle kapatılabilecek modüllere dahil değildir. Bu istisna kullanıcı rolünü veya mevcut yetkileri genişletmez.

İlk açık seçim bağımlılıkları: Fatura → Cari, e-Belge → Fatura, Üretim → Stok. Bağımlılıklar birlikte doğrulandığından e-Belge için Cari de gereklidir. Boş/tekrarlanan/bilinmeyen modüller ve eksik bağımlılıklar reddedilir. Bu matris henüz rol, menü, API, asistan/MCP ve otomasyon erişimine uygulanmaz; o tüketiciler ayrı teslimdir.

## Kota sözlüğü ve mevcut ölçüm

| Kod | Birim/dönem | Ölçüm kaynağı | Sıfırlama ve kapsam |
|---|---|---|---|
| kullanici | hesap / anlık | `users`: aktif, rolü `calisan` olmayanlar | Pasife alma veya çalışan rolüne geçiş sayımı azaltır; bayi dahil diğer aktif roller mevcut sayımda yer alır |
| cari | kart / anlık | `cari_hesaplar`: aktif kartlar | Pasife alınan kart sayımdan çıkar |
| stok | kart / anlık | `stok_kartlari`: aktif kartlar | Varyant adedi veya stok miktarı değildir; pasife alınan kart sayımdan çıkar |
| aylikFatura | fatura / Türkiye takvim ayı | `faturalar.created_at` | Oluşturulma anı; taslak/iptal ve tüm fatura tipleri dahil; belge tarihi kullanılmaz. Sonraki takvim ayında dönem değişir |

Her kotada `sinir` 0…2147483647 tam sayı veya null, `uyariYuzdesi` 1…99 tam sayıdır. Null sınırsız; 0 yeni kayıt hakkı yok anlamındadır. Birim, dönem, ölçüm kaynağı ve sıfırlama yönetici JSON'u içinden değiştirilemez. Şube, depolama, belge veya yapay zekâ harcaması gibi henüz tüketicisi tamamlanmamış ölçümlere kota tanımlanmaz; ek ücret/aşım bedeli alanı yoktur.

`paketKotaDurumu` normal/uyarı/dolu/aşım/sınırsız sınıflarını ve kalan hakkı ortak hesaplar. Uyarı eşiğine tam ulaşma uyarıdır; sınıra eşitlik dolu, üstü aşımdır. Sınırsızda oran/kalan null; sıfır sınırda oran 100'dür. Bu yardımcı yeni katalog eşiklerini mevcut abonelere kendiliğinden uygulamaz veya bildirim üretmez.

`AbonelikService` aylık sayımı sunucunun yerel saatine bağlı `setDate/setHours` yerine `paketKotaAyi` ile Türkiye ayının `[başlangıç,bitiş)` aralığına geçirildi. UTC ay değişiminden üç saat önce Türkiye ayı başlar. Sonraki ayın ileri tarihli satırları da sayımdan çıkar. Gerçek DB kabulünde önceki/sonraki ay sınırları, taslak/iptal ve farklı belge tarihiyle sonuç doğrulandı.

Mevcut kota kontrolleri kullanıcı, cari, stok ve fatura ana oluşturma yollarında çağrılır. `limitDogrula` sayımı ve asıl yazım ayrı transaction'lardadır; eşzamanlı kayıtlar için atomik kota güvencesi bu teslimde kurulmadı. Stok kopyalama, iç servis, toplu/entegrasyon ve benzeri yollar için kapsama denetimi de kalır. Dolayısıyla PK-04'ün yarış kabulü kapalı sayılmaz.

## Katalog yazma ve yayın

`PlatformPaketSurumu.kapsamSozlesmesi` JSON sütunu nullable'dır. Eski yayınlara ve aboneliklere varsayımsal kapsam doldurulmaz. Gönderilmeyen alan eski istemcide korunur; açık null taslaktaki tanımı kaldırır. Yeni taslak kaynak sürümün kapsamını kopyalar. Kapsam taslak revizyonuyla kaydedilir ve önce/sonra denetimine dahil edilir. Yayından sonra API/DB'de değiştirilemez; arşiv ve kaynak kopya geçmişi korur.

Editör modül seçimi, açıklanan bağımlılıklar, dört kota için sınır/sınırsız ve uyarı eşiği sunar. Yeni tanımda dört sınır 0 görünür; herhangi bir eski planın kotası varsayılmaz. Kaydetmeden önce doğrulama hataları gösterilir. Yayın onayında ve sürüm geçmişinde modüller ile kota/birim/dönem/eşik tablosu görünür. Çakışmada alanları koruma ve eski revizyonu reddetme sürer.

## Ticari geçiş sınırı

Mevcut atama akışı yalnız fiyat değiştirir ve eski abonelik limitlerini korur. Bu nedenle kapsam sözleşmesi bulunan sürüm, kapsam ataması tamamlanana kadar hem bugünkü hem planlı fiyat atamasına kapalıdır. DB atama önizleme kaydı insert trigger'ı iki yolu da korur; doğrudan API çağrısı UI engelini aşamaz. Fiyat etkisi raporu hedefte kapsam olduğunu döndürür; ekran karşılaştırmayı gösterir, atama formu yerine açıklama sunar. Fiyatı olduğu için yeni modül/kota sözleşmesi sessizce atlanmaz.

## Doğrulama

144 API ve 38 ortak sözleşme birim testi geçti. Temiz geçici PostgreSQL'de tüm migration'lar uygulandı; 19 yeni kapsam, 14 katalog, 15 planlı atama, 12 bugünkü atama ve 9 eski katalog bağı senaryosu olmak üzere 69 kabul testi geçti. API/DB geçersiz veri uyumu, sınır/sınırsız/eşikler, yayımlanmış kapsamın korunması, eski istemci/null/kopya, abonelik koşullarının değişmemesi, iki atama yolunun engeli, kiracı katalog yetkisi ve gerçek aylık fatura sayımı kapsandı. Ortak paket derlemesi, Prisma doğrulaması/istemci üretimi ve değişen kaynakların ESLint kontrolü temizdir.

İzole 3112 Next sunucusunda 22 Playwright senaryosu tek koşuda geçti (3,7 dakika). Dört yeni senaryo modül/kota kaydetme-yayın önizlemesi-kopyalama, eksik bağımlılıkta istek göndermeme/açık null kaldırma, çakışma/yenilemede kota alanını koruma ve kapsamlı hedefte fiyat atama formunun kapanmasını doğruladı. Önceki 18 katalog/fiyat/bugünkü-planlı atama senaryosunda regresyon yok. Tarayıcı API yanıtları taklittir; DB korumaları yukarıdaki gerçek PostgreSQL kabulünde sınandı. API TypeScript kontrolü geçti. Web tip kontrolünün ilk eşzamanlı koşusu Next sunucusunun yeniden ürettiği `.next-platform-e2e/types` dosyaları nedeniyle TS6053 verdi; tarayıcı sunucusu kapandıktan sonra sıralı yeniden koşu temiz geçti. API/web tip kontrolleri tamamlandı. Mevcut yerel/üretim veritabanı değiştirilmedi; geçici DB ve test sunucusu kapatıldı.

## Devam

Sonraki teslim, sözleşmenin kiracıya etki önizlemesi ve kontrollü ataması ile API/menü/asistan/otomasyon erişimini aynı kaynaktan uygulamaktır. Kota kapasitesini artıran bütün yazım yolları, yeniden etkinleştirmeler ve eşzamanlı işlemler için atomik kontrol tamamlanmalıdır. Diğer kota türlerinin ölçüm/yenileme/taşma sözleşmesi ve firma istisnaları devam eder. PK-03/PK-04 bütünü kapanmadı.
