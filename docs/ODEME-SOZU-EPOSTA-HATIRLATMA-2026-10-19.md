# Ödeme sözü günü otomatik e-posta

Kullanıcının talebi: ödeme sözü tarihinde cari hesabın e-posta adresine otomatik hatırlatma gönderilmesi.

## İşleyiş

- Türkiye saatine göre söz günü saat 09.00'dan itibaren, başlangıçta ve 15 dakika aralıkla taranır. Aynı gün sonradan girilen sözler de kapsanır. Önceki günler için geriye dönük toplu ileti gönderilmez.
- Yalnız seçili şirketin pilot/açık tahsilat modunda çalışır. Sözün güncel kaydı ve fatura kapamaları gönderim hazırlığında yeniden okunur. İptal/revize, gerçekleşmiş, kesin satış faturası geçersiz veya fatura kalanı sıfır olan sözler atlanır.
- Cari aktif olmalı, kara listede bulunmamalı ve tek bir geçerli e-posta adresine sahip olmalıdır. Açık/bekleyen tahsilat itirazı iletiyi engeller.
- İleti cari ünvanı, şirket ünvanı, fatura numarası, söz tarihi, söz tutarı ve güncel hatırlatılan kalan tutarı içerir. Kalan, sözün uzlaştırılmış kalanı ile faturanın kalanının küçüğüdür. Sözün iç açıklaması e-postaya alınmaz.
- `odeme_sozu_hatirlatmalari` tablosu şirket/söz anahtarıyla gönderimi kalıcı olarak ayırır. Kilit ve anahtar, aynı anda iki worker çalıştığında veya süreç yeniden başlatıldığında aynı söz için ikinci gönderimi önler.
- Kesin bağlantı/kimlik doğrulama hataları ve SMTP'nin kesin ret yanıtları 15 dakika sonra en fazla üç denemeye izin verir. Gönderildiği belirsiz kalan DATA/socket kesintileri otomatik tekrarlanmaz. On dakikadan eski yarım gönderimler `belirsiz` olarak korunur; SMTP ve e-posta geçmişinden elle incelenmelidir. SMTP ile veritabanı arasında atomik işlem bulunmadığından her koşulda kesin tek teslim garantisi verilmez.
- E-posta geçmişine `odeme_sozu_hatirlatma` türüyle yazılır. Sabit Message-ID söz kimliğine bağlıdır. SMTP kabulü alıcının gelen kutusuna teslim edildiği anlamına gelmez.

## Ayrı worker

`main.odeme-sozu-worker.ts` yalnız Prisma, şirket e-postası ve bu zamanlayıcıyı açar; genel worker ve diğer otomasyonlar başlatılmaz. **2026-11-10:** tahsilat modu pilot ya da açık olan tüm şirketler taranır (en çok dördü aynı anda; bir şirketin hatası ötekileri durdurmaz). `ODEME_SOZU_HATIRLATMA_TENANT_ID` isteğe bağlıdır, tanımlıysa yalnız o şirket taranır. `TEKIR_ODEME_SOZU_WORKER=1` sadece bu süreçte ayarlanır. Normal API/genel worker kendiliğinden e-posta taramasını başlatmaz.

Odaklı derleme: `pnpm --dir apps/api exec tsc -p tsconfig.odeme-sozu-worker.json`. Üretilen giriş `apps/api/dist-odeme-sozu-worker/main.odeme-sozu-worker.js`. Normal tam API derlemesi de yeni girişi `dist` altında üretir. Yerel sabit runtime içinde giriş `apps/api/dist/main.odeme-sozu-worker.js` olarak paketlenmiştir.

Canlı API/web sürümleri korunur. Yalnız yeni tablo/index migration'ı ve ayrı hatırlatma servisi eklenir. Tablo FORCE RLS ve şirket/söz kapsamını koruyan birleşik FK kullanır. Eski mali kayıtlar veya migration checksum'ları değiştirilmez.

## Doğrulama

- 13 birim testi: İstanbul gün/saat sınırı, SMTP tekrar sınıflaması ve zamanlayıcı yaşam döngüsü.
- Geçici PostgreSQL üzerinde 103/103 kabul testi: mevcut 84 ödeme sözü/takip testi ve 19 yeni e-posta senaryosu. Yarış, yeniden başlatma, yanlış gün, 09 öncesi, geçersiz alıcı, itiraz, iptal/revizyon, kapalı/salt okunur mod, tam/kısmi ödeme, üç deneme sınırı, belirsiz gönderim ve şirket izolasyonu doğrulandı. SMTP sınırı bu testlerde sahtelenir; gerçek alıcıya ileti çıkmaz.
- Paketlenmiş gerçek EpostaService yerel SMTP sunucusuna sentetik ileti gönderdi. Message-ID, UTF-8 konu/metin, alıcı/gönderici ve e-posta geçmişi türü doğrulandı. Dış alıcı kullanılmadı.
- Mevcut şirketin Gmail SMTP bağlantısı/kimlik doğrulaması başarılı. Bu kontrolde e-posta gönderilmedi.
- Tam uygulama typecheck ilk denemede Node'un varsayılan 2 GB heap sınırına takıldı. Ayrı worker girişinin tüm bağımlılıklarını içeren odaklı TypeScript derlemesi 4 GB sınırıyla başarılı.

## Paket ve işletim kanıtları

- Dizin: `.release-candidates/soz-eposta-20261019/runtime`.
- Sabit kaynak: `.release-candidates/soz-eposta-kaynak-20261019`.
- Kaynak SHA-256: `75c38efe98a6ae0172991bcc4c4953ef3c0f0c407eb0e50257b52c208f989128`.
- Runtime SHA-256: `294ec091fe8158f3ea71c48dd1c452ce4a3cb3f6c61210a59ab746b007a11c00`.
- Güncel yedek: `backups/pilot-20261019/tekirextra-soz-eposta-20261019T104039996Z.sql.gz`; SHA-256 `190d48fe00933a1758e0d56094e8b3a4de7e1754478ba8febc2ecea186727d3d`.

## Veri geçişi

Güncel yedek ayrı PostgreSQL konteynerine geri yüklendi. Yeni tablo migration'ı 2.211 ms sürdü; mevcut 210 tablonun kayıt özetleri değişmedi. Geçici veritabanı temizlendi. İlk prova, PostgreSQL geçici başlangıç sunucusuna erken bağlandığı için durdu; TCP üzerinden tam açılış beklendikten sonraki koşum başarılı. Daha önce kaydedilen `checksum_manual`/`custom` migration metadata farkları değiştirilmedi.

Yerel veritabanında yalnız `20261019100000_odeme_sozu_hatirlatma` migration'ı uygulandı. API/web güncellenmedi; mali kayıt oluşturulmadı.

## Yerel etkinleştirme

19 Ekim 2026 11:44 UTC / 14:44 Türkiye saatinde ayrı servis açıldı. `tekir-yerel-pilot-20261019-soz-hatirlatma-1` healthy. İlk tarama sonucu: gönderilen 0, atlanan 0, hatalı 0; bugün tarihli aktif söz yoktu. Gerçek müşteriye deneme e-postası gönderilmedi. API ve web de healthy; bu geçişte yeniden oluşturulmadı.

Compose: `.release-candidates/soz-eposta-20261019/compose.json`. Servis `unless-stopped` ile yerel Docker çalıştığında açılır. Bilgisayar/yerel Docker kapalıyken gönderim yapılamaz; geçmiş günler ertesi gün topluca gönderilmez.

```sh
# Durum / gönderim taraması logları
docker compose --env-file .env -f .release-candidates/soz-eposta-20261019/compose.json ps
docker compose --env-file .env -f .release-candidates/soz-eposta-20261019/compose.json logs --tail 50 soz-hatirlatma
# Yalnız bu otomasyonu durdurma
docker compose --env-file .env -f .release-candidates/soz-eposta-20261019/compose.json stop soz-hatirlatma
```

Kanıt dizini `.release-candidates/soz-eposta-20261019`: `kabul-sonuc.json`, `paketleme.json`, `smtp-dogrulama.json`, `smtp-paket-prova.json`, `yedek.json`, `yedek-prova.json`, `yerel-migration.json`, `yerel-yayin.json`.
