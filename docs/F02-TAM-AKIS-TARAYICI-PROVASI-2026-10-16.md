# F02 standalone web ve gerçek API/worker tarayıcı provası

**Tarih:** 16 Ekim 2026. Hedef, dördüncü adayın standalone web paketini bağımlılıkları paketlenmiş API/worker ile birlikte sınamaktır. Gerçek şirket veya çalışan localhost servisleri kullanılmaz; sentetik kullanıcının gerçek parolası tarayıcıdaki giriş formuna yazılır.

**Sonuç:** Son koşumda 11 paket/API/worker kontrolü ve 3 gerçek tarayıcı senaryosu, toplam **14 kontrol geçti**. Dosyaların son karşılaştırması ve geçici ortam temizliği başarılı. Başlangıç/bitiş: 16 Ekim 2026 20:55:26–21:07:30 TRT. Bu koşum süreleri kapasite/SLA kabulü değildir; sistem yükü yüksekti.

[Sonuç raporu](../.release-candidates/f02-pilot-20261016-4/f02-tam-akis-prova.json), [9 kanıt dosyasının SHA-256 manifesti](../.release-candidates/f02-pilot-20261016-4/f02-tam-akis-kanit-manifest.json).

| Gerçek tarayıcı senaryosu | Kanıt |
| --- | --- |
| Manuel pilot: form girişi, takip bağlantısı, görüşme POST 201, yenileme sonrası geçmiş ve API'de iki görüşme, söz okuma | [Masaüstü görüntüsü](../.release-candidates/f02-pilot-20261016-4/tam-akis-e1e2965522ca7f9e/pilot-masaustu.png) ve [ham istekler](../.release-candidates/f02-pilot-20261016-4/tam-akis-e1e2965522ca7f9e/pilot-masaustu-istekler.json) |
| Salt okunur masaüstü: geçmiş görünür, F02 yazma düğmeleri yok | [Masaüstü görüntüsü](../.release-candidates/f02-pilot-20261016-4/tam-akis-e1e2965522ca7f9e/salt_okunur-masaustu.png) |
| Salt okunur mobil: ayrı gerçek giriş, geçmiş/söz tablosu ve yazma sınırları | [390×844 görüntüsü](../.release-candidates/f02-pilot-20261016-4/tam-akis-e1e2965522ca7f9e/salt_okunur-mobil.png) |

Üç tarayıcı senaryosunda sayfa JavaScript hatası ve API 5xx görülmedi. Node tabanlı API/worker kontrolleriyle birlikte çalıştırıldı; worker gerçek geciken sözü bağladıktan sonra bellek yükünü azaltmak için kontrollü durduruldu. Son durumda API/web çalışıyordu, worker çıkışı 0 ve üçünün OOM göstergesi false idi; ardından tüm geçici kaynaklar temizlendi.

Son koşum başında çalışma alanı ile sabit aday arasında **15 dosya farkı** kaydedildi; bunlar şema, belge dili migration'ı, ayar, belge/PDF servisleri ve shared dosyalarını da içeriyor. Aday dosyalarının kendi manifestleri eşit kaldı. Sonuç, bu yeni kaynakların kabulü değildir; güncel kaynaklar için ayrı aday ve doğrulama gerekir. Gerçek şirketin doğal iş örneği ve alan kabulü ertelenmiş durumda; canlı yayın yapılmadı.

## Sabit aday ve çalışma alanı ayrımı

Ana aday: `f02-20261016T070519121Z-c0319aa2`; web BUILD_ID: `qOC2BEKveb5K46ZC9XeXN`. Runtime: `api-worker-runtime-20261016T172341681Z-5b7b66`, dosya özeti `be5a4dca2e7826d0c13468dd04e6751929773246e1ce9d1a9063671a4fc3b2dc`. [Runtime/PDF/arşiv kaydı](F02-API-WORKER-RUNTIME-PAKETI-2026-10-16.md).

İlk koşum, tarayıcı başlamadan kaynak eşitliği kontrolünde durdu. Çalışma alanında adaydan sonra eklenmiş/değişmiş altı dosya bulundu:

- `apps/api/src/core/pdf/belge-gorunumu.ts`
- `apps/api/src/core/pdf/belge-sozlugu.ts`
- `apps/api/src/core/pdf/yaziyla.test.ts`
- `apps/api/src/core/pdf/yaziyla.ts`
- `packages/shared/src/belge-dili.ts`
- `packages/shared/src/index.ts`

Bu dosyalara müdahale edilmedi. [İlk koşum raporu](../.release-candidates/f02-pilot-20261016-4/f02-tam-akis-prova-kaynak-degismis.json) korundu; geçici kaynaklar temizlendi. Sonraki koşum çalışma alanının güncel olduğunu iddia etmeden sabit aday dosyalarını `kaynak:false` ile doğrular; farkların dosya adları ve iki sürümün özetleri rapora yazılır. Bu kapsam güncel kaynakların derleme veya yayın kabulü değildir. Yeni kaynaklar yayımlanacaksa yeni aday üretilmelidir.

Çalışma alanındaki değişiklikler sürdüğü için sonraki koşumda `apps/api/src/core/pdf/ticari-belge.ts` de fark listesine girdi. Her koşumun başlangıcındaki kesin liste kendi JSON raporundadır.

## İzole yerleşim

[Prova betiği](../.release-candidates/f02-pilot-20261016-4/f02-tam-akis-prova.cjs) ve [tarayıcı programı](../.release-candidates/f02-pilot-20261016-4/f02-tam-akis-tarayici.cjs), ayrı nonce işaretli PostgreSQL ve RLS'ye tabi uygulama rolü kullanır. Redis/MinIO da geçicidir. Uygulamalar dış erişimi kapalı Docker ağında çalışır. Yalnız test DB denetim bağlantısı rastgele loopback portuyla açılır; gerçek PostgreSQL portları reddedilir.

API ve worker `/runtime`, standalone web `/web` altında salt okunur bağlanır. Node 22.23.2 ve önceki provanın sabit OS imajı kullanılır; eski imajın uygulaması başlatılmaz. Web API ile aynı ağ ad alanını paylaşır. Böylece adayın `http://127.0.0.1:3001/api/v1` rewrite hedefi korunur; tarayıcı yalnız web origin'i `http://127.0.0.1:3100` üzerinden istek yapar.

API yanıtı taklidi, `page.route` veya sessionStorage'a token enjekte edilmez. Anonim korumalı sayfa girişe yönlendirilir; form girişi gerçek AuthGuard/JWT oturumunu başlatır. Geçici tenant dışında ayar veya iş kaydı yazılmaz.

## Tarayıcı kapsamı

1. Manuel pilotta bildirim hedefiyle doğru takip açılır, mevcut görüşme görülür; ekrandan yeni görüşme kaydedilir ve sayfa yenilenince korunur. Ardından cari Tahsilat sekmesinde gerçek API'nin söz tablosu okunur. Görüşme sayısı ayrıca HTTP üzerinden doğrulanır.
2. Aynı geçici şirket salt okunur yapıldıktan sonra yeni bir masaüstü oturumunda gerçek form girişi tekrarlanır. Geçmiş görünür; takip düzenleme, görüşme ekleme ve yeni söz düğmeleri görünmez.
3. Salt okunur akış 390×844 mobil görünümde ayrı gerçek girişle tekrarlanır.

Tarayıcı programı JavaScript sayfa hatalarını, API 5xx yanıtlarını ve başarılı giriş/söz/görüşme isteklerini kontrol eder. Ekran görüntüleri testin ayrı kanıt dizinine yazılır. API/worker temel kontrolleri de aynı geçici ortamda çalışır; önceki raporların test sayıları yeniden toplanmaz.

## Prova aracı düzeltmesi

İki tarayıcı denemesi görüşme POST yanıtı kontrolünde başarısız oldu. İlk yorum HTTP durum beklentisinin fazla katı olduğu yönündeydi; [ham istek kaydı](../.release-candidates/f02-pilot-20261016-4/tam-akis-c075feca0f3ed2e0/pilot-masaustu-istekler.json) görüşme POST yanıtının hiç alınmadığını gösterdi. Genel metin seçicisi formdaki metni de eşleştirebildiğinden, test kayıt tamamlanmadan sayfayı yeniliyordu. Bu denemeler kalıcı görüşme kanıtı sayılmaz.

Program düzeltildi: Kaydet'e basmadan önce gerçek görüşme POST yanıtını beklemeye başlar; yanıt 201 olmalıdır. Ardından formun kapanması ve yalnız geçmişteki `article` içinde notun görünmesi beklenir. Yenileme bundan sonra yapılır; geçmiş ayrıca API'den okunup görüşme sayısı 2 olarak doğrulanır. Başarısız koşumların raporları ve görüntüleri korundu; uygulama kodu bu düzeltme için değiştirilmedi.

Bir sonraki koşum geçici API başlangıcında durdu; günlük boş olduğundan kesin neden belirlenmedi. [Başlangıç raporu](../.release-candidates/f02-pilot-20261016-4/f02-tam-akis-prova-api-baslangic.json) ve başarılı temizlik kaydı korundu. Prova API/worker Node heap sınırı 256 MiB, konteyner sınırı 768 MiB olacak şekilde düzenlendi; worker işlev kontrolünden sonra tarayıcı öncesinde durdurulur. Sonraki raporlar konteyner çıkış/OOM durumunu da kaydeder. Bu yerel kaynak düzenlemesi üretim bellek veya kapasite kabulü değildir.
