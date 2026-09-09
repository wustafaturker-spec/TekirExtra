# NES Özel Entegratör Entegrasyonu — TekirExtra

NES (NES Bulut Yazılım Tic. Ltd. Şti.), GİB yetkili özel entegratör ve saklamacı
kuruluştur. Sovos'tan farklı olarak taşıma **REST + JSON**'dur; kimlik doğrulama
tek bir API anahtarının `Authorization: Bearer` başlığında gönderilmesiyle olur,
ayrı bir oturum açma/token alma çağrısı **yoktur**.

Adaptör: `packages/baglanti/src/ebelge/nes-adapter.ts`
Testler: `apps/api/src/tenant/nes-adapter.test.ts`

## Ortamlar

| | |
|---|---|
| Test kökü | `https://apitest.nes.com.tr` |
| Test portalı | `https://portaltest.nes.com.tr` |
| Geliştirici dokümanları | `https://developer.nes.com.tr` (istemci tarafında render edilir) |
| OpenAPI şemaları | `https://apitest.nes.com.tr/{einvoice,earchive,edespatch,esmm,emm}/v1.swagger.json` ve `/general/v1/swagger.json` |

`servisAdresi` yalnızca **kök adresi** tutar; aile ön ekini (`/einvoice`,
`/earchive`, `/edespatch`, `/general`) adaptör ekler. Sovos'taki gibi aile başına
ayrı servis adresi girilmez.

## Sözleşme eşlemesi

| `EntegratorAdapter` metodu | NES ucu |
|---|---|
| `baglantiTest` | `GET /general/v1/einvoice/aliases/Gb` |
| `mukellefSorgula` | `GET /einvoice/v1/users/{vkn}/Pk` |
| `belgeGonder` (e-Fatura) | `POST /einvoice/v1/uploads/document` (multipart) |
| `belgeGonder` (e-Arşiv) | `POST /earchive/v1/uploads/document` (multipart) |
| `durumSorgula` (e-Fatura) | `GET /einvoice/v1/outgoing/invoices/{uuid}` |
| `durumSorgula` (e-Arşiv) | `GET /earchive/v1/invoices/{uuid}` |
| `gelenBelgeleriCek` | `GET /einvoice/v1/incoming/invoices` + `/{uuid}/xml` |
| `yanitGonder` | `POST /einvoice/v1/incoming/invoices/{uuid}/documentAnswer` |
| `earsivIptal` | `GET /earchive/v1/invoices?documentNumber=…` → `POST /earchive/v1/invoices/cancel` |
| `earsivRaporListele` | `GET /general/v1/earchivedocumentsreport/{yil}/{ay}` |
| `irsaliyeGonder` | `POST /edespatch/v1/uploads/document` |
| `irsaliyeDurumSorgula` | `GET /edespatch/v1/outgoing/despatches/{uuid}` |
| `gelenIrsaliyeleriCek` | `GET /edespatch/v1/incoming/despatches` + `/{uuid}/xml` |
| `irsaliyeYanitiGonder` | `POST /edespatch/v1/incoming/despatches/{uuid}/receiptadvice` |

## Sovos'tan davranış farkları

**1. Uygulama yanıtını NES üretir.** Gelen faturaya kabul/ret verirken
ApplicationResponse UBL'ini biz kurmayız; karar ve not JSON gövdesinde gider
(`incomingInvoiceAnswerParameter: KABUL | RED`). `yanitGonder`'in `kaynak`
parametresi bu yüzden NES'te kullanılmaz.

**2. Alıcının yanıtı ayrı belge değil.** NES gelen uygulama yanıtını giden
faturanın `documentAnswer` alanına işler. Bu yüzden `gelenZarflariCek`
**tanımlanmamıştır**; alıcı kararı (EBLG-13) durum sorgusundan okunur.

**3. Toplu zarf durumu yok.** NES zarf/belge durumunu yalnızca tekil sorgular.
`durumSorgulaToplu` **tanımlanmamıştır**, çağıran tekil sorguya düşer (EBLG-14).
Çağrı bütçesi planlanırken bu fark hesaba katılmalıdır.

**4. Gelen tarama kursörsüzdür.** NES `page`/`pageSize` verir. Tarama sürerken
yeni belge girerse sayfalar kayabildiği için adaptör UUID bazında
tekilleştirme yapar ve `SAYFA_TAVANI` ile sonsuz döngüyü keser.

**5. Durum kümesi zengin ama iki eksenlidir.** `outgoingStatus` (zarf yolculuğu)
ile `documentAnswer` (alıcı kararı) ayrı alanlardır; `nesBelgeDurumu` ikisini
ortak `BelgeDurum` kümesine indirger ve alıcı kararına öncelik verir. Tanınmayan
durum **"hata" değil "kuyrukta"** sayılır — aksi hâlde belge takipten düşer.

## Bilinen boşluklar

| Konu | Durum |
|---|---|
| `mukellefListesiCek` | Uygulanmadı. `GET /einvoice/v1/users/zip/{aliasType}` bir ZIP indiriyor; içindeki dosya biçimi (CSV mi XML mi) çalışan test erişimi olmadan doğrulanamadı. Sözleşme gereği metot tanımsız bırakıldığında çağıran tekil `mukellefSorgula`'ya düşer (EBLG-10 lokal liste katmanı NES'te devre dışı kalır). |
| `earsivRaporDurum` | Uygulanmadı. `/histories` ve `/details` uçlarının yanıt şeması şemalarda tanımsız. Rapor listesi zaten bölüm başına `status` taşıdığı için ekran bu bilgiyi listeden okuyabilir. |
| e-Arşiv `recordStatus` | `GET /earchive/v1/invoices/{uuid}` yanıt şeması şemada ayrıntılı değil; alan savunmacı okunuyor, canlı yanıtla doğrulanmalı. |
| e-Arşiv rapor tutarı | NES rapor bölümünde toplam tutar dönmüyor; `EarsivRapor.toplamTutar` "0" olarak doldurulur. |
| Rate limit | Hiçbir şemada tanımlı değil, 429 davranışı bilinmiyor. NES'e soruldu. |

## Açık konu: test erişimi

2026-09-09 itibarıyla elimizdeki test anahtarı `HTTP 401` /
`WWW-Authenticate: Bearer error="invalid_token"` dönüyor. Uç nokta, metot ve
başlık biçimi doğru (NES'in kendi entegrasyon sayfasındaki `curl` örneğiyle
birebir aynı); reddedilen anahtarın kendisi. Test erişim sayfasındaki değerlerin
örnek veri olduğundan şüpheleniliyor: VKN'ler `1234567801`/`1234567802`,
kullanıcılar `test01@`/`test02@nes.com.tr` ve **iki test kurumuna da aynı GB/PK
etiketleri** verilmiş; bu haliyle "Kurum 01'den Kurum 02'ye gönder" senaryosunda
`ReceiverAlias` belirlenemiyor.

`entegrasyon@nesbilgi.com.tr` adresine sorulacaklar:

1. Test anahtarları aktif mi; Bearer kullanımı doğru mu, öncesinde token alma adımı var mı?
2. Test Kurum 01 ve 02 için **ayrı ayrı** GB ve PK etiketleri nedir?
3. Rate limit ve 429 davranışı nedir?

Bu üçü yanıtlanana kadar adaptör canlı uçlara karşı doğrulanmamış sayılır;
birim testleri sözleşmeyi (şemadan çıkarılan istek/yanıt biçimlerini) doğrular,
gerçek ortam davranışını değil.
