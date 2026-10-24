# F04 — Taşınabilir kalıcı işletim paketi hazırlığı

23 Ekim 2026. Hedef sunucu/alan adı ve ortam dosyaları seçilmediği için bu dilim taşınabilir paket ve kurulum şablonu hazırlar. Mevcut yerel pilot, gerçek şirket DB’si, Docker servisleri, `/etc`, `/opt` veya systemd ayarları değiştirilmez. Hedef ortamda yayın/reboot kabulü değildir.

## Paket içeriği

`node scripts/f04-isletim-paketle.mjs`, önceki başarılı birleşik kabul ve sabit paket hash’lerini kontrol eder. Korumalı API/worker çıktısını, Prisma istemcisini ve workspace dist’lerini 19 Ekim bağımlılık tabanının **yeni bir kopyasına** uygular. Sonuç kaynak çalışma alanına veya `/tmp` derlemelerine bağlanmaz. Mevcut adayların üzerine yazılmaz. Büyük runtime/web/browser dosyalarının beklenen haritası onaylı kaynak manifestlerinden oluşturulur; kopyanın kendi hash’leri doğru kaynak varsayılmaz. Dosya doğrulaması geçmeden paket durumu dogrulama_bekleniyor kalır.

Çıktı `.release-candidates/f04-isletim-20261023/`:

- `runtime/`: bağımlılıklarıyla tek korumalı API/worker runtime’ı.
- `web/`: önceki kabul edilmiş standalone web; yeni web derlemesi değildir.
- `browsers/`: API/worker PDF üretimi için önceki sabit Playwright/Chromium çalışma dosyaları.
- `tools/`: dosya doğrulayıcı, Redis kontrollü geçiş kapısı ve işletim komutları.
- `isletim/compose.json`: API, web, worker, geçiş kapısı ve kontrol profilli doğrulama servisi.
- `isletim/tekirextra-f04@.service`: `/opt/tekirextra/releases/%i` ve `/etc/tekirextra/%i.compose.env` düzenini kullanan systemd şablonu.
- `isletim/*.env.example`: yalnız yer tutucular; gerçek gizli değer içermez.
- `surum.json`, `paket.json`: dosya hash’leri, aday kimliği ve hazırlık durumu.

Gerçek ortam dosyaları kopyalanmaz. `runtime`, `web`, `browsers`, `tools` ve `isletim` altındaki dosyalar hash ile denetlenir; paket dışına çıkan symlink ve `.env*` dosyası reddedilir. Metadata dosyalarının aktarımı ve sahipliği ayrıca korunmalıdır; bu manifest kriptografik imza sistemi değildir.

## İşletim davranışı

Compose servisleri yalnız yeni korumalı sürümü içerir. API, worker, web ve proxy dosyaları read-only, `/tmp` tmpfs, loglar rotasyonlu ve süreçler `unless-stopped` politikasındadır. Yalnız geçiş kapısının public portu host loopback’ine bağlanır. DB/Redis/S3 ağa dahil harici hizmetlerdir; bu paketin içinde başlatılmaz. Kontrol portu hosta açılmaz. Sabit Node imajının hedef makinede ve uygun mimaride önceden bulunması gerekir; otomatik image pull yapılmaz.

API, web ve kapı için ayrı harici env dosyaları kullanılır. Web yalnız ortak oturum işareti anahtarını; kapı yalnız Redis URL’si ve nonce’u alır. API DB/S3 ve uygulama anahtarlarını alır. Mevcut şifreleme anahtarı korunur; rastgele değiştirmek mevcut entegratör yapılandırmalarını okunamaz hale getirir. Env örnekleri çalışır hedef yapılandırması değildir.

İşletim komutları geçiş kapısı konteynerinde `/tools/kontrol.cjs` üzerinden çalışır:

| Komut | Davranış |
|---|---|
| `durum` | Proxy modu ve atomik Redis pause/aktif iş görüntüsü; salt okunur |
| `hazirla` | Kuyruğu pause eder, aktif e-belge işlerinin bitmesini bekler; trafik açmaz |
| `ac` | Pause/aktif sıfır, API/web ve gerçek worker readiness sonrası yeni trafik açar, en son resume eder |
| `kapat` | Önce bakım, sonra queue pause ve aktif işlerin bitmesi |

Aktivasyonun bir adımı başarısızsa komut bakım ve pause uygulamayı dener; bunlar da doğrulanamazsa açık hata döner. Hatalı/ulaşılamayan Redis veya worker ile başarı raporu üretilmez. Hazırlık/kapatmada aktif e-belge bekleme bütçesi 30 saniyedir; hedef iş süresi buna göre değerlendirilmelidir. Komutlar eski worker’ı durdurmaz; önceki sürüm/işletim kontrol düzlemi ayrı devredilir.

systemd sırası: Compose config → ağsız paket doğrulama → queue hazırlık → API/web/worker/proxy health bekleme → aktivasyon. Durdurmada bakım/pause ve ardından servis stop uygulanır. Otomatik migration veya DB/Redis/S3 kurulumu yapılmaz.

## Yerel paket doğrulama

Yeni aday dizini ilk kez hazırlanırken paketleyici çalıştırılır. Mevcut çıktı üzerine yazılmaz; yeni adayda yeni sürüm/yol belirlenir. Ağsız Compose doğrulamasının stdout JSON raporu saklanır, ardından kabul özetleyici paket kimliği/dosya adediyle eşleştirir.

```sh
node scripts/f04-isletim-paketle.mjs
# Harici env yolları testte sahte dosyalara, hedefte operatörün gerçek dosyalarına işaret eder.
docker compose --env-file /etc/tekirextra/f04-isletim-20261023.compose.env -f .release-candidates/f04-isletim-20261023/isletim/compose.json run --rm --no-deps dogrulama > dosya-dogrulama.json
node scripts/f04-isletim-kabul-ozetle.mjs dosya-dogrulama.json
```

Bu koşumdaki Compose doğrulaması `/tmp` altındaki yalnız sentetik env dosyalarıyla yapıldı; gerçek `/etc` dosyası okunmadı.

## Hedefe kurulum öncesi kararlar

Hedef makine/işletim sistemi, HTTPS alan adı ve reverse proxy, mevcut servis ağı/DB/Redis/S3 adresleri, API/web/kapı env dosyalarının sahipliği, port, önceki sürümün hangi unit/projeden durdurulacağı, yedek/restore kanıtı ve kesinti bütçesi belirlenmelidir. Bu seçimler yapılmadan aşağıdaki kurulum komutları mevcut pilotta çalıştırılmaz.

Önceki yayın durdurulmadan aynı Redis’e ikinci bağımsız worker projesi açılmaz. Eski korumasız worker’a dönüş gerekiyorsa önceki birleşik kabul sırasındaki bakım/pause/aktif sıfır/normal kapanış zorunludur. Bu pakette eski sürüm servisi ve otomatik rollback yoktur. Birden çok systemd instance’ının aynı uygulamayı yönetmesine izin verilmez.

## İncelenebilir kurulum sırası

Hedefte yetkili operatörün uygulayacağı şablon:

1. Paket `/opt/tekirextra/releases/f04-isletim-20261023` altına taşınır; sahiplik/değiştirme yetkisi sınırlandırılır. Sabit Node image ve Docker/Compose ön koşulları hazırlanır.
2. DB migration, yedek/restore ve önceki sürümün kontrollü durdurulması ayrı doğrulanır. Paket içindeki eski migration CLI’si otomatik çalıştırılmaz.
3. Örneklerden `/etc/tekirextra/f04-isletim-20261023.compose.env` ve bu dosyanın işaret ettiği API/web/kapı env dosyaları hazırlanır. Gizli dosyalar release dizinine konmaz; API/web oturum anahtarı ve Redis adresleri tutarlı olmalıdır.
4. Compose `config --quiet` ve ağsız doğrulama servisi çalıştırılır. Hedef ağ ve TLS reverse proxy, yalnız loopback portuna yönlendirilir.
5. systemd şablonu yetkili biçimde kurulur. Önceki instance kapalıyken seçilen yeni instance başlatılır; servisler, `/health/ready`, web, worker ve gerçek HTTPS giriş doğrulanır.
6. Hedef şirket modu önce salt okunur açılır; gerçek alan sorumlusu pilotu ve metrik kabulü tamamlanmadan genel yazma/otomasyon açılmaz.
7. Reboot ve Docker daemon/container restart davranışı hedefte ayrıca sınanır. Proxy süreç restart’ında bakım moduna döner; yalnız container restart policy hedefin yeniden trafik açıldığını kanıtlamaz. systemd start sonrası aktivasyon otomatik çağrılır; bağımsız proxy/daemon yeniden başlatmasında bakım/pause durumu kontrol edilip kontrollü `hazirla`/`ac` uygulanır.

Örnek komutlar, env dosyaları hazırlandıktan ve hedef yetkisi verildikten sonra çalıştırılır:

```sh
docker compose --env-file /etc/tekirextra/f04-isletim-20261023.compose.env -f /opt/tekirextra/releases/f04-isletim-20261023/isletim/compose.json config --quiet
docker compose --env-file /etc/tekirextra/f04-isletim-20261023.compose.env -f /opt/tekirextra/releases/f04-isletim-20261023/isletim/compose.json run --rm --no-deps dogrulama
systemctl start tekirextra-f04@f04-isletim-20261023.service
```

Bu belgede systemctl veya hedef Docker komutları uygulanmış değildir.

## Doğrulama durumu

**Nihai paket hazırlandı.** Onaylı kaynak manifestlerinden beklenen **35.012 dosya**, Docker Compose’un yalnız ağsız doğrulama servisinde **Node v22.23.2** ile doğrulandı. Paket durumu gerçek doğrulama JSON raporu eşleştirildikten sonra hazirlandi oldu.

**9 işletim komutu testi, 27 geçiş kapısı HTTP testi ve gerçek paket kapısı + Redis ile 5 I/O kontrolü geçti.** Hazırlık, readiness sonrasında açma/resume, kapatma ve hazır olmayan/reddeden hedefte bakım-pause korunumu doğrulandı. I/O testinin API/web/worker health endpoint’leri fixture’dır; gerçek ERP worker kabulü önceki birleşik rapordadır. I/O testleri ilk hazırlıkta çalıştırıldı; nihai runtime/web/tools hash’lerinin bunlarla birebir aynı olduğu ayrıca doğrulandı.

PDF bağımlılığı son kontrolde pakete eklendi. Onaylı **598 Chromium/Playwright çalışma dosyası** nihai manifestte bulunur. Aynı runtime/browser hash’leriyle ağsız konteynerde gerçek Chromium açılıp **9.445 baytlık geçerli %PDF-** çıktısı üretildi; süreç normal kapandı. Bu sentetik PDF tarayıcı bağımlılığı kabulüdür, gerçek fatura PDF içeriği/alan kabulü değildir.

Compose config --quiet ve systemd-analyze verify **exit 0** verdi. Son Compose dosyası Chromium bind/env ayarlarıyla tekrar doğrulandı; systemd şablonu ve işletim araçlarının önceki başarılı kontrollerle aynı hash’te olduğu kanıtlandı. İlk hazırlık `.release-candidates/f04-isletim-20261023-ilk-hazirlik/` altında arsiv_ilk_hazirlik durumunda korunur; dağıtım adayı değildir. Paketleme sırasında yavaş host hash taraması durdurulup beklenen haritanın onaylı kaynaklardan kurulduğu yöntemle tamamlandı; nihai kabul gerçek ağsız dosya doğrulamasına dayanır.

Geçici I/O konteynerleri ve ağ temizlendi; iki Compose doğrulama konteyneri --rm ile kaldırıldı. Hedef ortam dosyası, mevcut pilot servisi veya şirket DB’si değiştirilmedi. Üretim kurulumu, tam servislerin hedef Compose üzerinde açılması, host reboot/daemon restart, TLS, yedek/restore, hedef hacim ve gerçek alan pilotu açık kalır.

Paket: `.release-candidates/f04-isletim-20261023/`. Kanıtlar: `.release-candidates/f04-isletim-kabul-20261023/` içindeki `dosya-dogrulama.json`, `hazirlik-kontrolleri.json`, `isletim-io-kabul.json` ve `isletim-kaynak-kaniti.json`. `paket.json` yayınlandı/reboot kanıtı olmadığını açıkça kaydeder.
