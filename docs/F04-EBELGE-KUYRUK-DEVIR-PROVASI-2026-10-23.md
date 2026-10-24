# F04 — E-belge kuyruğunda yerel ret, dead-letter ve kontrollü devir

23 Ekim 2026. `--f04-ebelge-devir-prova`, tam eski paket ve genel worker devri kabulüne sekiz e-belge kontrolü ekler. Gerçek sağlayıcı bağlantısı, şirket servisi veya canlı Redis kullanılmaz. Yeni ürün derlemesi veya migration yoktur; önceki sabit eski/güncel paketler aynı internal Redis ve restore DB ile çalışır.

## Kapsam

Prova tenant’larında aktif e-belge bağlantısı bulunmadığı doğrulanır. Gerçek `main.worker.js` ve `tekirextra-ebelge`/`tekirextra-ebelge-dead-letter` kuyrukları kullanılır. İşler sentetik kuyruk üreticisiyle eklenir; HTTP e-belge gönderim/retry akışı sınanmış sayılmaz. Worker’ın gerçek servisleri, tenant bağlamı ve RLS çalışır.

1. Eski worker, var olmayan fatura kimliği için durum sorgusunu completed/atlandı sonucuyla tamamlar; dead-letter oluşturmaz.
2. Var olmayan faturayı gönderme işi yerel NotFound hatasıyla failed olur. attempts=5 ayarına rağmen UnrecoverableError nedeniyle tek deneme yapılır; aynı job ID’ye bağlı tek dead-letter kaydı beklenir.
3. Eski worker SIGTERM ile durdurulur. OOM olmayan exit 0/143 doğrulanır. Yeni durum/gönderim işleri waiting kalır.
4. Güncel worker iki işi devralır; sonuçlar aynı olur. Önceki dead-letter kaydının bütün içeriği korunur.
5. Güncel worker yeniden başlatılır; dört işin sayaçları, sonuçları ve dead-letter içerikleri aynı kalır.
6. Sentetik ana job aynı kimlikle kaldırılıp yeniden eklenir, dead-letter’a dokunulmaz. Gerçek worker mevcut dead-letter nedeniyle işi atlar. Bu yalnız tüketici koruması testidir; kullanıcı retry API’si dead-letter’ı bilerek kaldırabilir ve bu test onun kabulü değildir.
7. Güncel worker kontrollü durdurulup eski worker açılır. Yeni durum sorgusu ve başka tenant’ın gerçek fatura kimliğini taşıyan gönderim işi bekleyen kuyruktan alınır. İkinci iş Fatura bulunamadı hatasıyla reddedilir; dead-letter işi isteyen tenant’a bağlıdır. Önceki dead-letter kayıtları değişmez.
8. Eski worker yeniden başlatılır. Altı benzersiz işin mevcut sayaç/sonuçları ve üç dead-letter içeriği korunur. Kaynak faturanın ve e-belge kayıtlarının içerik özeti aynı kalır; diğer tenant’ta e-belge oluşmaz.

Job kimliği bir kez sentetik olarak yeniden kullanılır; altı benzersiz job, yedi ayrı job yaşam döngüsü vardır. Her yaşam döngüsü bir attemptsMade ve attemptsStarted ile sonlanır; yeniden oluşturma sayaçlarını koruyan job retry testi değildir.

Bu kabul yerel ret/atlama, dead-letter koruması ve bekleyen iş devrini sınar. Sağlayıcı çağrısı, geçici sağlayıcı hatası/backoff, belirsiz dış teslim, e-belge işi sırasında SIGTERM/SIGKILL ve stalled kurtarma açık kalır. Önceki personel SIGKILL/SIGTERM kabulü e-belgeye uygulanmış sayılmaz. Personel kuyruğunun önceki temel devir kontrolleri bu modda tekrar çalışır; uzun aktif/SIGKILL modları ayrıca seçilmez.

## Tekrar çalıştırma

Önceki odaklı API çıktısı mevcut değilse:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-genel-http-api
```

Ardından proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-ebelge-devir-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-ebelge-devir-prova
```

Önceki kanıtları korumak için koşum başına ayrı evidence dizini kullanılır. Sabit paket manifestleri, üst kabul raporu, HTTP/restore logları ve `tam-paket-geri-donus.json` içindeki ebelgeDevir ile sekiz yeni kontrol birlikte okunur.

## Sonuç

İlk koşumda sekiz e-belge kontrolü geçti; sonraki genel salt okunur HTTP kontrolünün transport katmanı `docker exit 1` ile ayrıntısız durdu. Tam koşum başarılı sayılmadı. Geçici kaynaklar temizlendi; rapor `.release-candidates/f04-ebelge-devir-20261023-ilk-deneme/` altında korundu. Kesin kök neden bu rapordan çıkarılamaz.

HTTP gözlemcisine hata adı/mesajı/neden kodu ve son kontrol adı eklendi. Prova isteği zaman aşımı 8 saniyeden 20 saniyeye, dış komut bütçesi 15 saniyeden 25 saniyeye çıkarıldı; mutasyon tekrar denenmez. Bunlar prova aracı değişiklikleridir; ürün HTTP sözleşmesi değişmedi.

Düzeltilmiş koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 30 tam paket/devir kontrolü geçti.** 30 kontrol önceki temel genel worker/tam paket kabulünün 22 kontrolünü ve sekiz e-belge kontrolünü içerir; önceki personel aktif/SIGKILL kontrol sayıları bu koşuma eklenmez.

Altı benzersiz e-belge işi işlendi; bir sentetik kimlik dead-letter korumasını sınamak için yeniden oluşturuldu. Üç dead-letter kaydının içeriği sürüm geçişi ve restart sonrasında korundu. Kayıtsız durum sorgusu atlandı; kalıcı gönderim reddi attempts=5 ayarına rağmen tek denemede sonlandı. Başka tenant’ın faturasına erişim yerel NotFound ile reddedildi; fatura ve e-belge kayıtlarının içerikleri değişmedi.

221 public tablonun yedek/restore içerikleri eşleşti. Beş F04 tablosu, şirket modu ayarları ve ihtiyaç audit içerikleri korundu. Eski/güncel paketler koşum sonunda yeniden doğrulandı. API, web, iki worker, Redis, MinIO, PostgreSQL ve ağ temizlendi; üst raporda geciciDbSilindi=true ve alt raporda temizlik=true. Sözdizimi ve diff kontrolleri başarılıdır. İlk koşumun transport hatasının kök nedeni bu başarılı tekrar ile kanıtlanmış sayılmaz.

Kanıt dizini `.release-candidates/f04-ebelge-devir-20261023/`; `tam-paket-geri-donus.json` içindeki ebelgeDevir ve sekiz kontrol, üst `kabul-ozeti.json`, HTTP/restore logları ve `ebelge-devir-kaynak-kaniti.json` birlikte okunur. Ürün kaynakları ve migration bu dilimde değiştirilmedi. Gerçek sağlayıcı teslimi, geçici dış hata/backoff, e-belge aktif iş kesintisi/kurtarması, hedef işletim/hacim, kapasite ve alan pilotu açıktır.
