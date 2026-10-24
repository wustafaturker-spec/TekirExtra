# F04 — Özel ödeme sözü worker’ının yeni şema uyumu

22 Ekim 2026. [Tam eski paket provasındaki](F04-TAM-ESKI-PAKET-SEMA-UYUMU-2026-10-22.md) genel `main.worker.js` kontrolü, yerel pilotun ayrı ödeme sözü worker’ını kapsamıyordu. Bu dilim `.release-candidates/soz-eposta-20261019/runtime` içindeki gerçek `main.odeme-sozu-worker.js` girişini kendi 19 Ekim bağımlılıkları ve Prisma istemcisiyle yeni şemada çalıştırır. Eski ürün yeniden derlenmez; gerçek şirket ayarı veya çalışan servis değiştirilmez.

## Düzen ve sınırlar

Yeni `--f04-ozel-worker-prova` modu, mevcut beş gerçek HTTP/tarayıcı kabulü ve 219 public tablonun yedek/restore eşitliğinden sonra beş restore testini çalıştırır. Özel worker ayrı internal Docker ağında yalnız bu runner’ın restore DB’sine bağlanır. DB adı, nonce, konteyner adı/test etiketi ve uygulama rolünün RLS/superuser sınırları doğrulanır. Eski paketin bütün dosya hash’leri ve sembolik bağlantıları `paketleme.json` ile önce/sonra karşılaştırılır.

İki ayrı sentetik şirket, gerçek fatura ve bugüne verilen ödeme sözü hazırlanır. İki gerçek özel worker süreci yalnız ilk şirketin tenant kimliğiyle başlatılır. Eski health endpoint’i ilk başarılı taramadan sonra hazır olur; salt süreç canlılığı başarı sayılmaz. Worker’ın saat veya SMTP metodu taklit edilmez.

SMTP yalnız aynı izole ağdaki `f04-smtp-fixture.cjs` test sunucusudur; host portu açılmaz. Gerçek alıcıya teslim yapılmaz. Nodemailer’ın ürettiği MIME ileti `mailparser` ile çözümlenir; Message-ID, `.invalid` alıcısı, 1.000 TRY kalan metni, DB gönderim durumu/deneme sayısı ve e-posta geçmişi doğrulanır. Bu, dış sağlayıcı/TLS/teslim edilebilirlik kabulü değildir.

Kontroller ayrıca başka tenant’ın gönderilmemesini, 11 dakikadan eski yarım gönderimin `belirsiz` kalmasını, iki worker yeniden başlatılınca aynı sözün yeniden gönderilmemesini sınar. Test fixture’ında `tahsilat_operasyonu` salt okunura alınır; yeni uygun söz için gönderim oluşmamalıdır. Tekrar pilot açılıp süreçler yeniden başlatılınca yeni söz tek kez gönderilmelidir. Bu ayar eski F02 tahsilat modudur; F04’ün `stok_ihtiyac_plani` şirket kapısıyla karıştırılmaz. Mod değişiklikleri yalnız sentetik test hazırlığıdır, gerçek şirket kararı değildir.

Beş F04 tablosunun, F04 ayarlarının ve ihtiyaç audit kayıtlarının içerik özeti özel worker aşamasından önce/sonra karşılaştırılır. Özel worker kendi e-posta/hatırlatma satırlarını yazdığı için bu aşamada bütün DB değişmedi denmez. 219 tabloluk tam eşitlik önceki restore aşamasına aittir.

## Sonuç

**5 güncel HTTP/tarayıcı + 5 restore testi ve 8 özel worker kontrolü geçti.** İlk koşum başarıyla tamamlandı. 219 public tablonun restore eşitliği korundu; iki eski worker gerçek giriş dosyasıyla açıldı ve ilk tarama sonrasında health 200 verdi. İzole SMTP’de ilk uygun söz tek MIME ileti üretti; DB’de gönderildi/deneme 1 ve tek e-posta geçmişi kaydı doğrulandı. Yeniden başlatma bu sayıyı artırmadı. Yarım gönderim `belirsiz`, başka tenant gönderimi sıfır kaldı. Salt okunur modda yeni söz gönderilmedi; pilot yeniden açılınca yalnız bu yeni söz eklenerek toplam iki ileti oldu.

F04 plan/pay/talep bağı, mod ayarı ve ihtiyaç audit içerikleri aynı kaldı. Eski worker paketi önce/sonra hash kontrolünden geçti. SMTP ve iki worker konteyneri, internal ağ ve geçici DB’ler temizlendi; ana süreç exit 0 ile bitti. JavaScript sözdizimi ve diff kontrolleri başarılıdır. Güncel ürün kaynakları ve API derlemesi önceki başarılı paket hash’leriyle eşleşir. Bu dilim ürün kodu veya migration değiştirmedi; yeni tam API/web derlemesi ve önceki 48 DB/26 fixture paketleri yeniden koşulmadı.

## Tekrar koşumu

```bash
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-ozel-worker-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-ozel-worker-prova
```

Bu oturumun geçici API/web derlemeleri yoksa kontrollü açılış belgesine göre yeniden üretilir. Eski worker paketi yeniden derlenmez. İşçi gerçek DB saatini kullandığından bu gönderim provası Türkiye saati 09:00–24:00 arasında çalıştırılmalıdır; önceki saatte araç açık hata verir ve bunu başarılı gönderim kabulü saymaz. Test saat değiştirmez veya yalnız zaman penceresi nedeniyle gönderilmeyen örneği geçti saymaz.

Kanıt dizini `.release-candidates/f04-ozel-worker-20261022/`; `ozel-worker-geri-donus.json`, ana `kabul-ozeti.json`, HTTP/restore logları ve `kaynak-kaniti.json` birlikte okunur. Genel worker/API/web tam paket provasının 15 kontrolü bu modda yeniden çalıştırılmaz; önceki kayıt ayrı kanıt olarak korunur.

Bu teknik kabul gerçek servisi durdurup eski pakete trafik taşıma, gerçek e-posta sağlayıcısı, host reboot, hedef hacim veya gerçek alan pilotu kabulü değildir. Kapasite kararı ve gerçek geçiş kapıları açık kalır.
