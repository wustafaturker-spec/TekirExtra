# Tahsilat takip akışının iyileştirilmesi

19 Ekim 2026. Önceki tasarımın devamında günlük iş listesinden takip oluşturma ve tarih planlama kolaylaştırıldı.

- Yetkili kullanıcı iş listesindeki “Yeni tahsilat takibi” düğmesinden cari arayıp açıkça seçer. Seçilen cari form üzerinde gösterilir; seçim penceresini kapatmak kayıt yazmaz.
- Kayıt sonrasında tüm takipler görünümüne geçilir, arama/atanan filtresi temizlenir ve sunucunun döndürdüğü UUID ile yeni takip detayı açılır. İleri tarihli takip günlük listenin dışında kalsa da kullanıcı kaydını görebilir.
- Sonraki işlem günü için Bugün, Yarın ve Bir hafta sonra düğmeleri eklendi. Hesaplama İstanbul gününü temel alır; elle tarih seçimi korunur.
- Form açıldığında odağa alınır. Taslak açıkken görünüm ve atanan filtreleri değiştirilemez.
- Mobil düğmelerin dokunma alanı büyütüldü ve gecikmiş satırlardaki çift vurgu giderildi.

API sözleşmeleri, sunucudaki aynı cariye açık takip koruması, sürüm ve tekrar anahtarı kontrolleri değişmedi. Üretim verisine deneme kaydı yazılmadı. API paketi önceki pilotla byte düzeyinde aynı.

## Sabit web paketi

- Aday: `f02-20261019T093258328Z-b969e784`.
- Dizin: `.release-candidates/tahsilat-takip-akis-20261019`.
- BUILD_ID: `Z3qBmNjw9khlKcAvc5pm9`.
- Kaynak SHA-256: `a5013771e70baa7cb84742dc47a36658f46ae3d61ba1d8f50724f1319448c024`.
- API/web dosya SHA-256: `718d5fdd2a54f7ded0d51141f6c9f15e732c52f93f0234f6a6b6ae2419e5479a`.

## Kabul

Derlenmiş standalone paket üzerinde **35/35 tarayıcı testi geçti**: 19 ödeme sözü, 14 takip akışı ve 2 tasarım senaryosu. Yeni akışın ileri tarihli takip oluşturma ve cari seçimini iptal etme kontrolleri başarılı. Mobil ekran görüntüsü incelendi; yatay taşma yok.

İlk test başlatma girişiminde 3111 portu başka bir süreçte kullanımdaydı. O süreç korunarak tasarım testleri 3112 portunda yürütüldü. Testler sentetik API yanıtlarıyla çalışır; gerçek veriye yazma veya alan kabulü değildir.

Kanıtlar: [paketleme kaydı](../.release-candidates/pilot-yayin-20261019/takip-akis-web-paketleme.json), [tarayıcı sonuçları](../.release-candidates/pilot-yayin-20261019/takip-akis-qa/sonuc.json).


## Yerel yayın

Yeni paket localhost:3100 üzerinde yayınlandı. Yalnız web servisi `--no-deps` ile güncellendi. Docker eski konteynerin kaldırılmasında bekledi; hazır yeni web konteyneri başlatıldı ve Compose işlemi başarıyla tamamlandı. Web ve mevcut API `healthy`. Çalışan web BUILD_ID değeri adayla eşleşiyor: `Z3qBmNjw9khlKcAvc5pm9`. `/giris` 200; oturumsuz `/panel/cari/tahsilat` 307.

Güncel Compose: `.release-candidates/pilot-yayin-20261019/takip-akis-compose.json`. Önceki tasarım paketi ve `tasarim-compose.json` korunur. Bu geçişte API, worker veya veritabanı migration'ı güncellenmedi.
