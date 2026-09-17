# Fatura Türleri — Alan Tablosu

**Amaç.** e-Fatura sihirbazının hangi türde hangi alanı soracağını tek yerde
toplamak. Tablolar isterlerin (FTR/EBLG) girdisidir; kodlama öncesi S-01
onayından geçer.

**Kaynaklar**

| Kaynak | Ne verir |
|---|---|
| `tekirpkus-efatura-tasarim.docx` (Mart 2026) | Tür/senaryo tanımları, kanal matrisi, UBL zorunlu alanları, ihracat akışı |
| `SEMATRONDEGISIKLIKLERI_484.pdf` (14.09.2026 yürürlük) | SARJ/SARJANLIK, IDIS, plaka revizyonu, KAMU-IADE, istisna kodu 233 |
| Kod: `packages/shared/src/fatura-senaryo.ts`, `gib-kodlari.ts`, `apps/api/src/ebelge/xml-uretec.ts` | Bugün ne üretiliyor |

**Durum sütunu:** ✅ var · ⚠️ kısmi · ❌ yok

---

## 1. Tür matrisi

`ProfileID` (senaryo) ile `InvoiceTypeCode` (fatura tipi) **ayrı eksenlerdir**;
tablo ikisini birlikte gösterir.

| # | Tür | ProfileID | InvoiceTypeCode | Ne zaman | Alıcı yanıtı | Durum |
|---|---|---|---|---|---|---|
| 1 | Ticari e-Fatura | `TICARIFATURA` | SATIS / IADE | Alıcı GİB'de kayıtlı, yanıt isteniyor | Kabul/ret/süre uzatma — 8 gün, sessizlik kabul | ✅ |
| 2 | Temel e-Fatura | `TEMELFATURA` | SATIS / IADE | Alıcı GİB'de kayıtlı, yanıt gerekmiyor | Yok | ✅ |
| 3 | e-Arşiv | `EARSIVFATURA` | SATIS / IADE | Alıcı GİB'de kayıtsız ya da nihai tüketici | Yok | ✅ |
| 4 | İhracat | `IHRACAT` | SATIS | Alıcı yurt dışı | Yok (gümrük süreci ayrı) | ❌ |
| 5 | Yolcu beraberi | `YOLCUBERABERIESYA` | SATIS | Tax-free yolcu satışı | Yok | ❌ |
| 6 | Kamu iade | `KAMU` | IADE | Kamu kurumuna kesilen iade faturası | — | ❌ |
| 7 | Şarj | `EARSIVFATURA` / e-Fatura | `SARJ` | Elektrikli araç şarj hizmeti | Kanala göre | ❌ |
| 8 | Şarjanlık | `EARSIVFATURA` / e-Fatura | `SARJANLIK` | Şarj ünitesi/işletmecilik | Kanala göre | ❌ |
| 9 | İhraç kayıtlı | `IHRACKAYITLI` | SATIS | İhracatçıya ihraç kaydıyla teslim | — | ❌ |

**Kanal kararı sihirbaza değil, kurala aittir** (tasarım belgesi §3.1): alıcı
yurt dışıysa → İhracat; yurt içi ve GİB'de kayıtlıysa → e-Fatura (ticari/temel
seçimi kullanıcıya kalır); kayıtsızsa → e-Arşiv. Sihirbaz kararı **gösterir ve
gerekçelendirir**, seçtirmez. Bugün kanal ve senaryo zaten otomatik türetiliyor
(FTR-16); eklenecek olan yurt dışı dalı ve tür başına alan kümesidir.

---

## 2. Her türde ortak alanlar

Sihirbazın her türde doğruladığı çekirdek. Hepsi bugün üretiliyor.

| Alan | UBL | Kaynak | Durum |
|---|---|---|---|
| Fatura no | `cbc:ID` | Seri + sayaç (sağlayıcı numaralandırıyorsa gönderimde) | ✅ |
| ETTN | `cbc:UUID` | Fatura `id` | ✅ |
| Tarih / saat | `cbc:IssueDate`, `cbc:IssueTime` | Fatura tarihi; gönderimden en çok 7 gün geriye | ✅ |
| Senaryo | `cbc:ProfileID` | Cari profili + kanal | ✅ |
| Fatura tipi | `cbc:InvoiceTypeCode` | Satırlardan türetilir | ✅ |
| Para birimi | `cbc:DocumentCurrencyCode` | Fatura dövizi | ✅ |
| Satır sayısı | `cbc:LineCountNumeric` | Satırlar | ✅ |
| Satıcı VKN, unvan, adres, vergi dairesi | `AccountingSupplierParty` | Firma kartı | ✅ |
| Alıcı VKN/TCKN, unvan, adres | `AccountingCustomerParty` | Cari kartı | ✅ |
| KDV matrahı, tutarı, oranı, `0015` | `TaxTotal` | Hesaplama | ✅ |
| Satır: sıra, miktar, birim fiyat, tutar, ürün adı, ürün kodu | `InvoiceLine` | Satırlar | ✅ |

~~**Ortak açık:** birim kodu UBL'e sabit `NIU` yazılıyor.~~ **Kapandı
(EBLG-52, 2026-09-17):** eşleme `packages/shared/src/birim-kodu.ts`'de; fatura
ve irsaliye satırı onu kullanır, tanınmayan birim `C62` gider ve sihirbaz
uyarır. Canlıda doğrulandı (`SNC2026000000018`, kg satırı `unitCode="KGM"`).

---

## 3. Tür başına alan tabloları

### 3.1 Ticari e-Fatura (`TICARIFATURA`)

| Alan | UBL | Zorunlu | Kaynak | Durum |
|---|---|---|---|---|
| Alıcı posta kutusu (alias) | `PartyIdentification` BUYER_ALIAS | Evet | GİB mükellef listesi | ⚠️ liste sorgulanıyor, alias UBL'e yazılmıyor |
| Alıcı yanıtı takibi | — | Evet | Entegratör sorgusu (EBLG-13/34) | ✅ |
| İade referansı | `cac:BillingReference` | İade tipinde | İade edilen fatura | ❌ |

### 3.2 Temel e-Fatura (`TEMELFATURA`)

Ticari ile aynı alan kümesi; farkı yanıt beklenmemesidir. Sihirbaz bunu
**açıkça yazmalı**: temelde alıcı kabul/ret veremez, 8 gün sonra kabul sayılır.

### 3.3 e-Arşiv (`EARSIVFATURA`)

| Alan | UBL | Zorunlu | Kaynak | Durum |
|---|---|---|---|---|
| Gönderim şekli (elektronik/kâğıt) | `AdditionalDocumentReference` SEND_TYPE | Evet | Sihirbaz | ✅ |
| Bireysel alıcıda ad/soyad | `Person` | TCKN'li alıcıda | Cari kartı (tahmin edilir, CARI-21) | ✅ |
| TCKN bilinmiyorsa `11111111111` | `PartyIdentification` | Koşullu | Sihirbaz seçimi | ❌ |
| **İnternet satışı**: sipariş no + tarih | `cac:OrderReference` | İnternet satışında | Fatura (`siparis_no`, `siparis_tarihi` **var**) | ⚠️ alan var, UBL'e yazılmıyor |
| **İnternet satışı**: teslimat adresi | `cac:Delivery/DeliveryAddress` | İnternet satışında | Cari sevk adresi | ❌ |
| **İnternet satışı**: platform/web adresi, ödeme şekli, ödeme tarihi | `PaymentMeans`, `Note` | İnternet satışında | Sihirbaz | ❌ |
| Alıcı e-Fatura mükellefi **değil** doğrulaması | — | Evet | Mükellef listesi | ✅ |

**(İş kalemi B)** — internet satışı alanları e-Arşiv'de zorunlu; bugün hiçbiri
UBL'e gitmiyor. Sihirbazda "bu bir internet satışı" kutusu açılınca bu grup
istenmeli.

### 3.4 İhracat (`IHRACAT`) — tasarım belgesi §5

| Alan | UBL | Zorunlu | Kaynak | Durum |
|---|---|---|---|---|
| Senaryo `IHRACAT` | `cbc:ProfileID` | Evet | Kural (alıcı yurt dışı) | ❌ |
| Alıcı ülke kodu (TR dışı) | `Country/IdentificationCode` | Evet | Cari adresi (`cari_adresler.ulke` **var**) | ⚠️ alan var, UBL'e yazılmıyor |
| Vergi para birimi | `cbc:TaxCurrencyCode` = TRY | Dövizlide evet | Sabit | ❌ |
| Fiyatlama para birimi | `cbc:PricingCurrencyCode` | Önerilir | Fatura dövizi | ❌ |
| GTİP (satır) | `CommodityClassification` schemeID="GTİP", 12 hane | Evet | Stok kartı (`gtip_kodu` **var**) | ⚠️ alan var, UBL'e yazılmıyor |
| Menşei | `OriginCountry` | Koşullu | Stok kartı (`mensei` **var**) | ⚠️ |
| KDV 0 + istisna kodu `351` | `TaxExemptionReasonCode` | Evet | Kural | ⚠️ kod listede var, otomatik seçilmiyor |
| Fiili ihracat tarihi | `cbc:ActualDeliveryDate` | Evet | Sihirbaz | ❌ |
| Teslim şartı (Incoterms) | `cac:DeliveryTerms` | Önerilir | Sihirbaz | ❌ |
| Taşıma şekli | `TransportModeCode` | Koşullu | Sihirbaz | ❌ |
| Gümrük beyanname no | `AdditionalDocumentReference` documentType="CUST_INV" | Gümrük kapandıktan sonra | Sonradan girilir | ❌ |

**Karar bekleyen:** beyanname numarası geldiğinde GİB'e güncelleme gönderilecek
mi, yoksa yalnız kayda mı işlenecek (tasarım belgesi §5.2 adım 5).

### 3.5 Yolcu beraberi (`YOLCUBERABERIESYA`)

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Yolcu pasaport no ve ülkesi | `PartyIdentification` schemeID="PASAPORTNO" | Evet | ❌ |
| KDV tahsil edilir, iade süreci ayrı | `TaxTotal` | Evet | ❌ |
| İade aracı kurum (varsa) | `Note` | Koşullu | ❌ |

### 3.6 Kamu iade (`KAMU` + `IADE`) — şematron §4

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Senaryo `KAMU`, tip `IADE` | `ProfileID` + `InvoiceTypeCode` | Evet | ❌ |
| İade edilen fatura(lar): no, tarih, tür | `BillingReference/InvoiceDocumentReference` (birden çok olabilir) | Evet | ❌ |
| Ödemeyi yapacak harcama birimi VKN | `BuyerCustomerParty/PartyIdentification` | Evet | ❌ |
| Ödemenin yapılacağı IBAN | `PaymentMeans/PayeeFinancialAccount` | Evet | ❌ |

### 3.7 Şarj (`SARJ`) — şematron §1

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Fatura tipi `SARJ` | `InvoiceTypeCode` | Evet | ❌ |
| Alıcı araç plakası | `AccountingCustomerParty/PartyIdentification` schemeID="PLAKA" | Evet | ❌ (plaka biçim kuralı hazır, EBLG-50) |
| Şarj başlangıç tarihi/saati, bitiş tarihi/saati | `cac:InvoicePeriod` (StartDate/StartTime/EndDate/EndTime) | Evet | ❌ |
| ESU rapor kimliği (GUID, birden çok olabilir) | `AdditionalDocumentReference` schemeID="ESURaporID" + tarih | Evet | ❌ |

### 3.8 Şarjanlık (`SARJANLIK`) — şematron §1.4

Şarj alanlarına ek olarak:

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Şarj ünitesi seri numarası | `Item/ItemInstance/SerialID` | Evet | ❌ |

### 3.9 İhraç kayıtlı (`IHRACKAYITLI`)

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Senaryo `IHRACKAYITLI` | `ProfileID` | Evet | ❌ |
| KDV hesaplanır ama tahsil edilmez | `TaxTotal` + istisna kodu | Evet | ❌ |
| İhracatçının VKN'si | `AccountingCustomerParty` | Evet | ⚠️ normal alıcı alanı |

---

## 4. Tevkifat ve istisna (türden bağımsız)

| Kural | Durum |
|---|---|
| Tevkifat kodu satırda seçilir, oran koddan türer | ✅ |
| Kod başına tek `WithholdingTaxTotal` bloğu | ✅ |
| KDV sıfırsa istisna kodu zorunlu (istisna değilse `351`) | ✅ |
| Kısmi istisna kodu `233` | ✅ (EBLG-51) |
| İstisna kodları `ISTISNA/IADE/IHRACKAYITLI/SGK/YTBIADE` tiplerine göre süzülür | ❌ — liste bugün tipe göre süzülmüyor |

---

## 5. Sihirbaz adımları (öneri)

1. **Kanal ve tür** — kural belirler, gerekçesiyle gösterilir (alıcı mükellef mi,
   yurt dışı mı, satır içeriği ne diyor). Yalnız ticari/temel seçimi kullanıcıya
   bırakılır.
2. **Türe özel alanlar** — yukarıdaki tablodan yalnız o türün satırları sorulur.
3. **Ön kontrol** — eksikler tek listede (e-İrsaliye'deki `gonderimEngelleri`
   kalıbı), her biri düzeltileceği ekrana bağlantılı.
4. **Özet ve gönder** — UBL'e gidecek değerlerin okunur özeti, sonra gönderim.

---

## 6. İş kalemleri (özet)

| # | İş | Kapsam |
|---|---|---|
| ~~A~~ | ~~Birim kodu eşlemesi~~ — **bitti** (EBLG-52) | Tüm türler |
| B | e-Arşiv internet satışı alan grubu | e-Arşiv |
| C | İhracat: profil, ülke, GTİP, menşei, TaxCurrencyCode, teslim şartı, fiili ihracat tarihi | İhracat |
| D | Gümrük beyanname no akışı (karar bekliyor) | İhracat |
| E | KAMU-IADE alan grubu | Kamu |
| F | SARJ / SARJANLIK alan grubu | Şarj |
| G | Yolcu beraberi | Tax-free |
| H | İhraç kayıtlı | İhracat zinciri |
| I | Alıcı alias'ının UBL'e yazılması | e-Fatura |
| J | İade faturasında `BillingReference` | Tüm iade tipleri |
| K | İstisna kod listesinin fatura tipine göre süzülmesi | Tüm türler |
| L | Sihirbazın çok adımlı hale getirilmesi | Arayüz |
