# Çekirdek adayının taşınabilir servis tanımları

18 Ekim 2026. Paket `.release-candidates/cekirdek-aday-20261018-3/isletim` altında hazırlandı. API/web/runtime sabit adayına bağlıdır; çalışma alanının sonraki değişikliklerini içermez. Hiçbir systemd servisi kurulmadı/etkinleştirilmedi; gerçek şirket pilotu ve yayın ertelenmiştir.

## İçerik ve yeniden üretme

```sh
node scripts/cekirdek-servis-paketi.mjs .release-candidates/cekirdek-aday-20261018-3
```

Üretici mevcut dizinin üzerine yazmaz. Aday manifestini, başarılı işletim kabulünü ve rapor SHA-256 değerini doğrular. `surum.json` API/web/runtime/browser dosya özetlerini içerir. Depoya veya host node_modules dizinine bağımlı olmayan `dogrula.mjs`, 27.661 dosya/bağlantıyı karşılaştırır; ek/eksik/değişmiş dosya, `.env*` dosyası ve paket dışına çıkan bağlantıda durur. Dizinler göreli olduğundan bütün aday dizini taşınabilir. Manifestler imzalı değildir; teslimde `paket.json` ve kaynak manifest SHA-256 değerleri ayrı, güvenilen teslim kaydıyla karşılaştırılmalıdır.

`compose.json` mevcut Node 22 imajını sabit SHA-256 ile kullanır; eski uygulama entrypoint'i çalıştırılmaz. API, worker ve web salt okunur bağlamalarla, init, geçici `/tmp`, 512 MiB bellek sınırı, `on-failure:3` yeniden başlatma ve sınırlı log saklamayla tanımlanır. Paket dizini yoksa Docker boş host dizini oluşturmaz. PDF browser dosyaları API/worker'a ayrıca salt okunur bağlanır.

Web, API'nin ağ alanını paylaşır; standalone Next'in localhost:3001 API yönlendirmesi korunur. Web konteyner içinde 0.0.0.0:3100 dinler; hosta yalnız loopback portu açılır. API ve worker host portu açmaz. Hedef TLS/reverse proxy, bu loopback web portuna ayrıca yönlendirilmelidir. Aynı anda iki farklı aday kullanılacaksa host web portları ve proje kimlikleri ayrı seçilir.

API hazır olmadan worker/web başlatılmaz. API readiness, worker health ve web giriş sayfası için periyodik healthcheck vardır. Healthcheck başarısızlığı trafik denetimi içindir; Compose kendi başına sağlıksız ama çalışan süreci yeniden başlatmaz. Hedef dış izleme/yük dengeleyici ayrıca gerekir.

## Dış yapılandırma

`compose.env.example` gizli değer içermez. Gerçek Compose ayar dosyası dışarıda tutulur:

```dotenv
TEKIR_API_ENV_FILE=/etc/tekirextra/api.env
TEKIR_NETWORK_NAME=tekirextra-uygulama
TEKIR_WEB_PORT=3100
```

API ortam dosyasını depoya koymadan, yalnız yetkili servis kullanıcısının okuyabileceği izinlerle sağlayın. DB/Redis/depo adresleri ve JWT/şifreleme anahtarları buradan gelir. `DATABASE_URL` kısıtlı RLS rolünü kullanır. Mevcut worker'ın tenant keşfi için gereken `DATABASE_URL_MIGRATE` ayrı yetkili bağlantıdır; hedef yetki incelemesi gerekir. SMTP ve dış servis ayarları pilot/yayın kararına göre ayrıca yönetilir.

Compose tanımı DB/Redis/MinIO veya kalıcı hacim oluşturmaz; `TEKIR_NETWORK_NAME` ile belirtilen önceden hazırlanmış ağa bağlanır. Altyapının kalıcı veri, yedekleme, yeniden açılış ve sağlık kabulü ayrı yapılmalıdır. Migration otomatik uygulanmaz; doğrulanmış yedek ve bakım adımı gerektirir.

## systemd şablonu

`tekirextra-aday@.service` incelenebilir bir şablondur. Beklediği kurulum düzeni `/opt/tekirextra/releases/<surum>/isletim` ve dış Compose ayarı `/etc/tekirextra/<surum>.compose.env` şeklindedir. Yalnız `isletim` klasörü değil, API/web/runtime/browser içeren bütün sabit aday taşınmalıdır. Sabit Node/OS imajı da hedef Docker deposunda bulunmalıdır (`pull_policy: never`).

Servis başlangıcında önce Compose yapılandırması, sonra ağsız konteynerde dosya bütünlüğü doğrulanır; ardından `up --wait` ile API/worker/web başlar. Duruşta yalnız bu adayın Compose projesi kontrollü durdurulur; veriler/hacimler silinmez. Başlangıç başarısızlığında `ExecStopPost` aynı proje servislerini durdurur. Birim host yeniden açılışında çalıştırılabilecek biçimdedir; kurulum/enable ve gerçek reboot bu çalışma kapsamında yapılmadı.

`systemd-analyze verify` şablonu hata vermeden doğruladı. Bu sözdizimi kontrolü, hedef kullanıcı/izin/Docker yolu, ağ, dış ayarlar veya reboot kabulü değildir. Hedefte birimi etkinleştirme ve servis geçişi ayrıca yetkili yayın adımıdır.

## İzole kabul

```sh
node scripts/cekirdek-servis-dogrula.test.mjs
node scripts/cekirdek-servis-prova.cjs .release-candidates/cekirdek-aday-20261018-3
```

Yedi dosya bütünlüğü/bağlantı testi geçti. Birleşik prova rastgele proje adı ve loopback portuyla yalnız geçici kaynaklarda üretilen Compose tanımını çalıştırır. Gerçek giriş formu ve API'yle takip/görüşme/ödeme sözü, masaüstü/mobil salt okunur ekranlar sınanır. Compose servisleri kaldırılıp aynı dosyalardan yeniden kurulur; bağımsız geçici DB/Redis/depo korunur. Sonra sağlık, iki görüşme, tek söz bağı ve tek bildirim kontrol edilir; gerçek tarayıcı tekrar giriş yapar. Bu yeniden kurma testi host reboot veya eski sürüme dönüş testi değildir.

## Sonuç

[Compose servis provasında](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-servis-prova.json) **17 kontrol geçti**. Ağsız Node 22.23.2 doğrulayıcı 27.661 dosya/bağlantıyı kabul etti. Üretilen tanımdan API/worker/web başladı; gerçek parola ile form girişi, görüşme ekleme, ödeme sözü ekranı ve masaüstü/mobil salt okunur kontrolleri geçti. JavaScript/API 5xx hatası görülmedi.

Compose servisleri tamamen kaldırılıp aynı tanımdan yeniden kuruldu. Hazırlık kontrolleri, tarayıcıyla yeniden giriş ve iki görüşme/tek söz bağı/tek bildirim doğrulandı. Yeniden kurma ve ilgili işlev kontrolü 26.950 ms sürdü; bu yerel süre hedef RTO taahhüdü değildir. Harici fixture DB/Redis/depo bu adımda korunmuştu. Hosta yayımlanan loopback portuna dış istemci/TLS testi bu koşumda yapılmadı; tarayıcı aynı ağ alanındaydı.

Sonunda geçici konteynerler/ağ ve sentetik ayar dosyası temizlendi (`temizlik: true`). API/web/runtime/browser ve önceki kabul kanıtlarının özetleri korundu. [Mobil görüntü](../.release-candidates/cekirdek-aday-20261018-3/tam-akis-4300e91a6f00b784/salt_okunur-mobil.png) incelendi.

[Servis kabul özeti](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-servis-kabul-ozeti.json) paket tanımlarını, çalıştırılan betikleri, önceki kanıtları ve yeni rapor/görüntü özetlerini doğrular:

```sh
node scripts/cekirdek-servis-kabul-ozetle.mjs .release-candidates/cekirdek-aday-20261018-3
```

Yedi doğrulayıcı testi ve 17 servis kontrolü ayrı düzeylerdedir; servis akışı önceki kabul davranışlarını tekrarlar. Hedefte systemd kurulumu/enable, gerçek reboot, üretim kapasitesi, TLS/dış izleme, kabul edilmiş önceki sürüme dönüş ve gerçek pilot/yayın açık kalır. REL-03 bu kayıtla kapatılmaz.
