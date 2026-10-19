# F04 — Stok açığından satın alma talebi hazırlama

Stok ihtiyaç önizlemesindeki **Eksik miktarla satın alma talebi hazırla** bağlantısı mevcut satın alma talep formunu açar. URL yalnız özgün ihtiyaç girdilerini taşır. Hedef sayfa eksik miktarı önizleme API'sinden yeniden hesaplar; bağlantıdaki bir tutar veya fiyat kabul edilmez.

Ürün, ihtiyaç günü ve ana birimdeki eksik miktar aktarım boyunca sabittir. Bütçe kalemi seçimi ve tahmini birim fiyat kullanıcı tarafından tamamlanır. Depo bilgisi ve hesaplanan ihtiyaç gerekçeye yazılır. Bu kayıt, depoya bağlı yeni bir DB ilişkisi veya kaydedilmiş MRP planı değildir.

Taslak kaydından hemen önce stok tekrar okunur. Ana birim, dönüşüm katsayısı veya bakiye/miktar değişmişse kayıt yapılmaz; kullanıcı **İhtiyacı yeniden yükle** ile güncel miktarı görüp tekrar kaydedebilir. Yenilemede bütçe, departman ve fiyat korunur; hesap gerekçesi güncellenir. Sıfır açık ve talep miktar sınırını aşan değerler aktarılmaz.

Kaydetme mevcut `POST /satin-alma/talepler` ucunu kullanır ve **taslak** oluşturur. Onaya gönderme, yetki/bütçe kontrolleri ve siparişe dönüşüm mevcut satın alma yaşam döngüsündedir. Otomatik onay veya sipariş oluşturulmaz. Başarılı kayıttan sonra URL kayıtlı talebi gösterir; yenileme yeni aktarım formu açmaz. Vazgeçme ve yeni talep düğmeleri aktarım girdilerini temizler.

## Sınırlar

Bu bir form hazırlama ve yeniden kontrol akışıdır; stok rezervi değildir. Son kontrol ile taslak kaydı tek bir veritabanı işlemi içinde değildir. Aradaki veya daha sonraki stok değişimi engellenmez; onay ve sipariş aşamasına kadar stok ayrılmış veya teslim garantisi verilmiş sayılmaz. Doğrudan açılmış farklı taleplerin aynı açığı kapsaması ayrıca engellenmez.

## Doğrulama

- 9 aktarım yardımcı testi geçti.
- Mevcut satın alma hesap/onay/bütçe kurallarının 9 testi geçti.
- Son üretim standalone paketinde 9 tarayıcı senaryosu geçti: önceki 5 önizleme senaryosu ve 4 aktarım senaryosu. Taslak gövdesi, açıkça bütçe/fiyat seçimi, tek kaydetme, yenilemede tekrar oluşturmama, değişmiş/kapanmış açık, fiyatı koruyarak yenileme ve mobil vazgeçme doğrulandı. Yazma senaryolarında API yanıtları test fixture'larıyla sağlandı.
- Yayınlanan ekranda gerçek API ile ihtiyaç hesabı ve satın alma formuna geçiş masaüstü/mobil olarak geçti. Bütçe ve fiyat boş, ürün/miktar sabit geldi. HTTP mutasyonları engellendi; gerçek şirkette deneme taslağı oluşturulmadı. Son ihtiyaç hesabı ilk istekte geçti; sayfa hatası veya yatay taşma yoktu.
- Web üretim derlemesi ve tip kontrolü geçti. Uygulamanın üç değişen kaynak dosyası yayın adayının kaynak hashleriyle eşleşti. Test başlığı seçicisi düzeltmesi ve mobil kontrol genişletmesi, kabulde kullanılan test dosyası hashleriyle ayrıca arşivlendi.
- API, DB şeması ve ödeme sözü worker'ı bu değişiklikte güncellenmiyor.

## Yerel yayın ve kanıtlar

- Başlangıç: `http://localhost:3100/panel/stok/ihtiyac`.
- Güncel tüm servis tanımı: `.release-candidates/f04-ihtiyac-talep-20261019/compose.json`.
- Web adayı: `f02-20261019T190612239Z-7eb604a8`; `.release-candidates/f04-ihtiyac-talep-web-20261019/web`.
- Yalnız web servisi değiştirildi. API ve ödeme sözü worker paketleri önceki sürümde kaldı. Üç servis healthy.
- Kanıt dizini: `.release-candidates/f04-ihtiyac-talep-20261019/`; `tarayici/sonuc.json`, `yerel-tarayici.json`, `kabul-kaynaklari.json` ve `yayin-ozeti.json`.
- İlk tarayıcı koşusu Card başlığını HTML heading olarak arayan test seçicisi nedeniyle başarısızdı. Görünen metni kullanan düzeltmeden sonraki tam 9 senaryo geçti; uygulama kodu değiştirilmedi. İlk koşunun kanıtı `tarayici-ilk/` altında korundu.

Geri dönüş, `.release-candidates/f04-ihtiyac-20261019/compose.json` ile yalnız web servisini geri almaktır. DB şeması ve iş kayıtları bu yayın nedeniyle değişmedi. Tarihli giriş/talep planlama, varyant planı, kalıcı ihtiyaç kaydı ve farklı taslaklar arasında tekilleştirme açık kapsamdır.
