# Platform yerel güncellemesi

**Durum: localhost:3100 güncellendi.** Yeni firma listesi/detayı, takip ve notlar, kullanım/büyüme istatistikleri, kullanıma başlama sınıfları ve bekleyen operasyon işleri yerel pilotta açıldı. Uzak ortama yayın yapılmadı.

- Platform: <http://localhost:3100/platform>
- İstatistik: <http://localhost:3100/platform/istatistikler>
- Firmalar: <http://localhost:3100/platform/firmalar>

## Uygulanan sürüm

Yeni paket `.release-candidates/platform-istatistik-20261102` dizinindedir. API ve web üretim derlemeleri tamamlandı; API/worker bağımlılıkları, workspace çıktıları ve güncel Prisma istemcisi paketlendi. Mevcut runtime imajı ve aynı lockfile kullanıldı. Web build kimliği: `dx9TUl_5KtUiYEimmT8ws`.

Yerel `tekirextra` veritabanına yalnız bu dört bekleyen migration uygulandı; toplam 312 migration tamamlandı:

1. `20261103110000_platform_firma_takip`
2. `20261103130000_platform_firma_istatistikleri`
3. `20261103150000_platform_buyume_olcumu`
4. `20261103170000_platform_kullanim_ve_bekleyen_isler`

Yeni migration checksum'ları veritabanı kaydıyla karşılaştırıldı. Firma sayısı geçiş öncesi ve sonrası **723**. Mevcut API/web/worker oturum anahtarı ve bağlantı ayarları korundu. Üç servis yeni paket dizininden çalışıyor, healthcheck'leri `healthy`; yeniden başlatma politikaları `unless-stopped`. Ayrı söz hatırlatma servisi mevcut sürümünde bırakıldı. Etkin/kurulu Tekir pilot systemd birimi bulunmadı; host yeniden başlatması bu teslimde test edilmedi.

## Yedek ve geri dönüş

Geçiş öncesi tam PostgreSQL custom arşivi: `backups/platform-guncelleme-20261102/tekirextra-gecis-oncesi.dump` (573.813.455 bayt). Dizin 0700, arşiv 0600 izinlidir. `pg_dump` tamamlandı; arşiv kataloğu ve bütün içerik `pg_restore --file=/dev/null` ile okunup açıldı. Bu kontrol gerçek veritabanına geri yükleme değildir.

Önceki API/worker ve web sürüm dizinleri korunur. Önceki compose yapılandırması yeni pakette `geri-donus-compose.json` olarak saklanır. Mevcut web oturum anahtarını çıktıya veya dosyaya yazmadan koruyan işletim yardımcısı:

```sh
python3 .release-candidates/platform-istatistik-20261102/tools/pilot-compose.py kontrol
python3 .release-candidates/platform-istatistik-20261102/tools/pilot-compose.py durum
# Gerektiğinde önceki uygulama sürümüne dönmek için:
python3 .release-candidates/platform-istatistik-20261102/tools/pilot-compose.py geri-don
```

Bu yayında geri dönüş çalıştırılmadı. Yardımcı yalnız uygulama servislerini değiştirir; şemayı otomatik geri almaz ve yedeği yüklemez. Yedek geri yüklemesi, geçiş sonrası oluşmuş verileri de etkileyen ayrı bir veri işlemidir.

## Canlı doğrulama

3100 üzerinden **taklit API olmadan**, mevcut geçerli platform oturumu kullanılarak salt okuma kontrolü yapıldı. Yeni oturum, kullanıcı, not veya finansal örnek kayıt oluşturulmadı.

| Kontrol | Sonuç |
|---|---|
| İstatistik API'si; büyüme/başlama/operasyon alanları | 200 |
| Sayfalı firma listesi | 200 |
| Firma takip/not okuma | 200 |
| İstatistik ekranında yeni bölümlerin açılması | Geçti |
| Firma detayının açılması | Geçti |
| 390px mobil yatay taşma | Yok |
| Tarayıcı script hatası | Yok |
| Oturumsuz istatistik API erişimi | 401 |
| İstatistik worker'ının ilk çalışması | Başarılı; ardışık hata 0 |

## İlk ölçümün görünümü

Kullanım ölçüm başlangıcı **2 Kasım 2026**. Worker bugünün günlük özetini üretti. Büyüme yaşam geçmişi aynı gün Türkiye saatiyle **23:15:04** civarında başladı; başlangıç fotoğrafı geçmiş yeni kayıt/dönüşüm gibi sayılmadı.

Bu nedenle varsayılan son 7 gündeki eski günlerin kullanım toplamları `—` olabilir. Gün ortasında başlayan büyüme ölçümü bugünün tam dönem başını bilmez; kullanıma başlama takibi ise kapanmış son günü kullandığı için ilk gün geçmişi bulunmaz. Bu durumlar ekranda açıklanır, sıfırla doldurulmaz. Güncel abonelik ve bekleyen işler bölümleri hemen çalışır. Yeni deneme dönüşüm oranında 14 günlük gözlem süresi geçerlidir.

Ayrıntılı yayın kaydı: `.release-candidates/platform-istatistik-20261102/yayin-ozeti.json`. Build manifesti, migration logu, checksum/yedek özeti ve salt okuma kontrol sonuçları aynı sürüm dizinindedir. Önceki teslim belgelerindeki “henüz uygulanmadı” ifadeleri geliştirme anının tarihsel kayıtlarıdır; güncel yerel yayın durumu bu belgedir. T2'nin kalan kapsamı ve paket/duyuru aşamaları [üretim planında](PLATFORM-GELISTIRME-IMALAT-PROGRAMI-2026-11-02.md) izlenmeye devam eder.
