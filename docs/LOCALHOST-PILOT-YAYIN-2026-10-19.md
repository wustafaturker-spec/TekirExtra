# Localhost pilot geçişi — 19 Ekim 2026

**Güncel iş kutusu yayını (23:50):** Teklif iş kutusundan kaldırma ve geri alma (AI-66…70) için API ve web çalışma ağacından yeniden paketlendi; önceki pilot kaynağında ajan hafızası (AI-58…65) da yoktu, yama yetmedi. Servis tanımı `.release-candidates/is-kutusu-20261019/compose.json` (özet `yayin-ozeti.json`). API runtime'ı önceki runtime'ın kopyasıdır (pnpm-lock aynı); `apps/api/dist`, `prisma`, `packages/shared/dist` temiz derlendi, Prisma istemcisi güncel şemadan. Web `next build` standalone. Ödeme sözü worker paketi korundu. API ve web healthy. Geri dönüş: önceki `f04-ihtiyac-talep-20261019/compose.json`.

**Güncel satın alma talebine aktarım yayını:** [F04 stok açığından talep formu](F04-STOKTAN-SATIN-ALMA-TALEBI-2026-10-19.md) uygulandı. Güncel tüm servis tanımı `.release-candidates/f04-ihtiyac-talep-20261019/compose.json`; web adayı `f02-20261019T190612239Z-7eb604a8`. 18 birim ve 9 üretim tarayıcı senaryosu geçti. Gerçek API ile form geçişi masaüstü/mobil doğrulandı; deneme iş kaydı açılmadı. Yalnız web paketi değişti; API ve e-posta worker korundu. Üç servis healthy.

**Stok ihtiyaç önizlemesinin ilk yayını:** [F04 yeni ihtiyaç önizlemesi](F04-STOK-IHTIYAC-ONIZLEMESI-2026-10-19.md) API/web paketleriyle uygulandı. Bu ilk dilimin servis tanımı `.release-candidates/f04-ihtiyac-20261019/compose.json`; web adayı `f02-20261019T184713579Z-9b8746c3`. 18 birim, 9 DB/RLS ve 5 son web tarayıcı testi geçti; yayındaki ekran gerçek API ile masaüstü/mobil kontrol edildi. İş kaydı veya migration yazılmadı; ödeme sözü worker paketi korundu. Üç servis healthy. Kaynak baskısında geçici 503 gözlendi; son gerçek kontrol ilk istekte geçti.

**Son API teslimi:** [İade payı revizyon kapasitesi](F03-IADE-REVIZYON-KAPASITESI-2026-10-19.md) düzeltildi ve yerel API'ye uygulandı. 55 PostgreSQL kabul testi ve üç gerçek HTTP/üretim tarayıcı senaryosu geçti. Güncel Compose `.release-candidates/f03-iade-revizyon-20261019/compose.json`; önceki net satış düzeltmesi ile web ve e-posta worker'ı korunur. API/web/worker sağlık yanıtları 200.

**Güncel web görünümü:** [Takip oluşturma ve tarih planlama akışı](TAHSILAT-TAKIP-AKISI-2026-10-19.md) 35 üretim paketi tarayıcı testiyle doğrulanıp localhost'a uygulandı. Güncel servis tanımı `takip-akis-compose.json`. Önceki [tasarım yenilemesi](TAHSILAT-TAKIP-TASARIMI-2026-10-19.md), [ödeme sözü düzeltmesi](F02-IS-LISTESI-ODEME-SOZLERI-2026-10-19.md) ve aşağıdaki ilk aday kimliği/kabul bilgileri tarihsel kayıtlardır. Önceki paketler korunuyor.

**Güncel otomasyon:** [Ödeme sözü günü e-posta hatırlatması](ODEME-SOZU-EPOSTA-HATIRLATMA-2026-10-19.md) ayrı `soz-hatirlatma` servisiyle etkin. Bu otomasyonun ilk servis tanımı `.release-candidates/soz-eposta-20261019/compose.json`. Bu ek servis yalnız seçili şirketin söz günü e-postalarını tarar; aşağıdaki ilk manuel geçişte genel worker'ın açılmadığına ilişkin notlar tarihsel kayıttır. API/web paketleri değiştirilmedi.

**F04 öncesi API düzeltmesi:** [Çok kaynaklı iadenin satış özetine aktarımı](F03-COK-KAYNAKLI-IADE-DOGRULAMA-2026-10-19.md) üç gerçek HTTP/üretim tarayıcı ve dört birim regresyon testiyle doğrulanıp uygulandı. Bu önceki geçişin servis tanımı `.release-candidates/f03-iade-revizyon-20261019/compose.json`. Yalnız API yenilendi; web ve ödeme sözü hatırlatma servisi sağlıklı kaldı.

Kullanıcı hedefi `http://localhost:3100` olarak teyit etti. Şirket: TEKİR EKTRA ÖN MUHASEBE; sorumlu hesap: `admin@tekirextra.local`.

## Sabit paket ve kabul

- Aday: `f02-20261019T045151168Z-4e5b6ce7`, dizin: `.release-candidates/cekirdek-pilot-20261019`.
- Kaynak SHA-256: `34415531d73bb9dd0ec8d843d10801de36433240220a0c1261e69371dddbb540`.
- API/web dosya SHA-256: `94866ed26d5fa40cd1d7453b56e5f4a37999f46d05770cf7a3287c6453c961b5`.
- Web BUILD_ID: `dWAubM82N5g1HuEdZRGZA`.
- API ve web üretim derlemeleri başarılı. Sabit kaynak kopyası derleme sonunda çalışma alanıyla eşleşti.
- 190 birleşik PostgreSQL/HTTP/tarayıcı kabul testi geçti. Migration tekrarı ve 22 sentetik tablonun dump/restore eşitliği başarılı. Geçici DB silindi.
- Yeni teklif takibi, cari adayı, teklif talebi ve oturum korumasına ilişkin 55 API testi; oturum ve ödeme sözü özeti için 18 web testi geçti. Bunlar birleşik kabulün yerine geçmez.
- Runtime: `api-worker-runtime-20261019T050542362Z-ac04e8`; 23.631 dosya/1.009 bağlantı; SHA-256 `9ce1662532501cec13fe83f09edfa20ef0f5e6269232089cd0eb8b4322472ec0`.

İlk birleşik koşumda 189/190 test geçti; yeni web korumasına test oturum anahtarı verilmemişti. Aynı anahtar API/web süreçlerine sağlanan son koşum 190/190 geçti. Kalıcı kabul betiği artık rastgele test anahtarı üretir. Runtime karşılaştırmasında Prisma'nın alan sıralaması nedeniyle görülen hata, yalnız paket kopyasında `prisma format` çalıştırılarak giderildi. Bu iki yardımcı betik düzeltmesi aday API/web kaynak kimliğinden sonra yapıldı; aday uygulamasında ek değişiklik yoktur.

## Veri ve işletim sınırı

Yerel PostgreSQL, Redis, MinIO ve Mailpit mevcut kalıcı hacimleriyle açıldı. Güncel şirket ve aktif yönetici hesabı salt okunur doğrulandı. `tekir_app` ve `tekir_platform` superuser/BYPASSRLS değildir.

Güncel ayarlarda `tahsilat_operasyonu.mod=pilot`; otomasyon ve uygulama içi bildirim açık. Bu değerler önceki notlardan farklıdır; değiştirilmedi. Manuel pilot açılışında worker çalıştırılmayacak. Böylece mevcut otomasyon ve dış servis zamanlayıcıları bu geçiş nedeniyle çalışmaz. Otomasyon pilotu ayrıca kabul gerektirir.

Güncel yedek: `backups/pilot-20261019/tekirextra-20261019T044457Z.sql.gz`; SHA-256 `a525937020f6d69c5dd4c07fe97ce82991cb130a119b363fa4ca73a924083bb4`. İlk yedek girişimi DB toparlanırken başarısız oldu; 20 baytlık `044356Z` dosyası geçerli yedek değildir. Kullanılmamalıdır.

İlk geri yüklemede 208 tablonun tam kayıt özetleri eşleşti. Eski iki migration metadata kaydı gerçek SHA-256 yerine `checksum_manual` ve `custom` içeriyor. Bu kayıtlar değiştirilmedi. Ayrı şema farkı raporu mevcut; SQL uygulama talimatı değildir. Özellikle varsayılanlar, özel FK/indexler ve eski OCR kolon eşlemesi gibi farklar topluca uygulanmamalıdır. Bu geçişin kapsamı yeni iki iade migration'ıdır.

## Servis tanımı

Yerel Compose: `.release-candidates/pilot-yayin-20261019/yerel-compose.json`. API ve web sabit Node 22 imajıyla, salt okunur paket bağlamalarıyla çalışır. API mevcut `.env` ayarını kullanır; web'e yalnız gerekli oturum anahtarı aktarılır. Gizli değerler servis tanımına yazılmadı. Web yalnız `127.0.0.1:3100` dinler. API host ağında 3001 portunu kullanır. Worker tanımı yoktur.

```sh
docker compose --env-file .env -f .release-candidates/f03-iade-revizyon-20261019/compose.json ps
docker compose --env-file .env -f .release-candidates/f03-iade-revizyon-20261019/compose.json logs --tail 30
docker compose --env-file .env -f .release-candidates/f03-iade-revizyon-20261019/compose.json stop
```

Paketler ve dış `.env` korunmalıdır. Bu tanım başka makineye doğrudan taşınabilir bir kurulum değildir; mutlak yerel yollar içerir. `restart: unless-stopped` Docker yeniden başladığında uygulama süreçlerini açar; host reboot kabulü yapılmış sayılmaz. Önceki 20 Eylül uygulama imajları uyumsuz oldukları için geri dönüş hedefi seçilmedi. Sorunda ilgili özellik durdurulur; iş verisi/migration geçmişi silinmez.

## Geçiş sonucu

İkinci geri yükleme/migration provası başarılı: 208 tablo özeti aynı; yeni tablo migration'ı 816 ms, indeks migration'ı 201 ms sürdü. Geçici konteyner otomatik silindi. Geçmiş metadata farkları raporda tutuldu; başarılı veri/migration provası bu eski kimlik kayıtlarını doğrulanmış saymaz.

Yeni iki migration yerel veritabanına `prisma migrate deploy` ile uygulandı; diğer migration'lar yeniden uygulanmadı. API ve web sabit paketten Node 22.23.2 altında açıldı; ikisi de `healthy`. `/health/ready`: 200, veritabanı/Redis `ok`; web `/giris`: 200; oturumsuz `/panel`: 307; web üzerinden korumalı takip API'si: 401.

Yayınlanan hedefte masaüstü ve 390px mobil Chromium kontrolleri geçti: giriş düğmesi görünür, JavaScript hatası ve yatay taşma yok; panel girişi istiyor ve API 401 veriyor. Mobil ekran görüntüsü gözle incelendi. Bunlar gerçek yönetici parolasıyla oturum açma kabulü değildir. Gerçek parola ile tarayıcı iş akışı yukarıdaki ayrı sentetik kabulde doğrulandı.

Geçiş sonrası uygulama rolüyle şirket sayımları: 565 cari, 189 fatura, 2 söz, 2 takip; yedekteki şirket sayımlarıyla aynı. Yeni iade payı tablosu boş; RLS ve FORCE RLS açık. Deneme iş kaydı oluşturulmadı. Bu sayımlar tüm mali içeriklerin geçiş sonrası yeniden hash karşılaştırması değildir.

API/web için `unless-stopped` politikası hazır. Mevcut dört altyapı konteyneri de aynı politikaya alındı. Gerçek host reboot yapılmadı. Worker başlatılmadı; mevcut şirket ayarları korunuyor.

**Yerel manuel pilot teknik yayını tamamlandı.** Gerçek kullanıcı girişi, doğal iş örneği ve alan kabulü, otomasyon pilotu, host reboot ve tam eski sürüme dönüş kabulü açık. REL görevlerinin tamamı kapatılmadı. Sonraki adım: yönetici hesabıyla giriş, mevcut iki söz/takibin ekran kontrolü ve gerçek işten gelen işlem sonucunun alan sorumlusunca doğrulanması.

Kanıtlar: [birleşik kabul](../.release-candidates/pilot-yayin-20261019/cekirdek-kabul.json), [yedek ve migration provası](../.release-candidates/pilot-yayin-20261019/yedek-prova.json), [ilk geri yükleme kaydı](../.release-candidates/pilot-yayin-20261019/yedek-prova-ilk-deneme.json), [şema farkı](../.release-candidates/pilot-yayin-20261019/sema-farki.sql), [yerel migration](../.release-candidates/pilot-yayin-20261019/yerel-migration.json), [masaüstü/mobil tarayıcı](../.release-candidates/pilot-yayin-20261019/yerel-tarayici.json).
