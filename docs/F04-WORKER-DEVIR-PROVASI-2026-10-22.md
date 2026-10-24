# F04 — Özel ödeme sözü worker’ında kontrollü devir

22 Ekim 2026. Önceki özel worker kabulü aynı eski paketin iki sürecini ve yeniden başlatmasını sınamıştı. Yeni `--f04-worker-devir-prova` modu, eski süreçlerin durduğunu doğruladıktan sonra güncel pakete geçmeyi ve tekrar eski pakete dönmeyi sınar. Gerçek worker servisi, şirket ayarı veya e-posta sağlayıcısı değiştirilmez.

## Paket ve düzen

Eski paket `.release-candidates/soz-eposta-20261019/runtime`, güncel çıktı önceki servis geçişinde derlenmiş `.release-candidates/f04-servis-gecis-20261022/yeni-api` kopyasıdır. Güncel `dist`, Prisma istemcisi ve workspace dist dosyaları eski bağımlılık tabanına salt okunur bağlanır. Her iki aşamada gerçek `main.odeme-sozu-worker.js` girişi çalışır. Worker iş mantığının değişmiş olduğu varsayılmaz; devir, farklı sabit runtime/istemci kopyaları ve ortak DB gönderim geçmişi arasında sınanır. Bu düzen yeni temiz bağımlılık kurulumu değildir.

Runner’ın kendi PostgreSQL 16 restore DB’si, nonce ve uygulama rolü kontrol edilir. Önce beş gerçek HTTP/tarayıcı ve beş restore testi çalışır; 219 public tablonun yedek/restore içeriği eşleşmelidir. SMTP yalnız internal Docker ağındaki fixture’dır; host portu veya gerçek alıcıya teslim yoktur. Ödeme sözü akışı gerçek DB saatini kullanır ve gönderim koşumu Türkiye saati 09:00–24:00 arasında yapılır.

## Devir sırası

1. Önceki sekiz özel worker kontrolü korunur: iki eski süreç, tek gönderim, tenant sınırı, belirsiz yarım gönderim, yeniden başlatma ve salt okunur/pilot davranışı. Bu aşama sonunda iki farklı söz için toplam iki ileti vardır.
2. İki eski süreç SIGTERM ile durdurulur. Docker durumunda `Running=false`, `OOMKilled=false` ve normal kapanış/SIGTERM çıkış kodu (0 veya 143) doğrulanır; SIGKILL/137 kabul edilmez. Yeni söz ancak bu kontrollerden sonra oluşturulur.
3. Güncel paketle tek özel worker başlatılır. İlk tarama tamamlanıp health 200 verdikten sonra toplam üç ileti olmalıdır. Yeni söz bir kez gönderilir; önceki sözlerin gönderildi durumu ve deneme 1 bilgisi korunur. Eski süreçler hâlâ kapalıdır.
4. Güncel worker yeniden başlatılır. İleti sayısı üçte kalır; eski süreçler açılmaz.
5. Güncel worker durdurulup aynı kapanış kontrollerinden geçirilir. Yeni bir söz oluşturulur; yalnız bir eski süreç yeniden açılır. Eski paket güncel paketin oluşturduğu kayıtları tekrarlamadan bu yeni sözü gönderir. Toplam dört farklı Message-ID, dört gönderildi geçmişi ve her söz için deneme 1 doğrulanır.

Diğer tenant gönderimsiz, yarım kalmış gönderim belirsiz kalmalıdır. Beş F04 tablosu, F04 ayarları ve ihtiyaç audit içerikleri önce/sonra eşleşir. Paket dosyaları başta ve sonda doğrulanır; yalnız gönderim fixture’ları yeni e-posta/hatırlatma satırları üretir.

Bu devir, taraması tamamlanmış worker’lar arasında yapılır. Canlı SMTP görüşmesini ortasında kesme veya belirsiz dış sağlayıcı teslimini çözme kabulü değildir. Belirsiz gönderim için otomatik tekrar yapılmaması ayrıca korunur. API/web trafik geçişi bu modda tekrar koşulmaz; önceki ayrı kanıttır. Genel `main.worker.js` kuyruklarının devri de bu özel ödeme sözü worker’ı testiyle tamamlanmış sayılmaz.

## Sonuç

**5 gerçek HTTP/tarayıcı + 5 restore testi ve 13 özel worker/devir kontrolü geçti.** İlk koşum başarılıdır. Eski iki süreç ve geri alınan güncel süreç, OOM veya SIGKILL olmadan **exit 0** ile kapandı. Güncel worker önceki iki gönderimi tekrarlamadan üçüncü sözü işledi; yeniden başlatılması sayıyı artırmadı. Eskiye dönüşte dördüncü söz işlendi; toplam dört farklı Message-ID ve dört gönderildi geçmişi oluştu. Her sözün deneme sayısı 1 kaldı. Diğer tenant gönderimsiz, yarım gönderim belirsiz kaldı.

219 public tablonun restore eşitliği doğrulandı. Worker aşamasında beş F04 tablosu, F04 mod ayarları ve ihtiyaç audit içerikleri değişmedi. Eski ve güncel paket dosyaları önce/sonra aynıydı; manifest hash’leri önceki başarılı kabul kayıtlarıyla da eşleşti. Üç worker, SMTP ve geçici DB konteynerleriyle ağ temizlendi; ana süreç exit 0 ile bitti. JavaScript sözdizimi ve diff kontrolleri başarılıdır.

Ürün/API/web kaynakları ve migration değişmedi; yeni derleme yapılmadı. API/web servis geçişinin 10 kontrolü, geçiş kapısının 18 odaklı HTTP testi ve genel worker’ın önceki kontrolleri bu koşumda tekrar sınanmış sayılmaz. 13 kontrol önceki sekiz özel worker davranışını da tekrarlar; farklı iş senaryosu sayısı olarak toplanmaz.

## Tekrar ve kanıt

```bash
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-worker-devir-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-worker-devir-prova
```

Geçici `/tmp` API/web derlemeleri kayıpsa önceki belgelerden yeniden üretilir. Güncel worker kopyası `f04-gecis-paketle.mjs` tarafından hazırlanmış sabit paketten gelir; mevcut paketin üzerine yazılmaz. Gerçek hedef bağlantısı kabul edilmez.

Kanıt dizini `.release-candidates/f04-worker-devir-20261022/`; `ozel-worker-geri-donus.json`, ana `kabul-ozeti.json`, HTTP/restore logları ve `kaynak-kaniti.json` birlikte okunur. Hedef servis yöneticisi, genel kuyruk worker devri, hedef hacim/kesinti bütçesi, kapasite kararı ve gerçek alan pilotu açık kalır.
