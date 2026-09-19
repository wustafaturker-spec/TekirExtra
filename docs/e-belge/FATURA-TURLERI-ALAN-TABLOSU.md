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
| 4 | İhracat | `IHRACAT` | SATIS | Alıcı yurt dışı | Yok (gümrük süreci ayrı) | ✅ |
| 5 | Yolcu beraberi | `YOLCUBERABERFATURA` | ISTISNA | Türkiye'de ikamet etmeyen yolcuya KDV'li satış; iade yetkili aracı kurumdan | Yok (gümrük onayı aracı kuruma gider) | ✅ (2026-09-20) |
| 6 | Kamu | `KAMU` | SATIS / TEVKIFAT / ISTISNA / IADE | Alıcı merkezi yönetim kamu idaresi (GİB listesinde `<Type>KAMU</Type>` ya da kartta işaret); IADE: kamu idaresinden alınan malın iadesi | Yok | ✅ (2026-09-20) |
| 7 | Şarj | `EARSIVFATURA` / e-Fatura | `SARJ` | Elektrikli araç şarj hizmeti | Kanala göre | ❌ |
| 8 | Şarjanlık | `EARSIVFATURA` / e-Fatura | `SARJANLIK` | Şarj ünitesi/işletmecilik | Kanala göre | ❌ |
| 9 | İhraç kayıtlı | TEMEL/TICARI | IHRACKAYITLI | İhracatçıya ihraç kaydıyla teslim | Profile göre | ✅ (EBLG-60) |

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
| Satıcı VKN, unvan, adres, vergi dairesi | `AccountingSupplierParty` | Firma kartı | ✅ EBLG-62 — adres önceden sabit "Merkez/Istanbul" idi; artık firma kartından, eksikse gönderim durur |
| Satıcı web sitesi, MERSİS, ticaret sicil, telefon, e-posta | `WebsiteURI`, `PartyIdentification`, `Contact` | Firma kartı | ✅ EBLG-62 (isteğe bağlı) |
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
| İade referansı | `cac:BillingReference` | İade tipinde | İade edilen fatura | ✅ (EBLG-58) — her fatura ayrı blok, 16 haneli no + `DocumentTypeCode` IADE |
| Tevkifatlı faturanın iadesi | `InvoiceTypeCode` TEVKIFATIADE | Satırda tevkifat kodu olan iadede | Kural | ✅ (EBLG-61) — tevkifatsız: `WithholdingTaxTotal` yok (şematron reddeder), KDV yalnız tevkif dışı kısım, oran aynı; 100 + %20, 9/10 → 100 + 2 |
| İstisnalı iade | `InvoiceTypeCode` IADE | Sıfır KDV'li satırı olan iadede | Kural | ✅ denendi (2026-09-19) — tip IADE kalır, kod satırda ve belge altında; tek başına (350) ve %20 satırla karışık (301) NES önizlemesinden geçti |
| Yurt dışındaki tedarikçiye iade | — | Tedarikçinin fatura adresi yurt dışında | Kural | ⛔ e-belge ile kesilmez (karar 2026-09-19, `YURT_DISI_IADE_ENGELI`) — sihirbaz ilk adımda, sunucu gönderim ve önizlemede durdurur. Not: şematron IHRACAT/ISTISNA + serbest numaralı iade referansını kabul ediyordu; gerekirse bu yol açılabilir |

### 3.2 Temel e-Fatura (`TEMELFATURA`)

Ticari ile aynı alan kümesi; farkı yanıt beklenmemesidir. Sihirbaz bunu
**açıkça yazmalı**: temelde alıcı kabul/ret veremez, 8 gün sonra kabul sayılır.

### 3.3 e-Arşiv (`EARSIVFATURA`)

| Alan | UBL | Zorunlu | Kaynak | Durum |
|---|---|---|---|---|
| Gönderim şekli (elektronik/kâğıt) | `AdditionalDocumentReference` SEND_TYPE | Evet | Sihirbaz | ✅ |
| Bireysel alıcıda ad/soyad | `Person` | TCKN'li alıcıda | Cari kartı (tahmin edilir, CARI-21) | ✅ |
| TCKN bilinmiyorsa `11111111111` | `PartyIdentification` | Koşullu | Sihirbaz seçimi | ❌ |
| **İnternet satışı**: sipariş no + tarih | `cac:OrderReference` | İnternet satışında | Fatura (`siparis_no`, `siparis_tarihi`) | ✅ |
| **İnternet satışı**: teslimat adresi | `cac:Delivery/DeliveryAddress` | İnternet satışında | Cari sevk adresi (e-İrsaliye ile aynı kural) | ✅ |
| **İnternet satışı**: web adresi | `cbc:Note` | İnternet satışında | Sihirbaz | ✅ |
| **İnternet satışı**: ödeme şekli + tarihi + aracısı | `cac:PaymentMeans` (UN/ECE 4461) | İnternet satışında | Sihirbaz | ✅ |
| **İnternet satışı**: kargo firması + gönderi tarihi | `Delivery/CarrierParty`, `ActualDeliveryDate` | Mal gönderiliyorsa | Sihirbaz | ✅ |
| Alıcı e-Fatura mükellefi **değil** doğrulaması | — | Evet | Mükellef listesi | ✅ |

**(İş kalemi B) kapandı (EBLG-56, 2026-09-18).** İşaret sihirbazda konur, grup
yalnız e-Arşiv kanalında yazılır; sipariş referansı kanaldan bağımsız her
faturaya gider. Kargo ve gönderi tarihi tabloda yoktu, GİB internet satışında
bunları da istediği için eklendi.

**Canlıda denenmedi:** web adresinin `cbc:Note` içinde taşınması ve ödeme
şekillerinin UN/ECE 4461 karşılıkları GİB e-Arşiv kılavuzunun yerleşik
uygulamasıdır; ilk internet satışı faturasından önce NES test ortamında
doğrulanmalı.

### 3.4 İhracat (`IHRACAT`) — tasarım belgesi §5

| Alan | UBL | Zorunlu | Kaynak | Durum |
|---|---|---|---|---|
| Senaryo `IHRACAT` | `cbc:ProfileID` | Evet | Kural (alıcı yurt dışı) | ✅ |
| Belge tipi `ISTISNA` | `cbc:InvoiceTypeCode` | Evet | Kural | ✅ |
| **Alıcı = Ticaret Bakanlığı** | `AccountingCustomerParty`, VKN `1460415308` | Evet | Sabit; posta kutusu `urn:mail:ihracatpk@gtb.gov.tr` | ✅ |
| **Malı alan yabancı firma** | `cac:BuyerCustomerParty`, `PartyIdentification` schemeID="PARTYTYPE" = `EXPORT` | Evet | Cari kartı; ülkesindeki vergi no `PartyLegalEntity/CompanyID` | ✅ |
| Alıcı ülkesi (TR dışı) | `BuyerCustomerParty/PostalAddress/Country` | Evet | Cari adresi (`cari_adresler.ulke`) | ✅ |
| Vergi para birimi + kur | `cbc:TaxCurrencyCode`=TRY, `cac:TaxExchangeRate`, `cac:PricingExchangeRate` | Dövizlide evet | Fatura dövizi ve kuru | ⚠️ NES reddediyor, bkz. EBLG-57 |
| **GTİP (satır)** | `InvoiceLine/Delivery/Shipment/GoodsItem/cbc:RequiredCustomsID`, 12 hane | Evet | Stok kartı (`gtip_kodu`) | ✅ |
| Menşei (satır) | `Item/OriginCountry` — **`cbc:Name` zorunlu**, yalnız kod şemadan döner | Koşullu | Stok kartı (`mensei`) | ✅ |
| KDV 0 + istisna kodu **301/302** + açıklaması | fatura `TaxTotal/TaxCategory/TaxExemptionReasonCode` + `TaxExemptionReason` | Evet | Kural (mal/hizmet) | ✅ |
| Fiili ihracat tarihi | `InvoiceLine/Delivery/cbc:ActualDeliveryDate` | Evet | Sihirbaz | ✅ |
| Teslim şartı (Incoterms) | `InvoiceLine/Delivery/cac:DeliveryTerms` | Önerilir | Sihirbaz | ✅ |
| Taşıma şekli | `InvoiceLine/Delivery/Shipment/ShipmentStage/TransportModeCode` | Koşullu | Sihirbaz | ✅ |
| Gümrük beyanname no | `AdditionalDocumentReference` DocumentType="CUST_INV" | Gümrük kapandıktan sonra | Sonradan girilir | ✅ |

**Kapandı (EBLG-53/54, 2026-09-18).** İki düzeltme:

1. **İstisna kodu `351` değil `301`/`302`.** Tasarım belgesi `351` diyor; GİB
   kod listesinde `351` = "KDV - İstisna Olmayan Diğer", yani işlem istisna
   sayılmaz ve KDV iadesi riske girer. Mal ihracatı `301`, hizmet ihracatı
   `302`; kod satırın stok tipinden türer, kullanıcı seçmez.
2. **Beyanname numarası yalnız kayda işlenir** (karar 2026-09-18, §5.2 adım 5):
   gönderilmiş e-Fatura değiştirilemediği ve gümrük eşleşmesi fatura UUID'si
   üzerinden yürüdüğü için GİB'e ikinci gönderim yapılmaz.

**Denendi ve düzeltildi (2026-09-18).** İlk uygulama tasarım belgesine
dayanıyordu ve altı yerde yanlıştı; **GİB'in resmî örneği repoda duruyor**:
`docs/e-belge/Sovos Bulut e-Fatura WS API v2.3/EK1 - Teknik Belgeler/UBL-TR
1.2.1/XSLT/IHRACAT.xml`. Yanlış olanlar: belge tipi (SATIS → **ISTISNA**), alıcı
(uydurma `2222222222` → **Bakanlık VKN'si**, yabancı firma ayrı tarafa),
GTİP'in yeri (`CommodityClassification` → **`RequiredCustomsID`**), teslimatın
yeri (fatura → **satır** düzeyi) ve istisna kodunun yeri.

NES test ortamına gönderim iki bulgu daha verdi:
1. `cac:OriginCountry` **`cbc:Name` ister**; yalnız kod yazılan belge
   `FAILED_XML_SCHEMA_CHECK` ile döner. Düzeltildi.
2. Dövizli belge hâlâ reddediliyor (EBLG-57) — bu kural ihracata değil TRY dışı
   her belgeye ait ve sistemden bugüne dek dövizli belge hiç gönderilmemiş.

**TRY ihracat faturası NES test ortamında kabul edildi** (`iletildi`), yani
yapının kalanı şematrondan geçiyor.

### 3.5 Yolcu beraberi (`YOLCUBERABERIESYA`)

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Yolcunun kimliği | `BuyerCustomerParty` (`PARTYTYPE`=TAXFREE) → `Person`: `FirstName`, `FamilyName`, `NationalityID` (ISO2), `IdentityDocumentReference/ID` + `IssueDate` | Evet | ✅ — tarih bilinmiyorsa 2005-01-01 (kılavuz) |
| Yolcunun ikamet adresi | `BuyerCustomerParty/PostalAddress` (şehir + ülke) | Evet | ✅ — ülke TR olamaz |
| Yolcunun iade hesabı | `Person/FinancialAccount` | Seçimli | ✅ |
| Aracı kurum | `TaxRepresentativeParty`: `ARACIKURUMVKN`, `ARACIKURUMETIKET`, unvan, adres | Evet | ✅ — firma kartında varsayılan, sihirbazda değişir |
| KDV tahsil edilir, iade süreci ayrı | `TaxTotal` → `TaxExemptionReasonCode` 501 + açıklama (belge düzeyinde) | Evet | ✅ — sıfır KDV'li ya da tevkifatlı satır kabul edilmez |
| Alıcı ve kutu | `AccountingCustomerParty` Gümrük Bakanlığı (1460415308), zarf `urn:mail:yolcuberaberpk@gtb.gov.tr` | Evet | ✅ — ihracatın kutusundan ayrıdır |

Kaynak: GİB "e-Fatura Uygulaması Gümrük İşlemleri Kılavuzu" v1.8 §4 ve resmî
`XSLT/YOLCUBERABER.xml`. İşaret sihirbazda konur ve cari adresinden türeyen
ihracat kararını ezer; satış genel bir cariye kesildiği için alıcının VKN'si
aranmaz. Satış iptali/iadesi ayrıca GİB'in Tax-Free Satış İptal/İade Bildirim
Portalı'ndan bildirilir (sistem dışı). NES testte K072026000000066 kabul edildi.

### 3.6 Kamu iade (`KAMU` + `IADE`) — şematron §4

| Alan | UBL | Zorunlu | Durum |
|---|---|---|---|
| Senaryo `KAMU` (tip SATIS/TEVKIFAT/ISTISNA/IADE) | `ProfileID` + `InvoiceTypeCode` | Evet | ✅ — liste türünden ya da kart işaretinden türer (`kamuSenaryosuMu`), ticari profili de ezer |
| İade edilen fatura(lar): no, tarih, tür | `BillingReference/InvoiceDocumentReference` (birden çok olabilir) | Evet | ✅ EBLG-58 altyapısı; `DocumentTypeCode` IADE NES'te kabul |
| Ödemeyi yapacak harcama birimi VKN + adı | `BuyerCustomerParty/PartyIdentification[@schemeID=VKN]` + `PartyName` + alıcının adresi | Evet | ✅ — kartta varsayılan, sihirbazda faturaya yazılır; boşsa alıcının kendisi |
| Ödemenin yapılacağı IBAN | `PaymentMeans` (`ZZZ`) `/PayeeFinancialAccount/ID` + `CurrencyCode` TRY | Evet | ✅ — Kasa/Banka'daki IBAN'lı TRY hesaplarından seçilir; şematron deseni + mod-97 |

NES önizlemesi (2026-09-20): KAMU+SATIS, KAMU+TEVKIFAT, KAMU+IADE geçti. NES testte
K072026000000062 (KAMU/SATIS) test kamu alıcısı 2222222105'e (`defaultpk@hmb.gov.tr`)
1300 "BAŞARIYLA TAMAMLANDI" ile teslim edildi. Kamu alıcısı e-Fatura listesinde yoksa
belge e-Arşiv'e düşürülmez, gönderim durur.

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
| Tip `IHRACKAYITLI` (profil değil; profil TEMEL/TICARI kalır) | `InvoiceTypeCode` | Evet | ✅ faturada işaretlenir |
| KDV hesaplanır, gösterilir, tahsil edilmez; kod 701/702 + açıklama KDV'li alt toplamda | `TaxTotal` + `TaxExemptionReasonCode` | Evet | ✅ net KDV 0, ödenecek = matrah |
| KDV dahil tutar ≠ ödenecek | `TaxInclusiveAmount` / `PayableAmount` | Evet | ✅ |
| İhracatçının VKN'si | `AccountingCustomerParty` | Evet | ✅ normal alıcı alanı |

Kaynak: kullanıcının kabul edilmiş belgesi (M012026000000078, yalnız yerelde).
Şematron bu tipte gevşek (kodsuz da geçiyor); 701 ise yalnız IHRACKAYITLI/IADE/SGK'da
geçer. 703 (ÖTV) desteklenmiyor. Yurt dışı alıcıya ihraç kayıtlı kesilemez.
NES testte K072026000000059 kabul (2026-09-19).

**Süre takibi (EBLG-63):** son gün = teslimi izleyen ay başından itibaren 3 ay
(701 ve 702, kullanıcı kararı). İhracatçının çıkış beyannamesi faturaya işlenene
kadar Faturalar › "İhraç kayıtlı: Beyannamesi gelmemiş" süzgecinde kalan gün
görünür; Bildirim Merkezi süre dolmadan 15 gün kala uyarı, dolunca kritik özet
üretir. Süre kuralı mali müşavirle doğrulanmalı.

---

## 4. Tevkifat ve istisna (türden bağımsız)

| Kural | Durum |
|---|---|
| Tevkifat kodu satırda seçilir, oran koddan türer | ✅ |
| Kod başına tek `WithholdingTaxTotal` bloğu | ✅ |
| KDV sıfırsa istisna kodu zorunlu (istisna değilse `351`) | ✅ |
| Kısmi istisna kodu `233` | ✅ (EBLG-51) |
| İstisna kodları `ISTISNA/IADE/IHRACKAYITLI/SGK/YTBIADE` tiplerine göre süzülür | ✅ (EBLG-59) — 351 SATIS kalır, iade IADE kalır, tevkifatlıda yalnız 351 |
| İstisna kodu + açıklaması belge düzeyinde, oran/kod başına alt toplam | ✅ (EBLG-59) — önceden yalnız satırdaydı, 0 KDV'li yurt içi belge dönüyordu |
| Tevkifat yüzdesi ondalıksız (`90`, `90.00` değil) | ✅ (EBLG-59) — önceden tevkifatlı belge hiç gidemiyordu |

Şematronun tip × kod matrisi (NES önizlemesi, 2026-09-19): 201–350 → ISTISNA, IADE,
IHRACKAYITLI, SGK, YTBIADE, YTBISTISNA · 351 → her tip · 701–703 → IHRACKAYITLI, IADE,
SGK · 801–811 → OZELMATRAH, IADE, SGK. IADE tipi TICARIFATURA profiliyle gidemez.

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
| ~~B~~ | ~~e-Arşiv internet satışı alan grubu~~ — **bitti** (EBLG-56) | e-Arşiv |
| ~~C~~ | ~~İhracat alan kümesi~~ — **bitti** (EBLG-53) | İhracat |
| ~~D~~ | ~~Gümrük beyanname no~~ — **bitti** (EBLG-54): yalnız kayda işlenir | İhracat |
| ~~E~~ | ~~KAMU-IADE alan grubu~~ — **bitti**, kamuya satışla birlikte (KAMU senaryosu) | Kamu |
| F | SARJ / SARJANLIK alan grubu | Şarj |
| ~~G~~ | ~~Yolcu beraberi~~ — **bitti** (2026-09-20) | Tax-free |
| H | İhraç kayıtlı | İhracat zinciri — ✅ EBLG-60 |
| I | Alıcı alias'ının UBL'e yazılması | e-Fatura |
| J | İade faturasında `BillingReference` | Tüm iade tipleri — ✅ EBLG-58 (alış iadesi; TEVKIFATIADE açık) |
| K | İstisna kod listesinin fatura tipine göre süzülmesi | Tüm türler — ✅ EBLG-59 |
| L | Sihirbazın çok adımlı hale getirilmesi | Arayüz — ✅ Kontrol → Bilgiler → Önizle ve gönder; son adım NES önizlemesi |
