# F04 — Gönderim rezervasyonu sonrası kesinti ve mükerrer gönderim koruması

23 Ekim 2026. Önceki e-belge aktif iş kabulü sağlayıcı çağrısından önce kesiliyordu. Bu dilim gerçek DB’de rezervasyon commit edildikten, yerel test sağlayıcısı belgeyi kabul ettikten ve sonuç DB’ye yazılmadan önce istemci sürecini SIGKILL ile durdurur. Sonraki süreçte aynı belgeyi benimseme, taze rezervasyonu koruma ve belirsiz yeniden gönderimi engelleme sınanır.

## Ürün düzeltmesi

Önceki `gonder` yolu yeniden denemede yalnız `adapter.belgeAra` varsa sağlayıcıda belge arıyordu. Arama desteği olmayan adaptörde önceki dış sonuç bilinmese de yeniden gönderim yapılabiliyordu. Güncel servis bu durumda ServiceUnavailableException ile durur; gönderim çağrısı yapmaz ve rezervasyon hata bilgisiyle korunur. İlk gönderim arama desteği olmayan adaptörde çalışmaya devam eder. Sorgu desteği olan adaptörün sorgusu başarısızsa mevcut koruma da sürer.

Bu davranış özellikle `belgeAra` sunmayan sağlayıcılarda yeniden gönderimi engeller; önceki sonucun doğrulanması veya uygun adaptör desteği gerekir. Eski sabit geri dönüş paketi bu yeni korumayı içermez. Önceki eski/güncel worker devir kabulleri bu düzeltmenin o arşivlere yayıldığını göstermez. Migration yoktur.

## Kabul düzeni

`--f04-ebelge-rezervasyon-prova` önce 5 HTTP/tarayıcı ve 5 restore testini çalıştırır. Ardından restore DB’de altı yeni test çalışır. Güncel tam API çıktısındaki gerçek EbelgeService, PrismaService, tenant bağlamı, şifre çözme, rezervasyon, UBL üretimi, sonuç yazımı ve XML arşivi kullanılır. Her istemci ayrı Node sürecidir; aynı DB kayıtlarını paylaşır.

Sağlayıcı sınırında enjekte edilen fixture adaptörü, yalnız nonce içeren 127.0.0.1 adresindeki geçici HTTP sunucusuna çağrı yapar. Gerçek NES/Sovos adaptörü, sağlayıcı protokolü veya dış hesap kabulü değildir. Kullanılmayan bağımlılıklar çağrılırsa test açık hata verir. Nest uygulaması, HTTP kullanıcı endpoint’i, BullMQ, backoff ve tam worker lifecycle bu dilimde çalıştırılmaz.

1. İlk gönderim gerçek DB rezervasyonu oluşturur. Yerel fixture belgeyi belleğine kaydeder ve yanıtı bekletir. Test DB’de kuyrukta/ref=null/arşiv=null kaydını görür, istemciyi SIGKILL ile kapatır. Yeni süreç aynı taze rezervasyonu 409 ile reddeder; ikinci gönderim yapılmaz.
2. Aynı kaydın `updatedAt` alanı **yalnız test fixture’ında** 20 dakika geçmişe alınır. Bu, varsayılan 15 dakika korumasının doğal süre bekleme kabulü değildir. Yeni süreç fixture’da belgeyi bulur, mevcut referansı benimser, aynı e-belge kaydını iletildi yapar ve XML arşivler. Sağlayıcı gönderim sayısı bir, arama sayısı bir kalır; finansal fatura/satır ve hareket içerikleri değişmez.
3. Önceden hata durumunda olan kayıt, arama desteği olmayan adaptörle tekrar denenir. Ağ çağrısı yapılmaz; 503 ve mükerrer gönderim riski bilgisi saklanır.
4. Önceki belge sorgusu yerel sağlayıcıdan 503 alır. Gönderim yapılmaz; kayıt hata durumunda kalır.
5. Arama belgeyi bulamazsa yalnız bir gönderim yapılır ve XML arşivlenir.
6. İlk gönderim arama desteği olmayan adaptörde de başarıyla çalışır.

Her fixture farklı tenant, kullanıcı, cari, hizmet kartı ve fatura kullanır. Test DB adresi, uygulama rolü, nonce ve RLS bypass olmaması hem testte hem istemci sürecinde denetlenir. Gerçek `.env` dosyası yüklenmez. Runner, F04 plan/pay/bağ tabloları, şirket modu ve ihtiyaç audit içeriklerini kabul öncesi/sonrası karşılaştırır.

## Tekrar çalıştırma

Güncel ürün düzeltmesini içeren API çıktısı:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir /tmp/tekir-f04-rezerv-api
```

Önceki odaklı HTTP derlemesi `/tmp/tekir-f04-genel-http-api` yoksa ilgili HTTP kabul belgesinden yeniden hazırlanır. Proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_REZERV_API_DIST=/tmp/tekir-f04-rezerv-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-ebelge-rezervasyon-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-ebelge-rezervasyon-prova
```

Odaklı servis testleri API dizininde `pnpm exec vitest run src/ebelge/ebelge.test.ts` ile çalışır. Koşum başına ayrı evidence dizini kullanılır. Yeni test güncel derlemede arama desteği korumasının varlığını denetler; eski çıktıyla yanlış kabul üretmez.

## Sonuç

İlk koşum **exit 0** ile tamamlandı: **75 servis testi, 5 gerçek HTTP/tarayıcı + 5 restore testi ve 6 rezervasyon/yerel sağlayıcı DB testi geçti.** Güncel tam API TypeScript derlemesi ve sözdizimi/diff kontrolleri başarılıdır. Önceki 37 tam worker/devir kontrolü bu modda tekrar koşulmadı.

Yerel sağlayıcının ilk belgeyi kabulünden sonra istemci SIGKILL ile sonlandı; DB rezervasyonu kuyrukta/ref=null/arşiv=null kaldı. Taze rezervasyonda yeni süreç 409 verdi. Testte geçmiş tarihli hale getirilen aynı kayıt, sonraki süreçte aynı fixture referansıyla iletildi durumuna geldi; ikinci sağlayıcı gönderimi veya ikinci e-belge oluşmadı. XML arşivi üretildi ve finansal fatura/satır/hareket içerikleri korundu. Arama desteği olmayan veya araması 503 veren adaptörde hiçbir gönderim yapılmadı. Belge bulunamayan tekrar ve ilk gönderim yolları birer gönderimle tamamlandı.

221 public tablonun restore içeriği eşleşti. Beş F04 tablosu, şirket modu ve ihtiyaç audit içerikleri rezervasyon kabulü öncesi/sonrası aynı kaldı. İstemci süreçleri ve yerel HTTP sağlayıcı kapatıldı; geçici PostgreSQL otomatik silindi. Üst raporda geciciDbSilindi=true. Yeni ürün derlemesi yalnız `/tmp` çıktısıdır; yayın veya sabit paketlerin üzerine yazma yapılmadı.

Kanıt dizini `.release-candidates/f04-ebelge-rezervasyon-20261023/`; `kabul-ozeti.json`, `ebelge-rezervasyon-kabul.log`, `ebelge-rezervasyon-saglayici.json`, HTTP/restore logları ve `ebelge-rezervasyon-kaynak-kaniti.json` birlikte okunur. Sağlayıcı protokolü/gerçek hesap, güncel korumalı paketin tam worker kabulü ve geri dönüş kısıtları, doğal 15 dakika beklemesi, hedef işletim/hacim ve gerçek alan pilotu açık kalır.
