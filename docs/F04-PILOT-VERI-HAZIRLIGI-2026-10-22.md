# F04 — Pilot veri hazırlığı ve alan kabulü

22 Ekim 2026. Bu dilim seçilmiş örneklerden salt okunur veri hazırlığı raporu üretir. Gerçek şirket pilotu yapılmadı. Şirket/depo, alan sorumlusu ve kapasite tercihi henüz seçilmedi; alan kabulü kapatılmaz. Mevcut analiz davranışı korunur: plan kaydetmek stok veya farklı planlara karşı kapasite ayırmaz.

## Salt okunur rapor

`POST /api/v1/stok/ihtiyac-plani/pilot-onizle` yönetici, muhasebe ve depo rollerine açıktır. Başarılı yanıt 200 ve `Cache-Control: no-store` içerir. Gövde yalnız `ornekler` alanını, her örnek yalnız tekil bir `etiket` ve mevcut ihtiyaç önizlemesinin beş girdisini kabul eder. Bir raporda 1–10 örnek bulunur; etiket 1–80 karakterdir. Tenant istek gövdesinden alınmaz.

```json
{
  "ornekler": [
    {
      "etiket": "Pilot hammadde / ihtiyaç günü",
      "girdi": {
        "stokId": "<seçilmiş gerçek stok UUID>",
        "depoId": "<seçilmiş gerçek depo UUID>",
        "miktar": "8",
        "birim": "adet",
        "ihtiyacTarihi": "<bugün veya sonrası YYYY-AA-GG>"
      }
    }
  ]
}
```

Örnek değerler şablondur; gerçek UUID ve planlama günü seçilmelidir. Endpoint POST kullanmasına rağmen iş verisi yazmaz. Tüm örnekler tek repeatable-read transaction’da, PostgreSQL `READ ONLY` modunda hesaplanır. İşlem üst sınırı 30 saniyedir. Mevcut kaynak başına/birleşik kaynak başına 5000 sınırları korunur; bunlar aşılırsa kısmi kaynakla yeterlilik verilmez. Türkiye günü rapor sırasında değişirse rapor bütünü 409 ile yeniden alınır.

Her örnek mevcut tarihli motorla hesaplanır. Yanıtta anlık stok/rezerv/kullanılabilir miktar, birim dönüşümü, tarihli giriş/ek talep, sonuç durumu, açık, dönem içi en büyük açık, hareket ve dışlanan kaynak sayıları, dışlanma nedeni dağılımı ve sonuç kanıtı bulunur. Kaynak geçmişinin bütün satırları veya büyük snapshot rapora taşınmaz. Beklenen 400/404/409 iş/veri sorunları örnek içinde `reddedildi` olarak gösterilir; bütün sonuçların başarılı olduğunu anlamak için özet ve her örnek okunmalıdır. Beklenmeyen DB/yazılım hatası tüm raporu başarısız kılar.

Özet yalnız örnek adetlerini sayar: hesaplanan, veri belirsiz, reddedilen, doğrulanmış tedarik açığı bulunan ve dönem sonunda görünen açıktan daha büyük dönem içi açığı bulunan örnekler. Sayaçlar farklı boyutlardır; bazıları aynı örneği kapsar. Ürün veya birim miktarları toplanmaz. `raporKapsami: secili_ornekler`, `dbSaltOkunur: true`, `kapasiteAyrildi: false` ve `operasyonPilotuTamamlandi: false` açıkça döner. Seçilmiş örnek sonucu tüm şirketin termin kapsaması, performans kabulü veya gerçek alan kabulü sayılmaz.

## Alan pilotuna giriş

Aşağıdakiler alan sahibiyle doldurulmadan G0/G2 tamamlandı denmez:

| Alan | Durum |
|---|---|
| Şirket ve tek pilot depo | Bekleniyor |
| Alan sorumlusu ve sonucu doğrulayacak kullanıcı | Bekleniyor |
| Ölçüm dönemi ve doğal iş örnekleri | Bekleniyor |
| Kapasite tercihi: bağımsız analiz veya planlar arasında tahsis | Kullanıcı kararı bekleniyor; mevcut analiz davranışı değişmedi |
| Pilotun çalışacağı API/web paketi ve migration durumu | Geçiş öncesinde somut ortamda doğrulanmalı |
| Karantina/kalite blokajı ve varyant gibi kapsam dışı verilerin ayrımı | Örnek seçiminde kanıtlanmalı |

Gerçek şirkette sentetik stok, ödeme veya fatura oluşturulmaz. Salt okunur hazırlık için doğal işlerden ürün/depo/miktar/birim/gün örnekleri seçilir. Örnek rapor alan sahibinin mevcut kayıtlarla kontrolü için saklanır. Doğrulanmamış sipariş tarihleri ve üretim atamaları ancak doğal kaynak kanıtıyla, gerekçeli mevcut ekranlardan düzeltilir; rapor bunları kendiliğinden değiştirmez.

## Kabul senaryoları ve kanıt

| Senaryo | Beklenen sonuç | Alan sahibinin doğrulayacağı kanıt |
|---|---|---|
| Stok 10, rezerv 4, ihtiyaç 8 | Kullanılabilir 6, açık 2 | Depo bakiyesi ve aktif rezerv kaynağı |
| Tarihi doğrulanmamış alış siparişi | Giriş yeterlilikte kullanılmaz; dışlanma nedeni görünür | Tedarikçi teyidi ve sipariş satırı |
| Doğrulanmış girişin kısmi teslimi | Yalnız açık kalan giriş; teslim tekrar eklenmez | Sipariş–irsaliye/fatura zinciri |
| Atanmamış veya eski üretim ihtiyacı | Yeterlilik doğrulanamaz | Malzeme kalemi, tüm depolardaki rezerv ve açık depo/gün ataması |
| Dönem içinde daha erken açık | Hedef gün yeterli görünse de erken açık ayrıca ele alınır | Giriş ve tüketim günleri |
| Kaynak değişmiş kayıtlı plan | Tarihsel plan korunur; yeni taslak eski kanıtla açılmaz | Plan snapshot ve güncel kaynak |
| Aynı plandan tekrar taslak | Tek talep, tek bağlantı; otomatik onay yok | Talep, olay ve audit |
| Farklı iki plan aynı stoğu gösteriyor | Bağımsız analiz oldukları açık; stok ayrılmış sayılmaz | Gerçek rezerv değişmediği ve kullanıcı kapsam kabulü |
| Başka şirket veya desteklenmeyen varyant/birim | Veri sızıntısı veya yanlış birleşme yok; reddedilen örnek | Tenant ve kart/birim tanımı |

Sentetik özel durumların teknik kanıtı izole kabul testleridir. Gerçek alan pilotunda yalnız doğal olarak mevcut örnekler yürütülür; bulunmayan örnek “atlandı / doğal örnek yok” olarak kaydedilir. Bu, o senaryonun gerçek pilotta geçtiği anlamına gelmez.

## Ölçüm ve kapanış kaydı

Baz ve sonuç ölçümlerinde aynı şirket/depo, seçilmiş ürün kapsamı ve ölçüm dönemi yazılır. Malzeme kaynaklı gecikme için beklenen/gerçekleşen tarihler ve neden kanıtı; acil talepler için alan sahibinin açık sınıflandırması gerekir. Termin kapsamı hesaplanacaksa tüm uygun açık sipariş satırlarının paydası ve geçerli teyit kuralı ayrıca çıkarılır; bu raporun seçili örnek sayaçlarından şirket geneli yüzdesi türetilmez.

```text
Şirket / depo:
Alan sorumlusu / pilot kullanıcı:
Kapasite tercihi ve karar tarihi:
API/web paket kimliği ve migration doğrulaması:
Baz ve sonuç ölçüm dönemi / kaynakları:
Seçilmiş örnekler ve salt okunur rapor zamanı:
Her doğal iş için beklenen / gözlenen / kaynak kanıtı:
Atlanan örnekler ve nedenleri:
Alan sahibinin kabulü, tarihi ve açık sınırlamalar:
G2 sonucu: bekliyor / düzeltme gerekli / alan kabulü verildi
```

Pilot veri raporu plan saklama veya talep kaydındaki güncel sunucu doğrulamasının yerine geçmez. Kapasite tahsisi seçilirse serbest bırakma, iptal, kısmi sarf, giriş revizyonu ve yarış davranışları ayrı tasarlanıp doğrulanmadan bu özellik açılmaz. Bu belgede o karar alınmış sayılmaz.

## Teknik doğrulama

Son koşum sonuçları ve kaynak kanıtları `.release-candidates/f04-pilot-hazirlik-20261022/` altında tutulur. Bu dilim yeni migration veya web kaynağı değiştirmez. Önceki üretim web paketi gerçek HTTP kabulünde yeniden kullanılır; yeni derlenmiş API, salt okunur rapor ucunu içerir. Gerçek şirket/yayın değişmedi.

Son koşumda **41/41 PostgreSQL/RLS** ve **4/4 gerçek HTTP/tarayıcı** kabul testi geçti. Yeni dört DB testi karma sonuçlu raporun iş verisini değiştirmemesi, belirsiz kaynak nedenleri, rol/girdi sınırları ve DB seviyesindeki yazma engelini doğrular. Yeni HTTP testi 200/no-store yanıtı, anonim/rol/tenant sınırları ve gerçek rapor çıktısını doğrular. Önceki üç birleşik senaryo yeniden geçti. Tam API TypeScript kontrolü ve odaklı HTTP API derlemesi başarılı. Web kaynağı değişmediğinden yeni web derlemesi veya 23 fixture tarayıcı koşumu yapılmadı; önceki web paket kimliği `2EB4omJpWbYNTVcsFRywM` kullanıldı. Her iki son koşumun geçici DB’si silindi ve test servisleri kapatıldı.

`gercek-http/pilot-onizleme.json` yalnız sentetik fixture verisinden üretilmiş örnek rapordur. `gercek-http/http-kabul.log` ham başarılı HTTP koşum çıktısını, `gercek-http/kabul-ozeti.json` DB temizliğini, `kabul-ozeti.json` bütün kontrollerin tool özeti ile sınırlamalarını, `kaynak-kaniti.json` kaynak ve derlenmiş API SHA-256 değerlerini içerir. Önceki başarılı ilk HTTP koşumu `gercek-http-ilk/` altında korunur. API paket yolu geçicidir; bunlar yayın adayı manifesti veya gerçek pilot kabul kaydı değildir.

DB kabulü proje kökünde `node apps/api/scripts/f01-yaris-kabul.mjs --f04` ile çalışır. Gerçek HTTP kabulü için önce `node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-pilot-http-api` ile paket üretin; sonra:

```sh
F04_API_DIST=/tmp/tekir-f04-pilot-http-api F04_WEB_ROOT=/tmp/tekir-f04-bag-web-vr3hvkyy/.next-bag-final/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-pilot-hazirlik-20261022/gercek-http node apps/api/scripts/f01-yaris-kabul.mjs --f04-http
```

Docker ve yerel test portları gerekir. Geçici web paketi silinmişse yeniden üretilmelidir. Yeni API ucunun gerçek pilot ortamına kurulması bu dilimde yapılmadı.
