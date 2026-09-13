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
vardır). Test Kurum 02'nin 225 etiketi var, en eskisi 2014 tarihli.

Sıralı kural (`postaKutusuSec`):

1. Tek etiket varsa o kullanılır — gerçek firmaların neredeyse tamamı böyle.
2. Birden çoksa **bizim entegratörümüzün alan adındaki** etiketler ayrılır:
   alıcı da aynı entegratördeyse teslimat oradan yürür.
3. Bu küme içinde GİB'in birincil kutu adlandırması `defaultpk` tercih edilir.
4. Kalan eşitlik en yeni `creationTime` ile bozulur.

Denenip elenen iki kural: **"listenin ilki"** (API sırası rastgele) ve **"en
yeni etiket"**. İkincisi Kurum 02'de `…@mersel.io` (2025) seçiyordu, oysa
hesabın gerçek giden trafiği `urn:mail:defaultpk@nes.com.tr`'ye (2021) gidiyor;
GİB test VKN'leri yıllar içinde her entegratörden etiket biriktirdiği için
"en yeni" burada "bu VKN ile en son oynayan entegratör" demek. 225 etiketin
57'sinin yerel adı `defaultpk` olduğundan tek başına o filtre de yetmiyor.
Yukarıdaki kural canlı veride doğru kutuyu seçiyor.

Seçim yine de bir tahmindir. Bu yüzden birden çok aday varsa hepsi
`MukellefDurum.postaKutulari` ile döner; nihai çözüm, EBLG-02 onay adımında
kullanıcıya seçtirip cari kartında saklamaktır (yapılmadı).

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

## Canlı gönderim doğrulaması (2026-09-09)

Kurum 01 → Kurum 02 arasında gerçek bir e-Fatura gönderildi ve zincirin tamamı
çalıştı:

```
gönderim  → uuid 0945cb36-7062-4c73-bea4-3eab1e5e15b1
durum     → kuyrukta → kuyrukta → iletildi
belge no  → K072026000000014   (NES atadı)
zarf      → 1300 BASARIYLA TAMAMLANDI
           urn:mail:defaultgb@nes.com.tr → urn:mail:defaultpk@nes.com.tr
```

`outgoingStatus = EnvelopeHasBeenTransferredToReceiverSuccessfully` değeri
`nesBelgeDurumu` ile doğru şekilde `iletildi`ye indirgendi.

**Kendi UBL üreticimizde üç kusur bu deneme sırasında bulundu ve düzeltildi**
(`apps/api/src/ebelge/xml-uretec.ts`); üçü de daha önce hiç şema doğrulamasından
geçmemişti:

1. `cac:SignatoryParty` yalnızca `PartyIdentification` taşıyordu; UBL-TR ayrıca
   `PartyName` ve `PostalAddress` istiyor.
2. Alıcı `cac:PostalAddress`'inde `CityName` tek başına yazılıyordu;
   dizide önce `CitySubdivisionName` gelmek zorunda.
3. `xsi:schemaLocation` GİB'in şema URL'ini gösteriyordu; şematron kuralı
   değerin `UBL-Invoice-2.1.xsd` olmasını şart koşuyor.

### Seri numarasını kim veriyor?

Dördüncü ret sebebi bir davranış farkıydı:
`OTOMATIK NUMARALANDIRILAN SERIDIR! 16 HANELI NUMARA VERILEMEZ : K07`.

NES'te seriler "otomatik numaralandırılan" olarak işaretlenebiliyor; böyle bir
seride UBL'e **tam belge numarası değil yalnızca seri öneki** (`K07`) yazılır ve
numarayı NES atar, yükleme yanıtındaki `documentNumber` ile geri döner. Bizim
seri/sayaç modülümüz numarayı kendisi üretiyor — iki sayaç aynı anda
çalışamaz. **Karara bağlanmalı** (bkz. Açık kararlar).

## Açık kararlar

| Konu | Seçenekler |
|---|---|
| ~~Çok etiketli alıcıda posta kutusu seçimi~~ | **Karara bağlandı:** kendi entegratörümüzün alan adı → `defaultpk` → en yeni. Adaylar `postaKutulari` ile açılıyor; kullanıcıya seçtirme EBLG-02 onay adımına bırakıldı. |
| Belge numarasını kim atar | **Karara bağlandı: NES otomatik serisi.** UBL'e yalnız seri öneki yazılır, numarayı NES atar. Uygulaması bekliyor — bkz. aşağıdaki not. |

### NES otomatik serisi (uygulandı)

Numaralandırma sahipliği **sağlayıcı başına** belirlenir (EBLG-16); ürün geneli
bir mod değildir, çünkü Sovos numarayı UBL içinde hazır bekler.

- `EntegratorAdapter.belgeNoAtar` sağlayıcının yeteneğini bildirir (NES: evet).
- Devir ancak yapılandırmada `belgeSeriOneki` (örn. `K07`) doluysa geçerlidir;
  önek yoksa firma otomatik olmayan seri kullanıyordur ve numarayı biz atarız.
- `BaglantilarService.numaralandirma(tx)` bu iki koşulu birleştirip karar verir.
- `kesinlestir` devir varken `FaturaSeri` sayacını **ilerletmez**, `no` boş kalır.
- `ebelge.service` UBL'i seri önekiyle üretir; dönen `documentNumber` faturaya
  ve cari hareketin açıklamasına yazılır (bağ zaten `kaynakRef` üzerinden id ile
  kurulduğu için yapısal bir eksik oluşmaz).
- Numarasız kesin fatura yazdırılamaz ve e-postalanamaz.

Yan kazanç: reddedilen belge artık numara tüketmiyor, seride boşluk kalmıyor.
Karşılığında kesinleşme ile gönderim arasında fatura numarasız durur; kuyruk
kalıcı hataya düşerse bu durum kullanıcıya görünür olmalıdır.

## Uçtan uca doğrulama (2026-09-09)

Uygulamanın tamamı üzerinden, canlı NES test ortamına karşı:

| Adım | Sonuç |
|---|---|
| Bağlantı testi (`/baglantilar/:id/test`) | başarılı |
| Mükellef listesi senkronu | 33.845 kayıt, 3,9 sn |
| Taslak → kesinleştir | `no: null`, `seri: K07` — numara atanmadı (EBLG-16) |
| Numarasızken PDF | `400` — engellendi |
| Kuyruk → gönderim | `tur: efatura`, `durum: iletildi` |
| Numara geri yazımı | **K072026000000016** |
| Numara sonrası PDF | `200`, 28 KB |

Kanal kararı lokal listeden verildi: alıcı `5555554408` listede e-Fatura
mükellefi olarak bulunduğu için belge e-Arşiv'e değil e-Fatura'ya gitti.

### Test ortamı bayrağı

Entegratörlerin test ortamları sentetik firma kimliği veriyor: NES'in
`1234567801`'i VKN kontrol hanesini tutmuyor (bağımsız olarak doğrulandı; GİB
listesindeki 22.889 VKN'nin %74'ü geçerli, bu değil). Gönderen VKN kontrolü
(`ebelge.service`) bu yüzden sandbox'ta gönderimi bloke ediyordu.

Bağlantı yapılandırmasına açık bir **`testOrtami`** bayrağı eklendi; yalnızca
gönderen VKN kontrol hanesi doğrulamasını gevşetir, başka hiçbir kuralı
etkilemez. Üretim bağlantılarında kapalıdır.

### Bulunan iki kusur

**1. Cari hareket açıklaması geriye dönük güncellenemez.** Numarayı yazarken
`cariHareket.updateMany` çağırıyordum; uygulama rolünün `cari_hareketler`
üzerinde **UPDATE yetkisi yok** — hareketler bilinçli olarak ekle-sil. Çağrı
kaldırıldı; kesinleşmede numara yoksa açıklama artık "Fatura hareketi" yazıyor
ve bağ zaten `kaynakRef` üzerinden kuruluyor.

**2. Başarılı gönderimden sonra gelen veritabanı hatası yetim belge bırakıyor.**
Yukarıdaki kusur ilk denemede işlemi geri aldı, ama **HTTP çağrısı çoktan
gitmişti**: NES'te `K072026000000015` (5.400 TL) belgesi oluştu ve bizde hiçbir
kaydı yok. Yeniden deneme `…016`'yı üretti — yani aynı ticari işlem için GİB'de
iki belge var.

Bu, numaralandırmadan bağımsız, önceden var olan bir açıktı: ağ çağrısı ile
kalıcılaştırma aynı atomik birim değil ve `EbelgeKayit` "hata" durumundan
yeniden denenebiliyor.

**Kapatıldı (EBLG-17).** Sözleşmeye `belgeAra` eklendi: yeniden denemeden önce
sağlayıcıya aynı kaynak kayıt için belge oluşup oluşmadığı sorulur, oluşmuşsa
gönderim tekrarlanmaz ve mevcut belge benimsenir (referansı ve numarasıyla).
İlk gönderimde bu sorgu yapılmaz, çağrı disiplini korunur.

NES tarafında arama `uuid` filtresiyle yapılır: NES, UBL'deki `cbc:UUID`
değerini belgenin kimliği olarak saklıyor ve biz oraya fatura kimliğimizi
yazıyoruz — uçtan uca denemede dönen `entegratorRef` faturanın kimliğiyle
birebir aynıydı. Benimseme `ebelge_mevcut_belge_benimsendi` olayıyla loglanır.

## e-Arşiv uçtan uca doğrulama (2026-09-10)

e-Fatura mükellefi **olmayan** bir gerçek kişiye (TCKN `10000000078`) kesilen
3.600 TL'lik satış faturası, canlı NES test ortamında uçtan uca doğrulandı:
kesinleştir (numarasız) → kuyruk → gönderim → NES numarayı atadı
(**`SNC2026000000002`**) → faturaya yazıldı → durum sorgusu `iletildi` → PDF
numarayla açıldı. Kanal kararı lokal mükellef listesinden verildi; e-Arşiv'de
alıcı posta kutusu sorulmaz.

**Dört kusur bu deneme sırasında bulundu ve düzeltildi.** Dördü de yalnız
e-Arşiv kanalında ortaya çıkıyor; e-Fatura akışı bunlardan etkilenmiyordu.

**1. Profil e-Fatura profiliydi.** UBL üreticisi `ProfileID` alanına her zaman
`TEMELFATURA`/`TICARIFATURA` yazıyordu; e-Arşiv'de GİB `EARSIVFATURA` bekler.

> `Geçersiz cbc:ProfileID elemanı değeri : 'TEMELFATURA'. Geçerli cbc:ProfileID
> değerleri için ProfileIDTypeEarchive listesine bakınız.`

`faturaUblUret` artık kanalı (`tur`) parametre olarak alıyor. Profil kanaldan
gelir; cari kartındaki temel/ticari tercihi (FTR-19) yalnız e-Fatura kanalında
anlamlıdır.

**2. Gerçek kişi alıcıda `cac:Person` yoktu.** Ünvan yalnızca `cac:PartyName`
içinde yazılıyordu.

> `schemeID niteliği değeri 'TCKN' olması durumunda cac:Person elemanı
> bulunmalıdır.`

Alıcı kimliği 11 haneliyse ünvan `cac:Person` altına (`FirstName`/`FamilyName`)
yazılır ve `cac:PartyName` üretilmez. Ad ve soyad cari kartında ayrı tutulur
(CARI-21, 2026-09-11); gerçek kişide zorunludur ve unvan bunlardan türer. Alanlar
boşsa (eski kayıt ya da tüzel işaretlenmiş TCKN'li cari) son kelime soyad,
kalanı ad sayılır ve e-Belge sihirbazı tahmini gösterir. Kural tek yerde:
`cari/ad-soyad.ts` (POS ödemesi de aynısını kullanır).

**3. Gönderim şekli bildirilmiyordu.**

> `GONDERIM TIPI GECERSIZ : SEND_TYPE`

e-Arşiv UBL'i gönderim şeklini `AdditionalDocumentReference` içinde taşır;
NES'in aradığı kod **`SEND_TYPE`**'tır (elimizdeki Sovos örneğinde aynı bilgi
`EREPSENDT` koduyla duruyor — kod entegratöre göre değişiyor, örneğe bakıp
kopyalamak yanıltıcı). Değer faturanın teslim şeklinden gelir: `ELEKTRONIK` ya
da `KAGIT` (EBLG-26, bkz. "e-Arşiv gönderim şekli").

**4. e-Arşiv, e-Fatura serisini kullanamaz.**

> `E-FATURA'DA KULLANILAN SERI TESPIT EDILDI. E-FATURA/E-ARSIV SERILERI
> BIRBIRINDEN FARKLI OLMALIDIR`

Bağlantıda tek bir `belgeSeriOneki` vardı ve iki kanal da onu kullanıyordu.
Ayrı bir `earsivSeriOneki` eklendi (Ayarlar > Entegratörler ekranında ikinci
alan); iki önek aynıysa form kaydı reddeder. Kanal ancak mükellefiyet
sorgusundan sonra bilindiği için eksik e-Arşiv öneki gönderimden hemen önce,
entegratöre gidilmeden yakalanır.

### Seri, otomatik numaralandırılan seri olmalıdır

İlk denemede önek olarak `ETV` verildi ve NES reddetti:

> `OTOMATIK NUMARALANDIRILAN SERI DEGILDIR! 16 HANELI NUMARA VERILMELIDIR : ETV`

`GET /{aile}/v1/definitions/series` yanıtında otomatik seriler
**`isPortal: true`** olanlardır ve yıl bazlı `counters` taşırlar; `isPortal:
false` seriler için numarayı bizim üretmemiz beklenir. Doğrulanan e-Arşiv
serisi: **`SNC`**. Aynı ayrım e-Fatura tarafında da geçerli (`K07`
`isPortal: true`). **Kalan iş:** bağlantı kaydedilirken önek bu listeye karşı
doğrulanabilir; şimdilik yanlış önek gönderim anında anlaşılıyor.

### Biten gönderim işi yeniden kuyruğa alınmıyordu

Dead-letter'a düşen gönderimden sonra fatura ekranındaki "yeniden gönder"
hiçbir şey yapmıyor, kullanıcıya yine de "e-Belge yeniden gönderildi" diyordu:
iş kimliği kuyrukta durduğu için `kuyrugaEkle` mevcut işi bulup geri dönüyordu.
Biten (`completed`/`failed`) iş artık kaldırılıp yenisi ekleniyor; süren iş
olduğu gibi bildiriliyor, mükerrer gönderim üretilmiyor.

### Entegratör hatası 500'e dönüşüyordu

e-Arşiv rapor listesi çağrısı `HTTP 500 — "Beklenmeyen sunucu hatası"`
veriyordu. Adaptör doğru mesajı üretmişti (eksik scope'un adıyla birlikte) ama
servis `NesHatasi`'nı sarmadığı için mesaj kullanıcıya ulaşmıyordu. Rapor ve
iptal uçları artık entegratör hatasını `502` ve okunur mesajla döndürüyor.

## e-Arşiv iptali (2026-09-10)

NES tarafı doğrulandı: `SNC2026000000002` adaptör üzerinden iptal edildi
(`GET /earchive/v1/invoices?documentNumber=…` → `POST /earchive/v1/invoices/cancel`)
ve belge NES'te `isCanceled: true`, `cancelDate: 2026-09-10T21:04:13` oldu.

**Uygulama akışı kilitliydi**: `FaturaService.iptal` `fatura.ebelge` varsa
kanaldan bağımsız reddediyor, `earsivIptalBildir` ise faturanın önce iptal
edilmiş olmasını istiyordu — yani e-Arşiv olarak çıkmış hiçbir fatura iptal
edilemiyordu.

**Karar (EBLG-22, 2026-09-10):** kural kanala ve belgenin rapor durumuna bakar.

- e-Fatura: iptal yok, iade faturası düzenlenir. Kesilen e-Fatura geri alınmaz.
- e-Arşiv: fatura tarihinden itibaren **8 gün** içinde iptal edilir; süre
  geçtiyse düzeltme yolu iade faturasıdır. Süre ayarlanabilir
  (`ayarlar/ebelge > earsivIptalGunSayisi`, varsayılan 8).
- **Rapor durumu engel değil, bilgidir.** İlk kurgu "GİB raporuna girmemişse
  iptal edilir" diyordu; e-Arşiv raporu **günlük** gittiği için bu, mevzuatın
  tanıdığı iptali ikinci günden itibaren reddederdi. Belge raporlanmışsa iptal
  yine yapılır, muhasebeye iptalin de raporlanması gerektiğini söyleyen bir
  bildirim düşer ([[bildirim-merkezi-bld]]).
- **İptal tek adımdır:** fatura iptal edilirken belge entegratörde de iptal
  edilir. Entegratör çağrısı fatura iptalinin **kendi işleminin içinde** yapılır;
  başarısız olursa işlem geri alınır, böylece bizde iptal görünüp GİB'de canlı
  duran belge kalmaz. Ayarlar ekranındaki "İptali entegratöre bildir" düğmesi
  artık yalnız bildirimin düştüğü kayıtları kurtarmak için görünür.
- `BelgeDurum` kümesine `iptal` eklendi (göç `20260910190000_earsiv_iptal`);
  iptal edilmiş belge artık "iletildi" görünmüyor.

Canlı doğrulandı: `SNC2026000000003` ve `SNC2026000000004` tek adımda iptal
edildi — fatura `iptal`, e-belge kaydı `iptal`, NES'te `isCanceled: true`.
e-Fatura olarak gönderilmiş `K072026000000016` reddedildi. Tarihi 9 gün geriye
alınan fatura *"8 günlük iptal süresi geçmiş (9 gün); düzeltme için iade
faturası düzenleyin"* ile durdu; ayar 30 güne çekilince aynı fatura kapıdan
geçti.

**Süre nereden geliyor:** 8 gün yaygın uygulama
(`parasut.com/blog/e-arsiv-fatura-nasil-iptal-edilir`), tebliğ metni değil.
Ayar olmasının sebebi bu — mali müşavirin söylediği süreyle değiştirilebilir.

### İptal ikinci kez istendiğinde

NES **iptal edilmiş belgeyi `/earchive/v1/invoices` listesinde döndürmüyor**
(2026-09-10 ölçüldü: iptalli iki belge de `documentNumber` filtresiyle boş
dönüyor). Bu yüzden ikinci iptal denemesi "belge bulunamadı" hatası veriyordu
ve gerçek bir arıza gibi okunuyordu.

Ayrım tekil sorgudan yapılıyor: `GET /earchive/v1/invoices/{uuid}` iptalli
belgeyi `isCanceled: true` ile döndürür. `durumSorgula` bunu `iptalEdilmis`
alanında taşıyor; iptal isteği geldiğinde belge sağlayıcıda zaten iptalse
istenen sonuç gerçekleşmiş sayılıp kayıt eşitleniyor, ikinci çağrı yapılmıyor
(`earsiv_zaten_iptal` olayıyla loglanır). Aynı ayrım kurtarma ucunda
(`earsivIptalBildir`) da var.

Liste boş dönerse — `entegratorRef` olmadığı için tekil sorgu yapılamayan eski
kayıtlarda — mesaj artık iki ihtimali birden söylüyor: belge hiç oluşmamış ya
da daha önce iptal edilmiş olabilir.

### `documentNumber` filtresi çalışıyor, `uuid` filtresi çalışmıyor

Ölçüldü (2026-09-10): var olmayan ve çözümlenemeyen numaralarda liste **boş**
dönüyor — yani `uuid` filtresindeki "sessizce tüm listeyi döndürme" davranışı
burada yok. Yine de iptal geri alınamaz bir işlem olduğu için dönen kaydın
`documentNumber` değeri sorulanla birebir karşılaştırılıyor.

### Durum alanı `recordStatus` değil `archiveDocumentStatus`

`GET /earchive/v1/invoices/{uuid}` yanıtında `recordStatus` diye bir alan
**yok**; şemada da tanımlı değil. Adaptör bu alanı okuduğu için her e-Arşiv
belgesi — imzalanmamış ya da hatalı olanlar dahil — `iletildi` görünüyordu.
Doğru alan `archiveDocumentStatus`: `Waiting`/`WaitingSign` → kuyrukta,
`Error`/`XmlParseError`/`XmlFileDoesNotExist` → hata, `Signed` → iletildi.
İptal ayrı eksende (`isCanceled` + `cancelDate`) durur.

**Canlı yanıttan iki teyit daha:** gönderdiğimiz gönderim şekli `sendType:
"ELEKTRONIK"` olarak okunmuş; ad/soyad ayrıştırması ise beklendiği gibi kaba —
"Ayşe Yılmaz (e-Arşiv Test)" ünvanı NES'e `firstName: "Ayşe Yılmaz (e-Arşiv"`,
`familyName: "Test)"` olarak gitti. Gerçek kişi kartına ayrı ad/soyad alanı
açılması gereken sebep bu.

## e-İrsaliye uçtan uca doğrulama (2026-09-10)

Satış irsaliyesi **`GBZ2026000800001`** canlı NES test ortamında uçtan uca
gitti: onay → gönderim → `iletildi` + entegratör referansı → durum sorgusu
(`EnvelopeIsWaitingToBeSendedToReceiverByGib` → kuyrukta, "ZARF BAŞARIYLA
İŞLENDİ"). Gelen tarafta iki e-İrsaliye çekildi ve birine **kabul** yanıtı
gönderildi.

**Kendi ürettiğimiz iki UBL de baştan yazıldı.** DespatchAdvice ve
ReceiptAdvice şema kontrolünü geçmiyordu; ikisi de artık UBL-TR 1.2.1
örneklerindeki eleman sırasına göre kuruluyor.

**Yerel doğrulama:** UBL-TR 1.2.1 XSD seti depoda —
`docs/e-belge/Sovos Bulut e-İrsaliye WS API v1.3/EK1 - Teknik Belgeler/
UBL-TR 1.2.1/`. Ürettiğimiz XML entegratöre gitmeden `lxml` ile bu şemalara
karşı doğrulanabiliyor; sıra hatalarının çoğu böyle, tek bir NES çağrısı
harcamadan bulundu. Aynı klasördeki `XML/DespatchAdvice.xml` ve
`XML/ReceiptAdvice.xml` GİB'in kendi örnekleri, sıra için başvurulacak yer.

### Bulunan kusurlar

| Kusur | Belirti |
|---|---|
| `cbc:UUID`, `cbc:ID`'den hemen sonra geliyordu | `FAILED_XML_SCHEMA_CHECK … expected 'CopyIndicator'` |
| `ProfileID` `SEVK` yazılıyordu | `SEVK` belgenin **türüdür** (`DespatchAdviceTypeCode`); profil `TEMELIRSALIYE` |
| `cac:Party` içinde `PartyName` `PartyIdentification`'dan önceydi | Şema sırası |
| `cac:OrderLineReference` yoktu | XSD'de `DespatchLine` içinde zorunlu |
| Teslimat adresi hiç yazılmıyordu | `cac:Shipment/cac:Delivery/cac:DeliveryAddress/cbc:CityName …` |
| Posta kodu yazılmıyordu | `Hatalı Posta Kodu :''` |
| Taşıyan bilgisi yoktu | `DriverPerson veya CarrierParty alanlarından en az birini içermelidir` |
| Belge numarası 13 karakterdi | `DOKUMAN NUMARASI (<cbc:ID>) GECERSIZ` — GİB 16 ister |
| ReceiptAdvice'ta `ProfileID` yok, sıra yanlış | `FAILED_XML_SCHEMA_CHECK … expected 'ProfileID'` |
| Gelen irsaliyede gönderen boş kaydediliyordu | NES irsaliyede `despatchSupplierParty` diyor, adaptör faturadaki `accountingSupplierParty`'yi okuyordu |

### Yanıt belgesinin numarasını sağlayıcı atar (EBLG-24)

İrsaliye yanıtı **ayrı bir belgedir ve ayrı seri ailesinde durur**: NES'te
`/edespatch/v1/answerseries` (varsayılan `YNT`, otomatik numaralandırılan).
İrsaliyenin kendisinden farklı olarak numaranın elde önceden bulunması
gerekmiyor — yanıt kâğıtla yola çıkmıyor — bu yüzden numarayı sağlayıcı atar,
tıpkı e-Fatura ve e-Arşiv'de olduğu gibi (EBLG-16).

İlk kurguda numara **saatten türetiliyordu** ve üstelik irsaliye serisinden
alınıyordu: gönderdiğimiz ilk yanıt NES'e `GBZ2026006697162` olarak gitti —
hem anlamsız bir sıra, hem de irsaliye serisinin içinde ikinci bir sayaç.

Şimdi UBL'e yalnız yanıt serisinin öneki yazılıyor, tam numara
`POST …/receiptadvice` yanıtındaki `documentNumber`'dan okunup
`gelen_eirsaliyeler.yanit_belge_no` alanına yazılıyor. Seri öneki bağlantıda
(`eirsaliyeYanitSeriOneki`); irsaliye serisiyle aynı olamaz, yoksa seri içinde
numara çakışır. Tanımlı değilse yanıt gönderilmez.

Canlı doğrulandı: ret yanıtı **`YNT2026000000002`** numarasıyla düzenlendi.

### Numarayı e-İrsaliye'de biz atarız

e-Fatura ve e-Arşiv'de numarayı sağlayıcı atar (EBLG-16). **e-İrsaliye'de
tersi geçerli:** numara sevkten önce gerekir, kâğıt malla birlikte yola çıkar.
Bu yüzden numarayı belge modülü üretir ve entegratördeki serinin **elle
numaralandırılan** (NES'te `isPortal: false`) bir seri olması gerekir; otomatik
seride NES tam numarayı `OTOMATIK NUMARALANDIRILAN SERIDIR!` diyerek reddeder.

Seri öneki artık bağlantıda (`eirsaliyeSeriOneki`, 3 harf); sabit `IRS`
yalnızca varsayılan. İrsaliye numarası 16 karaktere çıkarıldı (önek + yıl +
9 hane); teklif ve sipariş dışarı çıkmayan iç belgeler olduğu için 6 hanede
kaldı.

**Kurulum notu:** mevcut bir seriyi devralan firmada belge sayacı serinin
kaldığı yerden başlatılmalı — sıfırdan başlarsa entegratör `RECORD_EXISTS`
döndürür (test hesabında bu yaşandı).

### Çok kurallı şematron yanıtı kırpılıyordu

Hata metni 400 karakterde kesiliyor ve bir belge birden çok kurala takılınca
ikinci kural yarım kalıyordu. Sınır 1000'e çıkarıldı ve kesme kural sınırında
yapılıyor; sığmayan kural sayısı `(+N kural daha)` diye yazılıyor.

## e-İrsaliye taşıma bilgileri (EBLG-23, 2026-09-10)

Fiili sevk zamanı ve taşıyan artık uydurulmuyor; irsaliyede tutuluyor.

**Alanlar** (`belgeler` tablosu, göç `20260910200000_eirsaliye_tasima_bilgileri`):
`fiiliSevkZamani`, `tasiyiciCariId`, `plaka`, `dorsePlaka`, `soforAdi`,
`soforSoyadi`, `soforTckn`. Hepsi yalnız irsaliyede anlamlı; başka belge
türünde yazılmıyor.

**Kararlar** ([[modul-onay-kapisi]] S-01):

- **Taşıyan cari kartından seçilir.** Nakliyeci ya da kargo firması zaten cari;
  VKN ve ünvan oradan gelir, mükerrer veri girilmez. Seçilmezse mal **kendi
  aracımızla** götürülmüş sayılır ve `CarrierParty` firmamız olur.
- **Şoför ve plaka irsaliyede düz alanlar.** Kayıtlı araç/şoför kartları
  açılmadı; filoyla çalışan firmada tekrar giriş gerekecek, kalan iş listesinde.
- **Zorunluluk gönderimde.** İrsaliye eksik bilgiyle oluşturulup onaylanabilir;
  kâğıt irsaliye kesen firma engellenmez. e-İrsaliye gönderilirken taşıyıcı
  firma ya da şoför adı+soyadı+plaka yoksa gönderim durur.
- **Fiili sevk zamanı boşsa onay anı yazılır** — mal onaylanan irsaliyeyle yola
  çıkar.

**Onaylanmış irsaliyede taşıma bilgisi düzenlenebilir.** Şoför ve plaka çoğu
zaman onaydan sonra, mal yüklenirken belli oluyor; onay kilidi bu alan kümesi
için açık (`PATCH /belgeler/:id/tasima-bilgisi`). Belgenin ticari içeriği
kilitli kalır, e-İrsaliye gönderildikten sonra taşıma bilgisi de kilitlenir.
Bu kapı olmasa onayı yapılmış ama taşıyanı girilmemiş irsaliye hiç
gönderilemezdi.

**UBL karşılıkları:** şoför `ShipmentStage/DriverPerson` (ad, soyad,
`NationalityID`), çekici `ShipmentStage/TransportMeans/RoadTransport/
LicensePlateID schemeID="PLAKA"`, dorse `TransportHandlingUnit/
TransportEquipment/ID schemeID="DORSEPLAKA"`, taşıyan `Delivery/CarrierParty`,
zaman `Delivery/Despatch/ActualDespatchDate` + `ActualDespatchTime`.

Canlı doğrulandı: `GBZ2026000800002` şoför "Mehmet Öztürk", plaka "34 ABC 123"
ve girilen sevk saati (07:45) ile gitti; taşıyan bilgisi girilmeden yapılan
gönderim ise beklendiği gibi durdu.

## Araç ve şoför kartları (EBLG-25, 2026-09-10)

Plaka ve şoför her irsaliyede yeniden yazılmasın diye kayıtlı kartlar:
**Ayarlar > Araçlar ve Şoförler** (`/api/v1/sevkiyat/araclar`,
`/api/v1/sevkiyat/soforler`; tablolar `araclar`, `soforler`, göç
`20260910220000_arac_sofor_kartlari`, ikisi de RLS'e tabi).

**Kararlar** ([[modul-onay-kapisi]] S-01):

- **İki ayrı kart.** Araç (plaka, dorse, açıklama) ve şoför (ad, soyad, TCKN)
  ayrı tutulur; aynı şoför başka araç kullandığında kart çoğalmaz.
- **Seçim değerleri kopyalar, belge kartı referans almaz.** İrsaliyede kart
  seçilince plaka ve şoför alanları dolar, sonrasında elle de düzeltilebilir.
  Kart yarın düzeltilse ya da silinse gönderilmiş e-İrsaliye GİB'e ne
  gittiyse onu göstermeye devam eder — referans tutsaydık ekran ile belge
  ayrışırdı.
- Şoför TCKN'si **zorunlu değil** (GİB `NationalityID` koşullu) ve kişisel
  veri olduğu için formda bu belirtiliyor.
- Aynı plaka ikinci kez açılamaz; kart pasife alınabilir, silme de serbest
  (belgeler kartı referans almadığı için geçmişi bozmaz).

Canlı doğrulandı: karttan gelen plaka ve şoförle düzenlenen
`GBZ2026000800003` NES'e iletildi.

## e-Arşiv rapor tutarı (EBLG-07, 2026-09-11)

NES rapor listesi (`/general/v1/earchivedocumentsreport/{yil}/{ay}`) bölüm başına
belge ve iptal sayısı verir (`eArchiveInvoiceCount`,
`eArchiveInvoiceCanceledCount`) ama tutar vermez. Adaptör tutarı `"0"` yazıyordu
ve ekran her raporda "GİB rapor toplamı 0,00 TL" gösteriyordu — bu "sıfır lira
bildirildi" diye okunur. Önceki notun aksine `/details` ve `/histories`
yanıtları `general/v1/swagger.json`'da tanımlı: `/details` bölümün belge belge
dökümüdür (`documentNumber`, `payableAmount`, `documentCurrencyCode`,
`isCancelRecord`, `isCanceled`).

**Kararlar** ([[modul-onay-kapisi]] S-01):

- **Tutar dökümden, satırda istekle.** Liste tutarı `null` ("bilinmiyor") döner;
  satırdaki "Tutarı getir" `GET /ebelge/earsiv/raporlar/:uuid/tutar` ile o
  bölümün dökümünü çeker. Liste her bölüm için döküm çağırmaz: aylık listede
  ~30 ek çağrı olur ve NES'in çağrı sınırı belgelenmemiş. Üstteki "Bildirim
  toplamı" yalnız tutarı bilinen raporları toplar ve kaçının bilindiğini söyler.
- **İptaller ayrı.** `isCancelRecord` satırları bildirilen toplama girmez,
  "İptal: …" olarak ayrı gösterilir; fatura sütunu iptal sayısını da yazar.
- Toplam para birimine göre ayrılır ve kuruş cinsinden tamsayıyla toplanır
  (`earsivRaporTutariOzetle`). Sovos listede tutar verdiği için orada döküm
  sorgusu yok.

**Canlı deneme (2026-09-13, scope'lu yeni anahtarla):** liste çalışıyor
(Eylül'de 2 bölüm, 37 ve 267 belge). `/details` ise her bölümde
`500 HATALI ISTEK` döndü — parametresiz, `page/pageSize` ve
`pageNumber/pageSize` ile; swagger'da ucun yalnız `path:id` parametresi var.
Test hesabındaki Temmuz–Eylül bölümlerinin **hepsi `XmlCreateWait`**,
`/histories` yalnız "Rapor oluşturulmak üzere bölümlendi" diyor: rapor XML'i
hiç üretilmemiş, döküm de bu yüzden yok gibi. Tamamlanmış bir bölümde
denenmeden tutar akışı doğrulanmış sayılmaz; NES'e sorulacak.

## Gelen belgeye başka yerden verilmiş yanıt (EBLG-34, 2026-09-13)

NES gelen belgeye verilmiş kabul/ret kararını belgeyle birlikte döndürür; bunu
okumadığımız için portalda ya da aynı hesabı kullanan başka bir kiracıda
yanıtlanmış belge bizde "yanıt bekliyor" kalıyordu. Ölçülen alanlar:

| Kaynak | Alan | Değerler |
|---|---|---|
| `GET /einvoice/v1/incoming/invoices` (liste) | `documentAnswer` | `None`, `Waiting`, `Accepted`, `Rejected` |
| `GET /einvoice/v1/incoming/invoices/{uuid}` (tekil) | `outgoingAnswer.documentAnswer` (kökte yok) | aynı; not `outgoingAnswer.answerNote` |
| `GET /edespatch/v1/incoming/despatches` ve tekil | `despatchAnswer` | `AllAccepted`, `AllRejected` |

`nesGelenYanit` yalnız kesin kararı (`Accepted`/`AllAccepted`,
`Rejected`/`AllRejected`) benimser; `None`, `Waiting` ve tanınmayan değer karar
sayılmaz. Tarama kararı yanıtı olmayan kayda yazar; yanıt göndermeden önce
`gelenYanitDurumu` / `gelenIrsaliyeYanitDurumu` tekil sorulur, karar varsa
gönderilmez. Canlıda: nes-e2e'de bekleyen 24 ticari faturanın 17'si NES'te
zaten yanıtlıydı; `NTN2026000000011`'e kabul denemesi NES'e gitmeden 409 döndü
ve kayda NES'teki ret (`not: test`) işlendi.

## e-Arşiv gönderim şekli (EBLG-26, 2026-09-11)

GİB, e-Arşiv faturanın alıcıya elektronik mi kâğıt mı teslim edildiğini
UBL'de ister (`AdditionalDocumentReference`, `DocumentTypeCode = SEND_TYPE`).
Değer sabit `ELEKTRONIK` idi; kâğıt fatura isteyen müşteriye doğru bildirim
yapılamıyordu.

**Kararlar** ([[modul-onay-kapisi]] S-01):

- **Varsayılan cari kartında, seçim sihirbazda.** Cari kartında "e-Arşiv
  teslim şekli" (başta elektronik); fatura oluşturulurken faturaya kopyalanır
  (`faturalar.earsiv_gonderim_sekli`, göç `20260911100000_earsiv_gonderim_sekli`).
  e-Belge sihirbazı seçimi gösterir ve fatura bazında değiştirilebilir;
  e-Fatura profilindeki (FTR-19) düzenin aynısı. Gönderim kuyruktan yürüdüğü
  için seçim gönder ucunun gövdesiyle faturaya yazılır, UBL faturadan okur.
- **Sihirbaz kanalı önceden sormaz.** Seçim "e-Arşiv olarak düzenlenirse"
  diye her zaman görünür; kanal e-Fatura çıkarsa değer kullanılmaz. Kanalı
  sihirbazda belirlemek bayat mükellef listesinde sihirbazı da kilitlerdi.
- **Kâğıt bildirilmiş e-Arşiv e-postalanabilir, ama uyarıyla.** Müşteri kopya
  isteyebilir; e-posta penceresi bunun bilgi amaçlı bir kopya olduğunu söyler.
- **PDF ibaresi.** Elektronik iletilen e-Arşivin PDF'inde "e-Arşiv izni
  kapsamında elektronik ortamda iletilmiştir." ibaresi çıkar; kâğıt teslimde ve
  e-Faturada çıkmaz. Metin mali müşavire teyit ettirilecek.

Canlı doğrulandı: cari kartı elektronikken sihirbazda kâğıt seçilerek
gönderilen `SNC2026000000005` NES'e iletildi; arşivlenen UBL'de gönderim şekli
`KAGIT`, PDF'inde ibare yok.

## Durum açıklaması hata alanına yazılmaz (2026-09-11)

Durum sorgusu sağlayıcının açıklamasını (`detay`) durumdan bağımsız olarak
`hataMesaji`'na yazıyordu. NES açıklamayı başarılı belgede de döndürüyor
("1300 BASARIYLA TAMAMLANDI", "ZARF BAŞARIYLA İŞLENDİ"), e-Fatura detayı da
`hataMesaji`'nı uyarı kutusunda gösterdiği için başarılı belge uyarıyla
açılıyordu. Kural artık tek yerde (`ebelge/durum-aciklamasi.ts`), e-Fatura,
e-Arşiv ve e-İrsaliye için aynı:

| Durum | Açıklama nereye gider |
|---|---|
| `hata` | `hataMesaji` |
| e-Arşiv sağlayıcıda iptal (`iptalEdilmis`) | `hataMesaji` — bizde hâlâ geçerli göründüğü için uyarı |
| `ret` | `aliciYanitNotu`; gelen yanıt taramasından gelmiş not ezilmez |
| diğerleri | saklanmaz, `hataMesaji` boşaltılır |

NES adaptörü retde yalnız `incomingAnswer.answerNote`'u döndürür; not yoksa zarf
açıklamasına düşseydi ret gerekçesi olarak "BASARIYLA TAMAMLANDI" görünürdü.
Ekrandaki ret kutusu artık `durum === "ret"` iken de çıkıyor; önceden yalnız
gelen yanıt taramasının yazdığı `aliciYaniti`'na bakıyordu. İrsaliyede alıcı
notu alanı yok, orada açıklamadan yalnız hata kısmı kalır. Eski kayıtlarda kalan
iki başarı metni bir sonraki durum sorgusunda temizlenir.

## Yetki kapsamı (scope)

Dokümantasyon "test ortamında scope'lar geçerli değildir" diyor; **doğru değil,
test ortamında da uygulanıyor.** Anahtar üretilirken hangi aileler işaretlendiyse
yalnızca onlar açılır ve eksik yetki `403` ile döner:

```json
{"role": null, "scope": "earchive:outgoing:list:read"}
```

Bu gövde belgelenmiş iki hata biçiminin ikisine de uymaz; `nesHatasi` onu ayrı
ele alır ve eksik yetkinin adıyla birlikte nereden verileceğini söyler.

Ölçülen: yalnız e-Fatura scope'u seçilmiş bir anahtarda `einvoice` ve `general`
uçları 200, tüm `earchive`/`edespatch` uçları 403 dönüyordu; istisna
`edespatch/v1/users/zip` (GİB mükellef listesi — belge modülü değil, kayıt
defteri). Scope'lar genişletilince hepsi açıldı. **Not:** e-Arşiv raporları
`general` altında servis edilse de `earchive:reports:read` yetkisi ister.

### `uuid` filtresinde keskin kenar

Liste uçlarına **çözümlenemeyen** bir `uuid` verilirse NES filtreyi sessizce yok
sayar ve tüm listeyi döndürür (biçimsel olarak geçerli ama var olmayan bir UUID
doğru şekilde boş döner). `belgeAra` bu yüzden iki kez korunur: kaynak kimliği
UUID biçiminde değilse sorgu hiç yapılmaz, ve dönen kaydın kimliği sorulanla
birebir eşleşmedikçe belge benimsenmez. Aksi hâlde yeniden denemede faturaya
alakasız bir belgenin numarası yazılabilirdi.

## Bilinen boşluklar

| Konu | Durum |
|---|---|
| `earsivRaporDurum` | Uygulanmadı. Rapor listesi bölüm başına `status` taşıdığı için ekran durumu listeden okur. `/histories` yanıtı (2026-09-11 şemasında tanımlı) yalnız işlem geçmişi verir. |
| Raporlanmış e-Arşiv iptali | Uygulama `Completed` belgede duruyor; rapor sonrası iptalin nasıl bildirileceği mevzuat tarafında netleşmedi. |
| Rate limit | Hiçbir şemada tanımlı değil, 429 davranışı bilinmiyor. NES'e soruldu. |
| e-Arşiv rapor uçları | `earchive:reports:read` scope'u anahtarda hâlâ yok; uç `502` ile bunu söylüyor ama rapor akışı canlıda denenmedi. |

## Test erişimi — çözüldü

Erişim sayfasında verilen anahtar `HTTP 401` /
`WWW-Authenticate: Bearer error="invalid_token"` dönüyordu. **Çözüm: anahtarı
portalda üretmek** (bkz. "API anahtarı üretimi"); portalda üretilen anahtarla
uçlar 200 dönüyor.

Erişim sayfasındaki `@nes.com.tr` etiketleri **gerçek**: Kurum 02'nin 225
etiketi arasında `urn:mail:defaultpk@nes.com.tr` (2021-03-25 kayıtlı) da var ve
hesabın giden fatura geçmişi bu adrese gidiyor. Sayfanın iki kuruma da aynı
etiketleri basması yine de yanıltıcı; doğru alıcı etiketi API'den okunmalı.

Canlı doğrulanan uçlar (2026-09-09): hesap etiketleri, tekil mükellef sorgusu,
toplu mükellef listesi (iki aile), gelen fatura listesi, **belge gönderimi ve
durum sorgusu**, seri tanımları.

Geriye kalan tek açık soru **rate limit / 429 davranışı**; hiçbir şemada
tanımlı değil, NES'e sorulmalı.

Birim testleri sözleşmeyi doğrular, gerçek ortam davranışını değil; canlıda
denenmemiş uçlar için bu ayrım geçerlidir.
