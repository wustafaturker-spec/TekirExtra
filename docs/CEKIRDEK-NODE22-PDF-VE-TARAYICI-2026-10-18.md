# Çekirdek adayının Node 22 PDF ve gerçek tarayıcı provası

18 Ekim 2026. Kapsam `.release-candidates/cekirdek-aday-20261018-3` sabit adayı ve `api-worker-runtime-20261018T105632135Z-e6c489` çalışma paketidir. Ana çalışma alanının sonraki değişiklikleri bu adayın kabulüne dahil değildir. Gerçek şirket pilotu ve canlı yayın ertelenmiştir.

## Yeniden çalıştırma

```sh
node scripts/cekirdek-runtime-arsivle.cjs .release-candidates/cekirdek-aday-20261018-3
node scripts/cekirdek-tam-akis-prova.cjs .release-candidates/cekirdek-aday-20261018-3
```

Arşiv betiği başarılı runtime kabul raporunu ve dosya özetlerini doğrular. Paketin Playwright sürümünün beklediği Chromium, headless shell ve ffmpeg yerel önbellekten ayrı dizine kopyalanır. PDF testi ağsız, salt okunur Node 22 konteynerinde adayın gerçek `PdfService.htmlToPdf` metodunu çağırır. Üretilen PDF başlığı ve Türkçe `Çığ`, `Şişli`, `Ürün` metinleri doğrulanır. Arşiv API/worker bağımlılıklarını, browser dosyalarını, manifestleri ve çalıştırma açıklamasını içerir; web standalone ayrı kalır. Node yürütücüsü ve işletim sistemi kitaplıkları arşivde yoktur.

Birleşik prova yalnız kendi oluşturduğu PostgreSQL/Redis/MinIO, API ve worker üzerinde çalışır. Sabit adayın standalone web'i Node 22 ile API'nin ağ alanında başlar; Next'in gerçek `/api/v1` yönlendirmesi localhost:3001 API'sine gider. Test proxy'si veya yanıt taklidi yoktur. Bu yerel ağ düzeni hedef üretimin TLS/reverse proxy yapılandırmasının kabulü değildir.

Tarayıcı gerçek giriş formundan parola ile oturum açar; token yerleştirme yapılmaz. Görüşme ekler, yenileme sonrası metni ve API'de iki görüşmeyi doğrular; ödeme sözü ekranını açar. Salt okunur moda geçiş sonrası HTTP yazma 403, masaüstü ve mobil ekranlarda işlem düğmelerinin gizlenmesi sınanır. JavaScript ve API 5xx hataları kaydedilir. Worker tarayıcı ölçümlerinden önce durdurulur; worker başlangıcı/otomasyonu aynı koşumun önceki bölümünde doğrulanır. Bu tarayıcı akışı F02 kapsamındadır; F03'ün 190 testlik önceki standalone kanıtı ayrı, bu Node 22 koşumunda yeniden sınanmış sayılmaz.

API/runtime, web ve browser dosya özetleri koşum sonunda yeniden doğrulanır. Geçici servisler/ağ silinir. Ortam ayarları ve parolalar dışarıdan/rastgele sağlanır; gerçek şirket bağlantısı kullanılmaz.

## Sonuç

- [PDF ve arşiv raporu](../.release-candidates/cekirdek-aday-20261018-3/f02-runtime-arsiv.json): Node 22.23.2 altında 25.830 bayt PDF, Türkçe metin kontrolü geçti. Chromium/headless shell 1228 ve ffmpeg 1011 paketlendi.
- Arşiv: `api-worker-runtime-20261018T105632135Z-e6c489.tar.gz`; 378.364.663 bayt, SHA-256 `c80c54379241ec120804916c4002b2c6bc84475f5f8839e162c265659881c26a`. gzip ve 27.922 güvenli göreli arşiv yolu doğrulandı.
- [Birleşik akış raporu](../.release-candidates/cekirdek-aday-20261018-3/f02-tam-akis-prova.json): **14 kontrol geçti**, JavaScript/API 5xx hatası yok. Geçici kaynaklar temizlendi. [Mobil görüntü](../.release-candidates/cekirdek-aday-20261018-3/tam-akis-0690bfb76c1f29af/salt_okunur-mobil.png) incelendi; tablolar yatay kaydırmalı kapsayıcıda gösteriliyor.
- Çalışma alanıyla sabit aday arasında koşum başlangıcında sekiz dosya farkı vardı; raporda kayıtlıdır. Bu aday güncel çalışma alanının tamamını temsil etmez.

Önceki 12 runtime kontrolü + 1 PDF + 14 birleşik akış kontrolü [kabul özetinde](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-runtime-kabul-ozeti.json) birleştirilir. Aynı davranışların ayrı süreç başlangıçlarında tekrarları vardır; 27 farklı iş senaryosu iddiası değildir. Özet betiği aday bütünlüğünü, çalıştırılan betiklerin SHA-256 değerlerini, başarılı/temizlenmiş raporları ve arşiv özetini doğrular; rapor ve görüntü özetlerini kaydeder:

```sh
node scripts/cekirdek-runtime-kabul-ozetle.cjs .release-candidates/cekirdek-aday-20261018-3
```

Hedef üretim kapasitesi/servis yöneticisi ve kabul edilmiş önceki dağıtıma dönüş provası açık kalır. Gerçek pilot/alan kabulü ve yayın yapılmadı; REL-03 tamamlanmış sayılmaz.
