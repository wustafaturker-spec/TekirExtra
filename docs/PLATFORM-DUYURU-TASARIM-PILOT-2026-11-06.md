# Duyuru tasarımı — yerel pilot yayını, 6 Kasım 2026

Son tasarım çalışması yerel pilota alındı. Bu teslim geniş T4 / DY kapsamının tamamını kapatmaz; gerçek platform/tenant kullanıcılarıyla uçtan uca kabul açık kalır.

- Pilot: http://localhost:3100
- Platform duyuruları: http://localhost:3100/platform/duyurular
- Firma duyuru merkezi: http://localhost:3100/panel/duyurular
- Paket: `.release-candidates/platform-duyuru-design-20261106`
- Web build ID: `qQjORoka183cUCx3enore`

## Kapsam

Duyuru listesi, içerik editörü, kayıt durumu ve sürüm bilgisi, görsel/bağlantı alanları, hedef firma seçimi, gösterim kartları, yayın takvimi, önizleme/onay, yayın raporu ve firma merkezi düzenlendi. Üst bant, popup ve modül kartları ortak görsel dile alındı. Uzun form için bölüm bağlantıları ve mobil firma raporu eklendi. Modül kartı kapatılınca modül seçimleri temizlenir; açıkken en az bir modül istenir. Firma aramasında Enter yayın önizlemesini tetiklemez.

Önceki pilot kaynaklarına göre fark duyuru arayüzündedir. Yalnız web servisi değiştirildi; API, worker sürümleri, oturum anahtarları ve veritabanı şeması korunur. Veritabanında 351 tamamlanmış, 0 yarım migration doğrulandı; migration çalıştırılmadı.

## Doğrulama

Üretim derlemesi ve tip kontrolü geçti. Derleme boyunca kaynak hashleri aynı kaldı; 2.703 paket dosyası SHA-256 ile doğrulandı. Kaynak özeti `e5ca95892d888908dc83d5313ba5e989d3bcf9f77392cf2369ee8f4e25801297`; paket dosyaları özeti `9122c9099d321c2391436165b40db331dd0e24825c217fc33c2b76f79098c286`.

Geliştirme sunucusu yerine oluşturulan standalone üretim paketinde 6 senaryo masaüstü ve mobilde çalıştırıldı: toplam 12 kabul, 0 hata, 0 atlama. Taslak, önizleme/klavye/geçmiş/arşiv, sürüm çakışması, yetki yönlendirmesi, hedefleme/yayın/durdurma/rapor ve tenant gösterim-okuma akışları kapsanır. Bu tarayıcı kabullerinde API yanıtları taklittir; gerçek kullanıcı oturumuyla iş verisi oluşturulmadı.

Yayın sonrası gerçek pilotta API readiness 200; PostgreSQL, Redis ve dosya deposu hazır. API, web ve iki worker `healthy`. Güncel duyuru CSS dosyasının canlı yanıtı paketle byte/hash düzeyinde aynı. Oturumsuz duyuru API isteği 401; olmayan kontrol hesabıyla giriş POST'u 401 ve geçerli JSON döndürdü. Oturumsuz platform yönlendirmesi ve giriş ekranı 1440/390 px Chromium'da doğrulandı; yatay taşma ve script hatası yok.

Yayın kontrolünde PostgreSQL, Redis, MinIO ve Mailpit konteynerlerinin önceden durmuş olduğu görüldü. Aynı konteynerler/verilerle yeniden başlatıldılar. PostgreSQL önceki uygunsuz kapanışın otomatik kurtarmasını tamamladı; ardından servisler sağlıklı hale geldi. Veri geri yükleme veya şema değişikliği yapılmadı.

## Geri dönüş ve açık kabul

Pilot sonrası ek doğrulama: gerçek PostgreSQL üzerinde 21 kabul senaryosu geçti; popup tercihleri ve tekrar politikalarının yeni bağlantıda kalıcılığı ayrıca doğrulandı. [Kabul kapsamı ve sınırları](PLATFORM-DUYURU-KABUL-2026-11-06.md). Bu çalışma pilot verisini veya yayın paketini değiştirmedi.

Önceki web paketi `.release-candidates/platform-onboarding-design-20261105/web` ve önceki compose yapılandırması yeni paketin `ops/geri-donus-compose.json` dosyasında korunur. Gerektiğinde yalnız web servisi geri alınır:

```sh
python3 .release-candidates/platform-duyuru-design-20261106/pilot-web.py geri-don
```

Geri dönüş çalıştırılmadı. Sonraki çalışmada, daha yeni pilot API/web paketlerinin izole kopyalarıyla gerçek giriş, görsel yükleme, yayın, firma erişimi, etkileşim raporu ve durdurma masaüstü/mobilde geçti; [HTTP/tarayıcı kabul kaydı](PLATFORM-DUYURU-HTTP-TARAYICI-KABUL-2026-11-06.md) güncel paketleri belirtir. İşletmenin gerçek pilot hesaplarıyla manuel kullanıcı kabulü açık kalır. Uzak üretime yayın yapılmadı. Geniş DY planının açık maddeleri bu tasarım yayınıyla tamamlandı olarak işaretlenmedi.

Makinece okunur kanıtlar paket içindeki `manifest.json`, `tarayici-kabul.json`, `canli-kontrol.json`, `dosyalar.json` ve `yayin-ozeti.json` dosyalarındadır.
