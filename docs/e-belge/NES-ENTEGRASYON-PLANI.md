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

## API anahtarı üretimi

Anahtar bize dağıtılmaz, **portalda kendimiz üretiriz**
(`developer.nes.com.tr/docs/auth/auth-token`): portala kullanıcı adı/şifre ile
girilir, ardından **Yönetim Paneli → API Tanımları → Yeni API Anahtarı**.

- **Açıklama:** anahtarı tanıtan serbest metin (örn. "TekirExtra üretim").
- **Son geçerlilik tarihi:** boş bırakılırsa süresiz.
- **Scope:** test ortamında yok sayılır. Canlıda anahtarın ilgili uç için gerekli
  scope'u yoksa `403 Forbidden` döner — yani canlıda 403 scope sorunudur,
  401 ise anahtarın kendisinin geçersizliğidir.
- **Anahtar yalnızca bir kez görüntülenir;** üretildiği anda kaydedilmelidir.

## Hata gövdeleri

`developer.nes.com.tr/docs/shared-classes` iki biçim tanımlar; `nesHatasi`
ikisini de ayrıştırır ve başlığın yanına alan/kural ayrıntısını ekler.

```json
// 400 — istek biçimi geçersiz
{ "message": "GECERSIZ ISTEK",
  "invalidFields": [{ "field": "SenderAlias", "description": "Gönderici Etiketi boş geçilemez!", "detail": "" }] }

// 422 — istek geçerli, iş kuralı reddediyor
{ "message": "HATALI ISTEK",
  "errors": [{ "code": "1000", "description": "SCHEMATRON_CHECK_RESULT_HAS_FAILED", "detail": "ŞEMATRON KONTROL SONUCU HATALI" }] }
```

Başlık tek başına ("GECERSIZ ISTEK") faturayı düzeltmeye yetmez; kullanıcıya
gösterilen mesaj bu yüzden `GECERSIZ ISTEK — SenderAlias: Gönderici Etiketi boş
geçilemez!` biçiminde birleştirilir.

## Sözleşme eşlemesi

| `EntegratorAdapter` metodu | NES ucu |
|---|---|
| `baglantiTest` | `GET /general/v1/einvoice/aliases/Gb` |
| `mukellefSorgula` | `GET /einvoice/v1/users/{vkn}/Pk` |
| `mukellefListesiCek` | `GET /einvoice/v1/users/zip/Pk` + `GET /edespatch/v1/users/zip/Pk` |
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

## Posta kutusu seçimi

Tekil sorgu bir VKN için GİB'de kayıtlı **tüm** etiketleri döndürür ve
varsayılanı işaretlemez (`isDefault` yalnızca kendi hesabımızın etiketlerinde
vardır). Test Kurum 02'nin 225 etiketi var, en eskisi 2014 tarihli. Firma her
entegratör değiştirdiğinde yeni etiket eklendiği için **en son oluşturulan**
etiket yürürlüktedir; adaptör `creationTime`'a göre seçer. Toplu listede de
silinme damgası yoktur, yani güncellik elimizdeki tek sinyaldir.

## Mükellef listesi

`GET /{aile}/v1/users/zip/Pk` → ZIP → `{aile}_pk_user_list.xml`:

```xml
<UserList><User>
  <Identifier>…</Identifier><Title>…</Title><Type>OZEL|KAMU</Type>
  <FirstCreationTime>…</FirstCreationTime>
  <AccountType>OZELENTEGRASYON|ENTEGRASYON|GIBPORTAL</AccountType>
  <Aliases><Alias><Name>urn:mail:…</Name><CreationTime>…</CreationTime></Alias></Aliases>
</User></UserList>
```

Liste belge ailesi başına ayrıdır; e-Fatura ve e-İrsaliye için iki indirme
yapılır ve kayıtlar `belgeTuru` ile etiketlenir. e-İrsaliye modülü kapalı bir
hesapta ikinci indirme 403/404 döner; bu veri arızası değil ürün kapsamı
olduğundan yutulur, diğer hatalar yukarı taşınır.

Test ortamında ölçülen (2026-09-09): e-Fatura 28.891 etiket / 27.183 mükellef,
e-İrsaliye 4.955 etiket; iki indirme + ayrıştırma toplam **0,9 saniye**, açık
XML ~11,8 MB. Metot günde bir kez çağrılır (EBLG-10), belge gönderiminde değil.

## Bilinen boşluklar

| Konu | Durum |
|---|---|
| `earsivRaporDurum` | Uygulanmadı. `/histories` ve `/details` uçlarının yanıt şeması şemalarda tanımsız. Rapor listesi zaten bölüm başına `status` taşıdığı için ekran bu bilgiyi listeden okuyabilir. |
| e-Arşiv `recordStatus` | `GET /earchive/v1/invoices/{uuid}` yanıt şeması şemada ayrıntılı değil; alan savunmacı okunuyor, canlı yanıtla doğrulanmalı. |
| e-Arşiv rapor tutarı | NES rapor bölümünde toplam tutar dönmüyor; `EarsivRapor.toplamTutar` "0" olarak doldurulur. |
| Rate limit | Hiçbir şemada tanımlı değil, 429 davranışı bilinmiyor. NES'e soruldu. |

## Test erişimi — çözüldü

Erişim sayfasında verilen anahtar `HTTP 401` /
`WWW-Authenticate: Bearer error="invalid_token"` dönüyordu. **Çözüm: anahtarı
portalda üretmek** (bkz. "API anahtarı üretimi"); portalda üretilen anahtarla
uçlar 200 dönüyor.

Erişim sayfasındaki GB/PK etiketleri de örnek veriymiş: sayfa iki test kurumuna
da aynı dört `@nes.com.tr` etiketini basıyor, oysa gerçek etiketler API'den
geliyor (Kurum 02'nin 225 etiketi var, hiçbiri `@nes.com.tr` değil). Alıcı
etiketi bu yüzden NES'e sorulmadan `mukellefSorgula` ile belirlenebiliyor.

Canlı doğrulanan uçlar (2026-09-09): hesap etiketleri, tekil mükellef sorgusu,
toplu mükellef listesi (iki aile), gelen fatura listesi. Gönderim ve durum
akışı henüz canlıda denenmedi.

Geriye kalan tek açık soru **rate limit / 429 davranışı**; hiçbir şemada
tanımlı değil, NES'e sorulmalı.

Birim testleri sözleşmeyi doğrular, gerçek ortam davranışını değil; canlıda
denenmemiş uçlar için bu ayrım geçerlidir.
