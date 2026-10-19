# F03 — Derlenmiş gerçek HTTP ve tarayıcı provası

**19 Ekim güncellemesi:** [Çok kaynaklı iade ve genel satış özeti doğrulaması](F03-COK-KAYNAKLI-IADE-DOGRULAMA-2026-10-19.md) tamamlandı: üç gerçek HTTP/üretim tarayıcı senaryosu ve dört regresyon testi geçti. Kaynak kanıtı uyuşmazlığı düzeltildi ve yerel API'ye uygulandı. Aşağıdaki eski başarısız koşum/yayın notları tarihsel kayıt olarak korunur; kalan sınırlar güncel belgede belirtilir.

18 Ekim 2026. F03 için izole PostgreSQL, odaklı derlenmiş API controller/servisleri ve kopyalanmış web kaynaklarıyla birleşik teknik prova eklendi.

Çalıştırma: `node apps/api/scripts/f01-yaris-kabul.mjs --f03-http`.

## Akış

1. Geçici şirkette Argon2 parolalı, e-postası doğrulanmış kullanıcı, cari, hizmet kartı, depo ve pilot ayarı hazırlanır.
2. Gerçek giriş HTTP ucu oturum açar. İki fırsatta teklif oluşturma ve aynı isteğin tekrarı, teklif onayı, siparişe dönüşüm ve sipariş onayı gerçek HTTP uçlarından yürür.
3. İki sipariş tek faturada birleştirilip gerçek fatura servisiyle kesinleştirilir. Her fırsata yalnız kendi 120,12 TRY KDV dahil payı yansır; tahmini fırsat tutarı ve maliyet alanları sonuç yanıtına girmez.
4. 50,05 TRY matrahlı satış iadesi HTTP ile taslak oluşturulur. Kaynak referansı DB fixture'ıyla eklenir; iade HTTP ile kesinleştirilir.
5. İkinci fırsata 30,00 TRY iade matrahı HTTP ile ayrılır. Dağıtım eksikken ilk fırsatın net matrahı NULL'dır.
6. Chromium, gerçek giriş formuna parolayı girer. Hazır access token veya API yanıtı yerleştirilmez. İlk fırsata 20,05 TRY iade matrahı ekrandan kaydedilir; gerçek API 201 döner.
7. Sayfa yenilenince 80,05 TRY sonuç korunur; diğer fırsatın sonucu 70,10 TRY'dir. Dağıtım öncesi/sonrası faturalar, cari hareketler, kapamalar ve stok hareketleri aynıdır. İki dağıtım kaydı vardır.
8. Mobil görünümde menü geçişi tamamlandıktan sonra taşma kontrolü ve ekran görüntüsü alınır. Bütün tarayıcı API isteklerinin yalnız test API adresine gittiği ve sayfa çalışma hatası oluşmadığı doğrulanır.

İkinci senaryo, derlenmiş gerçek guard/controller üzerinde anonim, bozuk/süresi dolmuş/platform JWT, satış/depo rolü, başka tenant ve salt okunur/kapalı şirket modu sınırlarını doğrular.

**Sonuç:** Son koşumda iki birleşik senaryo geçti; API odaklı derlemesi ve testin TypeScript kontrolü başarılı. Geçici PostgreSQL durduruldu ve otomatik silindi. Mobil ekran görüntüsü incelendi; menü kapalı, sonuç görünür ve yatay taşma yok.

## Kanıtın sınırı

- API, gerçek Auth/CRM/Belge/Fatura controller'larını içerir; bütün `AppModule` veya worker işletim provası değildir. PDF, e-posta ve e-belge gönderimi çağrılırsa test hata verir; dış sağlayıcıya istek yapılmaz.
- Web, asıl kaynaklara yazmadan ayrı kopyadan `next dev` ile çalışır. Üretim standalone paketi veya yayın adayı kabulü değildir. Kapsam dışı panel uçları bu sınırlı API'de 404 dönebilir; onların davranışı sınanmıyor.
- Satış iadesinin kaynak referansı mevcut üründe gelen e-belge alımı sırasında oluşur. Burada yalnız bu ilişki fixture'dır; gelen sağlayıcı/UBL kabulü kanıtlanmaz. İade oluşturma ve kesinleştirme gerçek HTTP işlemleridir.
- Fixture hizmet kartıdır; fiziksel ürün/seri/lot maliyeti veya eksi stok senaryosu değildir. Gerçek şirket, iş kaydı ve servis kullanılmaz. PostgreSQL uygulama rolü superuser/BYPASSRLS değildir; test nonce'u ve geçici DB adresi zorunlu doğrulanır.
- Bu çalışma F01/F02/F03'ün tüm REL regresyonu veya gerçek kullanıcı pilotu değildir. Önceki pilot/canlıya geçiş ertelemesi korunur.

## Dosyalar

- [HTTP ve tarayıcı testi](../apps/api/test/crm-http.kabul.test.ts).
- [Odaklı API derleme ayarı](../apps/api/tsconfig.crm-http.json), [test tür kontrolü](../apps/api/tsconfig.crm-http-test.json).
- [Tarayıcı sonuç kaydı](../.release-candidates/f03-http-20261018/http-tarayici-sonucu.json), [mobil ekran](../.release-candidates/f03-http-20261018/gercek-api-mobil.png).
- [Kabul özeti ve temizlik kaydı](../.release-candidates/f03-http-20261018/kabul-ozeti.json), [HTTP kabul logu](../.release-candidates/f03-http-20261018/http-kabul.log).
