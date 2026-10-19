# F03 — Çok kaynaklı iade: satış özeti ve gerçek tarayıcı doğrulaması

19 Ekim 2026. Açık kalan çok kaynaklı iade HTTP/tarayıcı kabulü tamamlandı. İki ayrı fırsatın kendi teklif/siparişinden kesinleşen iki satış faturasına tek bir kesin iade bağlanır. Dış e-belge referansları fixture, satış ve iade oluşturma/kesinleştirme gerçek HTTP işlemleridir.

## Düzeltme

Ticari iade payı yazılırken kullanılan kaynak kanıtı ile genel satış özeti aynı alanları okumuyordu. Satış özeti kaynak faturanın `genelToplam` alanını kanıttan çıkarıyor, iade satırlarını ise pay ekranından fazla alanla okuyordu. Bu yüzden geçerli ve tamamlanmış çok kaynaklı dağıtımın kanıtı eşleşmiyor, genel net satış NULL kalabiliyordu.

`crm-net-satis.ts`, pay ekranıyla aynı kaynak fatura başlığını ve aynı dört iade satırı alanını kullanır. Yazma sözleşmesi, mevcut kanıtlar, audit ve mali kayıtlar değişmedi. Kayıt geçmişi yeniden yazılmadı.

## Doğrulama

- Yeni regresyon önce eski okumada net satışın NULL kalmasını yakaladı; düzeltmeden sonra geçti.
- Dört birim testi: saklanan kanıtın satış özetinde tanınması, kapasitesi aşılmış iadenin ilişkisiz tamamlanmış iadeyi etkilememesi, tam 5000 referansın kabulü ve 5001 referansta 409 ile kısmi sonucu önleme. Son iki test referans okuyucusu sınırını doğrular; bütün dağıtım uçlarının tüm sınırlarını kapsamaz.
- Üç gerçek HTTP/Chromium senaryosu geçti: mevcut tek kaynaklı karma fatura akışı, JWT/rol/tenant/mod sınırları ve yeni iki kaynak faturaya bağlı tek iade akışı.
- Yeni akışta iki kaynak da 100,10 TRY satış matrahıdır. 50,05 TRY iadenin ikinci kaynağına 30,00 TRY pay HTTP ile ayrılır; eksik dağıtımda her iki net sonuç NULL'dır. İlk kaynağa 20,05 TRY pay gerçek parola girişi yapılan tarayıcıdan kaydedilir. Sonuç 80,05 ve 70,10 TRY'dir. Her fırsat yalnız kendi faturasını ve kendi iade payını gösterir. Genel satış özeti ile dağıtım ekranı aynı neti verir.
- Yenileme sonrası sonuç korunur; 390px mobilde taşma/JavaScript hatası yok. Tarayıcı API yanıtı sahtelenmez ve access token enjekte edilmez. Tüm tarayıcı API istekleri geçici API adresine gider.
- Dağıtım öncesi/sonrası faturalar, fatura satırları, cari hareketler, kapamalar ve stok hareketleri aynı. İdempotent tekrar ikinci dağıtım oluşturmaz.
- Gerçek PostgreSQL uygulama rolü superuser/BYPASSRLS değildir; nonce ve geçici DB kapsamı kontrol edilir. Geçici DB temizlendi.
- Odaklı API derlemesi ve HTTP testinin TypeScript kontrolü geçti. Web için hazır üretim standalone paketi kullanıldı: `.release-candidates/tahsilat-takip-akis-20261019/web/apps/web`.

İlk birleşik koşumda yeni test yanıtın `id` alanını `faturaId` olarak beklediği için başarısızdı; test düzeltildi. Ayrı regresyon gerçek kanıt uyuşmazlığını yakaladı. Son koşum üç birleşik senaryoyu geçti. Bu teknik kabul gerçek şirket alan kabulü, fiziksel ürün maliyeti veya gelen e-belge sağlayıcısı kabulü değildir.

## Paket

Paket: `.release-candidates/f03-cok-kaynak-20261019/runtime`. Önceki sabit API runtime'ı aynı içerikle kopyalanıp yalnız `apps/api/dist/crm/crm-net-satis.js` yeni dosyayla atomik değiştirildi; önceki dosyanın hash'i korunarak doğrulandı. API'nin diğer dosyaları, bağımlılıkları ve Prisma istemcisi aynı. Eski pakette source map bulunmadığından yeni dosyanın map referansı kaldırıldı.

- Temel runtime: `api-worker-runtime-20261019T055545302Z-8b72eb`.
- Yeni JS SHA-256: `4df5dcdcbc42949b4bd2e4e981b0de7b2e8925e90a2dd43ca6285acc50ad19b0`.
- Runtime dosya özeti: `fe0fcc2e8f42eae6c1aa399702645527f43062502e3e9aa30a403c4ae2266fe8`.
- Compose: `.release-candidates/f03-cok-kaynak-20261019/compose.json`.

Kanıtlar aynı dizinde `http-kabul.log`, `kabul-ozeti.json`, `http-tarayici-sonucu.json`, `cok-kaynakli-http-sonucu.json`, `cok-kaynakli-iade-mobil.png`, `runtime-manifest.json`.

## Yerel geçiş

Yeni API paketi localhost pilotunda yalnız `api` servisi `--no-deps` ile yenilenerek uygulandı. Çalışan dosyanın SHA-256 değeri paketle eşleşti: `4df5dcdcbc42949b4bd2e4e981b0de7b2e8925e90a2dd43ca6285acc50ad19b0`. API `/health/ready`, web `/giris` ve ödeme sözü worker `/health` yanıtları 200. Üç servis de healthy; web ve worker yeniden oluşturulmadı. Veritabanı migration'ı veya gerçek iş kaydı yazımı yapılmadı.

Güncel tüm servis Compose tanımı `.release-candidates/f03-cok-kaynak-20261019/compose.json`. Önceki `.release-candidates/soz-eposta-20261019/compose.json` ve API runtime korunur. Mobil ekran görüntüsü gözle incelendi; sonuç görünür ve yatay taşma yok.

Bu teslim F03'ün çok kaynaklı HTTP/tarayıcı açığını ve net satış kanıt hatasını kapatır. Tüm karma dağıtım uçlarının 5000/5001 sınırları, fiziksel stok/seri/lot ve alan sorumlusunun gerçek şirket pilotu ayrıca açık kalır.
