# Çekirdek adayının Node 22 çalışma zamanı ve işletim provası

18 Ekim 2026. Kapsam yalnız `.release-candidates/cekirdek-aday-20261018-3` sabit adayıdır. Gerçek şirket pilotu ve canlı yayın ertelenmiştir.

## Tekrarlanabilir paketleme

```sh
node scripts/cekirdek-runtime-paketle.cjs .release-candidates/cekirdek-aday-20261018-3 .release-candidates/f02-kaynak-1792319370487-1218813e
node scripts/cekirdek-runtime-prova.cjs .release-candidates/cekirdek-aday-20261018-3
```

Paketleyici önce aday çıktılarını ve sabit kaynak dosyalarını SHA-256 ile doğrular. Ayrı dizine çevrimdışı, frozen lockfile üretim kurulumu yapar; API çıktısını adaydan, Prisma şemasını/migration'ları sabit kaynaktan alır. Ortak workspace paketlerini sabit kaynaktan derler ve paketin kendi Prisma istemcisini üretir. `.env` dosyaları dışlanır, sembolik bağlantıların paket içinde çözülmesi zorunludur. Başarısız denemeler ayrı adla korunur; yalnız başarılı paket `runtime-son-aday.json` işaretçisine yazılır.

Başarılı paket: `api-worker-runtime-20261018T105632135Z-e6c489`. 23.616 dosya/bağlantı, 1.009 sembolik bağlantı, 29 doğrudan üretim bağımlılığı. SHA-256: `2fd89d7098f342477db847a9fa1dbe44a029e3facfb4967241377e149b56cee6`.

## Çalıştırma koşulları

Linux x64, glibc/OpenSSL 3 ve yerel Node 22 imajı kullanılır: `sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55`. Önceki uygulama çalıştırılmaz; imaj yalnız Node/OS tabanıdır. API ve worker salt okunur paket bağlaması ve geçici `/tmp` ile başlar. PostgreSQL, Redis ve MinIO yalnız geçici prova kaynaklarıdır. Uygulama rolü superuser veya RLS bypass yetkisi taşımaz. Rastgele parola/anahtarlar raporda maskelenir.

Başlatma komutları paket kökünden `node apps/api/dist/main.js` ve `node apps/api/dist/main.worker.js` şeklindedir. Ortam ayarları dışarıdan verilir. Paket Node yürütücüsünü, işletim sistemi kitaplıklarını veya PDF tarayıcısını içermez; PDF ve standalone web ile Node 22 birleşik akışı sonraki kabul kaydında ayrıca sınandı.

## İşletim sırası

1. Aday manifestini ve runtime manifestini doğrula; hedefin platform, Node ve yapılandırma uyumunu kontrol et.
2. Hedef veritabanının yedeğini al ve ayrı veritabanına geri yüklenebilirliğini doğrula. Yerel 22 tablo provası hedefin yedeği yerine geçmez.
3. Migration'ları yetkili bakım bağlantısıyla uygula. Uygulamayı RLS kapsamındaki kısıtlı bağlantıyla başlat.
4. API `/health/ready` için veritabanı, Redis ve depo durumlarını; worker 9464 portundaki `/health` yanıtını kontrol et. Kimlik doğrulama ve sınırlı okuma/yazma kabulünü kaydet.
5. Servisleri yeniden başlatıp sağlık, kayıtların korunması ve worker tekillik kontrollerini tekrarla. Modülü salt okunur yaparak yazmanın 403 ile engellendiğini doğrula.
6. Sağlık veya veri doğruluğu bozulursa yazmayı durdur; migration uyumluluğu incelenmiş, kabul edilmiş önceki dağıtım ve geri yükleme planıyla ilerle. Bu çalışma eski sürümle şema uyumluluğunu kanıtlamaz; otomatik aşağı migration veya kanıtsız sürüm dönüşü uygulanmaz.

Bu sıralama bir çalıştırma rehberidir; hedef servis yöneticisi, yönlendirme, kapasite ve önceki dağıtıma geri dönüş kabulü ayrıca gerekir. Prova betiği yalnız kendi oluşturduğu rastgele adlandırılmış konteynerleri/ağı temizler. Kalıcı servisleri veya hacimleri değiştirmez.

## Kabul sonucu

[Çalışma zamanı raporunda](../.release-candidates/cekirdek-aday-20261018-3/f02-runtime-prova.json) **12 kontrol geçti**. Node 22.23.2 altında tam AppModule ve worker başladı; PostgreSQL/Redis/depo hazırdı. Gerçek parola ile HTTP giriş, kimlik/cari/fatura okuma, takip/görüşme, ödeme sözü, nakitte çift sayım kontrolü ve worker bildirimi doğrulandı. API ve worker yeniden başlatıldı; görüşme korundu, bağlantı ve bildirim birer kayıt kaldı. Salt okunur modda yazma 403 döndü. E-posta teslimatı kapalı kaldı.

Koşum öncesi/sonrası runtime ve aday dosya bütünlüğü doğrulandı. Geçici konteynerler ve ağ silindi; raporda `temizlik: true`. İlk kısıtlı ortam kurulumu başarısız manifestiyle saklandı; kabul edilen paket yalnız ikinci kurulumdur. Önceki 190 birleşik testten ayrı 12 çalışma zamanı kontrolüdür; 202 farklı iş senaryosu iddiası değildir.

[Sonraki PDF ve birleşik tarayıcı provasında](CEKIRDEK-NODE22-PDF-VE-TARAYICI-2026-10-18.md) PDF üretimi ve 14 ek kontrol geçti. Hedef kapasite/servis yönetimi, kabul edilmiş önceki sürüme dönüş ve gerçek pilot/yayın açık kalır. REL-03 tamamlandı sayılmaz.

[Son işletim/toparlanma koşumunda](CEKIRDEK-ISLETIM-VE-TOPARLANMA-2026-10-18.md) süreç hatası sonrası otomatik açılma, Redis kesintisi, özellik kapatma/açma ve küçük sentetik HTTP yükü dahil 17 kontrol geçti. Hedef kapasite/reboot ve önceki dağıtıma dönüş kapıları açık kaldı.
