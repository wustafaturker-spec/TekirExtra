# Tahsilat ve takip ekranlarının tasarım yenilemesi

19 Ekim 2026. Kullanıcı takip ekranlarının daha profesyonel ve kullanıcı dostu olmasını istedi. Kapsam: tahsilat iş listesi, takip detayı/görüşme formu ve cari hesabındaki ödeme sözleri.

## Görünüm ve kullanım

- Daha belirgin sayfa başlığı, tarih alanı ve tutarlı kart başlıkları.
- Yüklenen sayfa için söz, geciken söz, bugün/sonrası ve gerçekleşen adetleri. Dövizler arasında tutar toplanmaz; sayfa kapsamı belirtilir.
- Ödeme sözlerinde durum filtreleri ve cari/fatura araması; takiplerde cari/konu/sorumlu araması. Aramalar mevcut sayfayı kapsar; sunucunun cursor sayfalaması korunur.
- Müşteri kısaltmaları, fatura bağlantıları, sayısal hizalama, metinli durum etiketleri ve gerçekleşme çubukları. Geçersiz kaynakta gerçekleşen/kalan yerine çizgi gösterilir.
- Mobilde tablolar etiketli kartlara dönüşür. Formlar tek sütuna iner; masaüstünde alanlar iki sütunda düzenlenir.
- Takip detayında müşteri, sorumlu, sonraki işlem ve görüşme geçmişi birbirinden ayrıldı. Detay açıldığında klavye odağı ilgili bölüme taşınır. Görüşme ekleme birincil işlem olarak vurgulanır.
- Cari söz özetleri ve geçmişi aynı görsel düzeni kullanır. Yükleme, hata, boş liste ve arama sonucu bulunamaması ayrı gösterilir.

Var olan yetkiler, salt okunur mod, istek anahtarları, revizyon/iptal ve finansal hesaplama davranışı korunur. Yeni finans veya takip kaydı oluşturulmaz.

## Paket

Mevcut sabit pilot kaynağına yalnız beş uygulama dosyası ve ilgili test dosyaları alınarak ayrı kopyada web üretim derlemesi yapıldı. API dosyaları önceki adayla SHA-256 düzeyinde aynı. Çalışma alanındaki başka API değişiklikleri bu tasarım paketine alınmadı.

- Aday: `f02-20261019T063711894Z-b39a0faa`.
- Dizin: `.release-candidates/tahsilat-tasarim-20261019`.
- Web BUILD_ID: `Gl6q3VfW3GHdY5XVsiSy2`.
- Kaynak özeti: `d963ad5398faf9ccc4b76b831382e1998ff52bb6e43f6b416626f730ccc138ff`.
- API/web dosya özeti: `fd8ad5b5ccb9d0d3670bab4a6b905a0775fc687f45ce2eefe7d00ef16aabddf8`.

İlk derlemede test çerezinin TypeScript türünde zorunlu `expires` alanı eksikti; düzeltildi ve üretim derlemesi geçti. İlk deneme raporu korundu. Mevcut takip testindeki eksik cari durum fixture'ı tamamlandı. Geliştirme sunucusunda kaynak yoğunluğuyla görülen zaman aşımı nedeniyle son kabul hazır standalone paket üzerinde yürütülüyor.

## Kabul ve yerel geçiş

Geliştirme önizlemesinde iki tasarım senaryosu geçti: takipsiz söz görünürlüğü, güncel gerçekleşme, öncelik filtresi, arama, detay/görüşme formu ve mobil taşma. Masaüstü ve mobil görüntüler incelendi. Mobil ekran görüntüsü için menü geçişinin tamamlanması ayrıca beklenir.

**Hazır üretim paketinde 33/33 tarayıcı senaryosu geçti** (2,3 dakika): 19 cari ödeme sözü, 12 takip akışı ve 2 yeni tasarım senaryosu. İlk geliştirme koşumundaki fixture/zamanlama hataları son üretim paketi koşumunda yok. Tasarım senaryosunda JavaScript hatası veya yatay taşma görülmedi. Masaüstü ve menü geçişi tamamlanmış mobil ekran görüntüleri incelendi. Testler sentetik API yanıtlarıyla çalışır; gerçek kullanıcı ekran kabulü değildir.

**Yeni tasarım localhost:3100 üzerinde yayınlandı.** Yalnız web servisi `--no-deps` ile güncellendi. Servis `healthy`; `/giris` 200, oturumsuz `/panel/cari/tahsilat` 307. Çalışan konteynerin BUILD_ID değeri adayla aynı: `Gl6q3VfW3GHdY5XVsiSy2`. API, worker, migration ve gerçek iş kayıtlarında bu tasarım geçişiyle işlem yapılmadı.

Güncel servis tanımı `.release-candidates/pilot-yayin-20261019/tasarim-compose.json`. Önceki `soz-is-listesi-compose.json` ve web paketi korunuyor. Açık tarayıcı sayfası yenilenerek yeni tasarım görülebilir.

Kanıtlar: [paketleme kaydı](../.release-candidates/pilot-yayin-20261019/tasarim-web-paketleme.json), [ilk derleme denemesi](../.release-candidates/pilot-yayin-20261019/tasarim-web-paketleme-ilk-deneme.json), [üretim paketi tarayıcı sonuçları](../.release-candidates/pilot-yayin-20261019/tasarim-qa/sonuc.json).
