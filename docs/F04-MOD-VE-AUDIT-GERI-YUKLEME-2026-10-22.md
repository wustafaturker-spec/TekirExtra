# F04 — Şirket modu ve audit ile güncel geri yükleme provası

22 Ekim 2026. Önceki yedek/restore provası, şirket modu kapısı eklenmeden önceki sürüme aitti. Bu dilim güncel derlenmiş API ve standalone web ile aynı izole provayı yeniden çalıştırır; şirket ayarı ve yönetici audit zincirini ayrıca sınar. Gerçek şirket DB’si veya çalışan servis kullanılmaz.

## Kapsam

Gerçek HTTP/tarayıcı kabulü yöneticinin varsayılan kapalı → pilot → salt okunur → kapalı → pilot değişikliklerini yapar. İlk kapalı durum kayıt yokluğudur; dört gerçek güncellemenin her biri audit üretir. Son test, kendi tenant/kullanıcı/plan kimliklerini parola veya token içermeyen `restoreFixture` alanıyla kanıt dosyasına verir. Runner bu kimliklerin UUID biçimini doğrular ve yalnız kendi oluşturduğu restore DB’sindeki testlere aktarır.

Dolu DB migration tekrarı ile bütün public tabloların yedek/restore içerik karşılaştırması korunur. Yeni restore testi gerçek uygulama rolü ve tenant bağlamıyla `pilot` ayarını, dört audit’in mod dağılımını, kullanıcı/modül-kayıt bağlantılarını ve planın güncel erişim bilgisini okur. Bütün restore testleri bittikten sonra audit dahil tüm tablolar yeniden karşılaştırılır; testler kalıcı kayıt değiştiremez.

Başka tenant’ta şirket ayarı bulunmayan plan isteğinin beklenen sonucu yeni şirket kapısıyla 403’tür. Önceki 404 beklentisi güncellendi. Bu, planın varlığını açığa çıkarmaz; yetkisiz başka tenant erişimi yine reddedilir. Pilot ayarı olan yabancı tenant’ın 404 davranışı gerçek HTTP kabulünde ayrıca sınanır.

19 Ekim derlenmiş anlık ihtiyaç modülü önceki manifest hash’leriyle doğrulanır ve restore edilen yeni şemada HTTP üzerinden çalıştırılır. Bu kontrol eski tam API/web/worker paketinin veya eski bağımlılıklarının geri dönüş kabulü değildir. Yeni ayar eski kod tarafından uygulanıyor varsayılmaz; eski sürüme dönüşte erişimin nasıl sınırlanacağı somut işletim planında ayrıca çözülmelidir.

## Sonuç

**5 gerçek HTTP/tarayıcı + 5 restore testi geçti.** Dolu DB migration tekrarı başarılıdır. 219 public tablonun içerik özeti migration tekrarından sonra, restore sonrasında ve restore işlev testleri bitince aynı kaldı. Şirket modu `pilot`, audit sayısı 4, plan güncel ve güncel yazma izni açık olarak doğrulandı. Eski anlık HTTP modülü yeni şemada çalıştı; yeni plan rotası eski modülde bulunmadı. Geçici DB’ler konteynerle birlikte silindi; süreç exit 0 ile bitti.

İlk sandbox denemesi Docker soketine erişemedi ve DB oluşturmadı. İzinli izole koşumun başarılı özeti kanıt dizinindedir. Runner JavaScript sözdizimi ve diff kontrolleri geçti. Ürün kaynakları önceki başarılı derleme hash’leriyle yeniden eşleştirildi; bu test değişiklikleri için tam API/web derlemesi veya 48 DB/26 fixture paketleri tekrar çalıştırılmadı.

## Koşum ve kanıt

```bash
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-mod-restore-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-prova
```

`/tmp` paketleri bu oturumun derlemeleridir. Yeni üretim derlemesi bu dilimde gerekmez; ürün kaynağı değiştirilmedi, test ve runner güncellendi. Önceki [kontrollü açılış](F04-SIRKET-MODU-VE-KONTROLLU-ACILIS-2026-10-22.md) kaynak kanıtı ilgili API/web paketini tanımlar. Yeni test/runner hash’leri bu koşumun kanıtına eklenir.

Kanıt dizini: `.release-candidates/f04-mod-restore-20261022/`. `http-kabul.log`, `restore-kabul.log`, `restore-mod-ozeti.json`, `kabul-ozeti.json`, `geri-donus-ozeti.json`, `eski-api-kaynak-kaniti.json` ve `kaynak-kaniti.json` birlikte okunur. Dump diske yazılmaz; aynı geçici PostgreSQL kümesinde ikinci DB’ye geri açılır. Farklı sunucu/rol kurtarması sınanmaz.

Gerçek alan pilotu, kapasite kararı, hedef hacim/kilit bütçesi ve tam uygulama geri dönüşü açık kalır. Bu prova yayın işlemi değildir.
