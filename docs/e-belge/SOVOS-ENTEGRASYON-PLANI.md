# Sovos Özel Entegratör Entegrasyon Planı — Tekir ERP

> Tarih: 2026-05-31 (rev. 2 — gelen belge akışı ayrı faz olarak ağırlıklandırıldı)
> Dayanak: [`SOVOS-vs-TEKIR-KARSILASTIRMA-RAPORU.md`](./SOVOS-vs-TEKIR-KARSILASTIRMA-RAPORU.md)
> Kapsam: Sovos Bulut e-Fatura v2.3 + e-Arşiv v2.3 + e-İrsaliye v1.3 WS API'lerinin mevcut
> `invoice` / `despatch` modüllerine **port/adapter** deseniyle entegrasyonu.
> Prensip: Her faz **tek başına derlenir + test edilir**, kırık kod bırakılmaz. (bkz. [[feedback_no_giant_parallel_batches]])

## ⚖️ Temel İlke: Giden ↔ Gelen Eşit Ağırlık

e-Fatura ekosistemi **çift yönlüdür**. Bir entegrasyon yalnızca belge gönderebiliyorsa **yarım**dır:

- **Giden (OUTBOUND):** Bizim kestiğimiz fatura/irsaliye → karşı tarafa.
- **Gelen (INBOUND):** Başkasının bize kestiği belge → bizim sistemimize **alış faturası / cari / muhasebe / mal kabul** olarak işlenmeli.
- **Yanıt döngüsü:** TICARIFATURA'da alıcı **8 gün içinde KABUL/RED** vermek zorunda. Hem *bizim gönderdiğimize gelen yanıtı* (`getInvResponses`) hem de *bize gelene verdiğimiz yanıtı* (`sendUBL APP_RESP`) yönetmek gerekir.

Bu yüzden gelen belge bu planda **FAZ 3** olarak, gidenle (Faz 1-2) eşit kapsamda ele alınır.
Mevcut kodda gelen belge akışı **tamamen yok** — bağlanacağı hedefler hazır:
`Invoice (PURCHASE)`, `partner` (cari), muhasebe yevmiyesi, `satinalma/MalKabul`.

---

## 0. Temel Kararlar (kodlamadan önce netleşmeli)

| # | Karar | Varsayılan öneri | Etki |
|---|---|---|---|
| K1 | Fatura ID'yi kim üretir? | **Tekir üretir** (mevcut `InvoiceNumberGenerator`), CustInvID = `invoice.number` | Sovos GB "manuel ID" modu |
| K2 | Belge tipi sırası | e-Fatura giden → **gelen** → e-Arşiv → e-İrsaliye | Faz sırası |
| K3 | Durum/inbox takibi | Per-fatura Rabbit polling **yerine** zamanlanmış **toplu job** | Bloklanma riskini önler |
| K4 | XSLT | Tek standart kurumsal XSLT | `.../XSLT/general.xslt` baz |
| K5 | Diğer adaptörler | Foriba/Uyumsoft/Mikro **dokunulmaz** | Risk azaltma |
| **K6** | **Gelen e-Fatura otomasyonu** | **Otomatik PURCHASE taslağı oluştur, kullanıcı onaylar** (tam otomatik muhasebe değil) | İş akışı + risk |
| **K7** | **Gelen faturaya KABUL/RED** | **Manuel** (kullanıcı kararı) + opsiyonel "8 günde otomatik kabul" uyarısı | Ticari risk |
| **K8** | **Gelen e-İrsaliye → Mal Kabul** | İrsaliyeyi **MalKabul taslağına** dönüştür, depo onayı manuel | Stok doğruluğu |

> K6-K8 yeni: gelen belgenin nereye akacağını belirler. Onaylanmadan Faz 3'e başlanmamalı.

---

## FAZ 1 — Sovos e-Fatura Çekirdeği — GİDEN (BLOKER'lar)

**Hedef:** Bir TICARIFATURA'yı Sovos test ortamına SOAP ile gönderip 1300 (kabul) statüsüne ulaştırmak.

### 1.1 — Bağımlılık & WSDL client üretimi
- `backend/pom.xml`: `jaxws-rt`/`cxf` + `jaxws-maven-plugin` (`wsimport`) → `ClientEInvoiceServices-2.2.wsdl`.
  - Kaynak: `e-belge/Sovos Bulut e-Fatura WS API v2.3/EK1 - Teknik Belgeler/SOAP/`
  - Paket: `com.tekirpkus.invoice.integrator.sovos.ws`
- Doğrulama: `mvn compile` → `sendUBL, getEnvelopeStatus, getUBLList, getUBL, getInvoiceView, getPartialUserList, getInvResponses` client sınıfları.

### 1.2 — Veri modeli & migration `V165__sovos_integrator_fields.sql`
- `integrator_config`: `sovos_gb_alias`, `sovos_pk_alias`, `ws_username`(enc), `ws_password`(enc), `ws_pass_expires_at`, `auto_invoice_id`.
- `invoice`: `cust_inv_id VARCHAR(64)`, `gib_zarf_uuid VARCHAR(40)`.
- `IntegratorType` enum → `SOVOS` ekle.

### 1.3 — Zarf + zip katmanı
- `invoice/integrator/sovos/SovosEnvelopeBuilder.java` — UBL → SENDERENVELOPE zarfı, `<UUID>.xml` zip(base64).
- `invoice/integrator/sovos/SovosZipUtil.java`.

### 1.4 — UblGenerator: XSLT gömme (G2 — BLOKER)
- `invoice/ubl/UblGenerator.java` → `AdditionalDocumentReference` (`DocumentTypeCode=XSLT`, `filename="FaturaID.xslt"`, base64).
- XSLT: `src/main/resources/ubl/tekir-fatura.xslt`.

### 1.5 — SovosAdapter (G1 — BLOKER)
- `invoice/integrator/adapter/SovosAdapter.java implements InvoiceIntegratorPort`
  - `sendInvoice` → `sendUBL(DocType=ENVELOPE)` → `EnvUUID`.
  - `queryStatus` → `getEnvelopeStatus` → 1300/1220/1000/1100.
  - `queryAlias` → Faz 2 lokal listeye kadar canlı fallback.
  - Auth: HTTP Basic, SOAP 1.1.

### 1.6 — Saga + 1.7 toplu durum job'ı
- `InvoiceSaga` SOVOS için per-fatura polling devre dışı; `SovosStatusPollJob` (`@Scheduled`) 20'şerli `getEnvelopeStatus`, günde max 2 kez, son statüde durdur.

### Faz 1 Kabul Kriterleri
- [ ] `mvn clean install` yeşil. [ ] TICARIFATURA → 1300. [ ] UBL'de XSLT, GİB Görüntüleyici açıyor. [ ] CustInvID idempotency.

---

## FAZ 2 — Idempotency + Mükellef Listesi (giden bütünlük)

### 2.1 — Lokal mükellef listesi (G7) — `V166__gib_taxpayer_list.sql`
- `public.gib_taxpayer (vkn_tckn, alias, document_type, correlation_id, updated_at)` PUBLIC.
- `SovosUserListSyncJob` (`@Scheduled` günlük) → `getPartialUserList` (correlationID bütünlüğü) → upsert.
- `ChannelSelectorService` → canlı sorgu yerine **lokal tablodan** oku.

### 2.2 — CustInvID + RESEND (G4)
- `Invoice.custInvId = number`; hata zarfı → `Parameters=RESEND:<zarfUUID>`.
- `mapStatus` → RESEND edilebilir (1150/1160/1171/1195/1215/1230) vs kalıcı (1220) ayrımı → saga retry/storno kararı.

### Faz 2 Kabul Kriterleri
- [ ] Günlük mükellef senkronu, ChannelSelector lokalden okuyor. [ ] RESEND ile çift fatura yok.

---

## ⭐ FAZ 3 — GELEN BELGE AKIŞI (INBOUND) — gidenle eşit ağırlıkta

> Mevcut sistemde **tamamen eksik.** Bu faz, e-Fatura çift yönlülüğünü tamamlar.
> Üç ayrı akış içerir: (A) gelen fatura kutusu, (B) giden faturaya gelen yanıt, (C) gelene verdiğimiz yanıt, (D) gelen fatura → muhasebe/cari otomasyonu.

### 3.A — Gelen Fatura Kutusu (inbox)
- **Migration `V167__inbound_invoice.sql`:**
  `inbound_invoice (id, tenant_id, env_uuid, invoice_uuid, gib_invoice_id, sender_vkn, sender_name, issue_date, amount_total, currency, scenario, ubl_xml_path, pdf_path, response_code [KABUL/RED/IADE/null], response_deadline [+8 gün], status [NEW/VIEWED/RESPONDED/PROCESSED], received_at, processed_invoice_id [→ PURCHASE invoice], created_at)`. PUBLIC + tenant_id.
- **`invoice/inbound/InboundPollJob.java`** (`@Scheduled`, min 1 saat):
  - `getUBLList(INBOUND, DocType=ENVELOPE, FromDate–ToDate max 1 gün)` → yeni zarflar.
  - `getUBL(20'şerli, ZIP)` → UBL indir → MinIO + `inbound_invoice` (status=NEW).
  - **Tarih kursörü lokal saklanır; aynı aralık tekrar sorgulanmaz** (Sovos tavsiyesi).
  - Multi-tenant: her tenant için `TenantContext` set (bkz. [[bank_module_review]] B1).
- **`getInvoiceView`** ile gelen faturanın HTML/PDF görüntüsü (bir kez alınıp MinIO'ya, tekrar çekilmez).
- **Controller `InboundInvoiceController`:** gelen kutusu listele/filtrele, detay, PDF indir.
- **Frontend:** yeni OWL ekranı `InboundInvoiceView` (gelen kutusu) + Next.js sayfası.

### 3.B — Giden Faturaya Gelen Yanıt (`getInvResponses`)
- Gönderdiğimiz **TICARIFATURA**'lara alıcının verdiği KABUL/RED takibi.
- **`SovosResponsePollJob`** (`@Scheduled`) → `WAITING_RESPONSE`/`ACCEPTED` faturalar için `getInvResponses(OUTBOUND, 20'şerli)`:
  - `ARType=KABUL` → `Invoice.markBuyerAccepted()` (yeni durum), bildirim.
  - `ARType=RED` → `Invoice.markBuyerRejected()` → **iade faturası kesilmeli** uyarısı + opsiyonel storno.
- **Invoice modeli:** `buyer_response_code`, `buyer_responded_at`, `buyer_response_note` alanları (tasarım belgesi Bölüm 11.1'de zaten öngörülmüş) — `V167` içine ekle.
- **8 gün kuralı:** yanıt gelmezse otomatik kabul; deadline izleme + bildirim.

### 3.C — Gelene Verdiğimiz Uygulama Yanıtı (KABUL/RED/İADE)
- **`invoice/inbound/ApplicationResponseService.java`:**
  - Gelen TICARIFATURA için UBL ApplicationResponse üret (KABUL/RED + gerekçe notu).
  - `sendUBL(DocType=APP_RESP)` ile **PK→GB** gönder; durum `getEnvelopeStatus` ile izle.
  - XSD: `.../XSD/maindoc/UBL-ApplicationResponse-2.1.xsd`, örnek: `KabulUygulamaYanitiOrnegi.xml`/`RedUygulamaYanitiOrnegi.xml`.
- **İş kuralı (K7):** KABUL/RED **manuel** (kullanıcı); 8 gün dolmadan tekrar UY gönderilemez (3230 kontrolü).
- **Controller:** `POST /inbound-invoices/{id}/accept`, `/{id}/reject` (gerekçe).

### 3.D — Gelen Fatura → Alış (PURCHASE) + Cari + Muhasebe (K6)
- **`invoice/inbound/InboundInvoiceConverter.java`:**
  - Gelen UBL'i parse et → tedarikçi (cari) eşle (VKN ile `partner` lookup; yoksa taslak cari öner).
  - **`Invoice (type=PURCHASE)` taslağı** oluştur (kalemler, KDV, tevkifat dahil) → mevcut `confirmPurchase()` akışına bağla.
  - `inbound_invoice.processed_invoice_id` ile bağ; çift işleme engeli (idempotent).
  - Onay → mevcut alış faturası muhasebeleşmesi (320 tedarikçi / 191 KDV / gider) tetiklenir.
- **İş kuralı (K6):** otomatik **taslak**, kullanıcı onayı zorunlu (tam otomatik muhasebe değil).
- **Test:** UBL parse → PURCHASE taslak alanları doğru; KABUL verince alış faturası akışı çalışır.

### Faz 3 Kabul Kriterleri
- [ ] Gelen fatura inbox'a düşüyor, görüntüsü açılıyor.
- [ ] Gönderdiğimiz TICARIFATURA'ya gelen KABUL/RED işleniyor; 8 gün deadline izleniyor.
- [ ] Gelen faturaya KABUL/RED gönderilebiliyor (3230/8 gün kuralı korunur).
- [ ] Gelen fatura tek tıkla **alış faturası taslağına** dönüşüyor, çift işleme engelli.

---

## FAZ 4 — e-Arşiv Tamamlama (giden + yasal rapor)

> Not: e-Arşiv **tek yönlüdür** (alıcı GİB kayıtsız/son tüketici → gelen e-Arşiv yoktur). Bu faz sadece giden + rapor.

### 4.1 — WSDL client + config — `V168__earsiv_fields.sql`
- `EArchiveInvoiceService_v2.wsdl` → `wsimport` (`...sovos.earsiv.ws`).
- `integrator_config.earsiv_branch`; `invoice.earsiv_report_uuid`, `earsiv_send_type` (KAGIT/ELEKTRONIK), `earsiv_status_code`.

### 4.2 — Gönderim
- `SovosEarsivAdapter` → `sendInvoice` (senkron, anlık PDF) / `sendEnvelope` (asenkron, max 100) / `getInvoiceDocument` / `getSignedInvoice` (≥130).
- `UblGenerator` → **Gönderim Şekli** zorunlu alanı.
- `ChannelSelector` → EARSIVFATURA'da alıcı e-fatura mükellefiyse reddet (Sovos hata 30 önlemi, lokal listeden).

### 4.3 — Günlük rapor (yasal çekirdek) — `V169__earsiv_report.sql`
- `EarsivReportJob` (`@Scheduled` günlük) → `getReportList` → `getReportData/getReportStatus` → durum izleme.
- `earsiv_report` tablosu + controller (rapor listesi/durum).

### 4.4 — İptal & İtiraz
- `cancelInvoice` (tutar+tarih, rapor dönemi içinde) — mevcut storno ile entegre.
- `actionService(EARSIV_ITIRAZ)` (KEP/NOTER/TELGRAF/TAAHHUTLU_MEKTUP).
- `InvoiceController /{id}/cancel` → e-Arşiv ise GİB iptalini de tetikle.

### Faz 4 Kabul Kriterleri
- [ ] e-Arşiv gönderiliyor, PDF/imzalı UBL alınıyor. [ ] Günlük rapor GİB'e gidiyor. [ ] İptal GİB'e bildiriliyor.

---

## FAZ 5 — e-İrsaliye Sovos (GİDEN + GELEN simetrik)

> e-Fatura kalıbının simetriği; `ClientEDespatchServices-1.1.wsdl`. **Hem giden hem gelen** içerir.

### 5.1 — Giden
- `wsimport` (`...despatch.sovos.ws`) → `SovosDespatchAdapter implements DespatchIntegratorPort`
  - `sendDesUBL (DESPATCH)`, `getDesEnvelopeStatus`, `getDesView`, CustDesID idempotency.
- `SovosDespatchStatusPollJob` (Faz 1.7 simetriği).
- `V170__sovos_despatch_fields.sql` — GB/PK + cust_des_id.

### 5.2 — ⭐ Gelen e-İrsaliye → Mal Kabul (inbound, Faz 3 simetriği)
- **`despatch/inbound/InboundDespatchPollJob.java`** → `getDesUBLList(INBOUND)` → `getDesUBL(20'şerli)` → MinIO + `inbound_despatch` tablosu.
- **`despatch/inbound/ReceiptAdviceService.java`** → gelen irsaliyeye **İrsaliye Yanıtı (ReceiptAdvice)** üret → `sendDesUBL(RECEIPT)` (PK→GB). XSD: `UBL-ReceiptAdvice-2.1.xsd`, örnek: `ReceiptAdvice.xml`.
- **`despatch/inbound/DespatchToMalKabulConverter.java`** (K8) → gelen irsaliyeyi `satinalma/MalKabul` taslağına dönüştür (kalemler/miktarlar) → depo onayı manuel → stok girişi mevcut mal kabul akışıyla.
- **`getDesReceipts`** → gönderdiğimiz irsaliyeye gelen yanıt takibi.
- **Migration `V171__inbound_despatch.sql`** — `inbound_despatch` + `mal_kabul_id` bağı.

### Faz 5 Kabul Kriterleri
- [ ] e-İrsaliye gönderiliyor (1300). [ ] Gelen irsaliye inbox + ReceiptAdvice gönderiliyor. [ ] Gelen irsaliye **mal kabul taslağına** dönüşüyor.

---

## Çapraz Kesit Konuları (tüm fazlar)

- **Multi-tenant scheduler:** Tüm `@Scheduled` job'lar (durum, inbox, yanıt, rapor, mükellef) her tenant için `TenantContext` set ederek çalışmalı (bkz. [[bank_module_review]] B1 dersi — en sık tekrarlayan tuzak).
- **İnbox kursörü:** Gelen belge job'ları **işlenen son tarihi** lokal saklamalı; aynı aralık asla tekrar sorgulanmaz (Sovos: bloklanma sebebi).
- **Idempotency:** Gelen belgeler `env_uuid`/`invoice_uuid` ile tekil; çift indirme/çift PURCHASE engeli.
- **Şifreleme:** Yeni WS user/pass `CredentialEncryptor` (AES-256-GCM).
- **Hata/durum sözlüğü:** `src/main/resources/sovos-status-codes.json` (hardcode yerine).
- **Boyut limitleri:** Zarf ≤ 5MB; `getUBL`/`getEnvelopeStatus`/`getInvResponses` ≤ 20 UUID/çağrı.
- **Loglama:** `InvoiceTransmissionLog` event tipleri (DELIVERED_TO_RECEIVER, ACCEPTED, REJECTED) gelen yanıt için de kullanılır.

---

## Bağımlılık Sırası

```
FAZ 1 (e-Fatura giden) ──> FAZ 2 (idempotency + mükellef listesi)
                                  │
                                  ├──> FAZ 3 ⭐ GELEN BELGE (inbox + yanıt + alış/cari/muhasebe)
                                  ├──> FAZ 4 (e-Arşiv giden + rapor) [yasal]
                                  └──> FAZ 5 (e-İrsaliye giden + GELEN→mal kabul) [simetrik]
```

## Migration Numaraları (rezerve)
| Migration | İçerik |
|---|---|
| V165 | integrator_config Sovos alanları + invoice cust_inv_id/zarf_uuid |
| V166 | gib_taxpayer (lokal mükellef listesi) |
| V167 | **inbound_invoice + invoice buyer_response alanları** (gelen e-Fatura) |
| V168 | e-Arşiv config + invoice alanları |
| V169 | earsiv_report |
| V170 | despatch Sovos alanları |
| V171 | **inbound_despatch + mal_kabul bağı** (gelen e-İrsaliye) |

## Tahmini Efor (kaba)
| Faz | İçerik | Tahmin |
|---|---|---|
| Faz 1 | e-Fatura giden (BLOKER) | ~5-8 gün |
| Faz 2 | Idempotency + mükellef | ~3-4 gün |
| **Faz 3** | **Gelen belge (inbox + yanıt + alış/cari/muhasebe)** | **~6-9 gün** |
| Faz 4 | e-Arşiv + rapor | ~5-7 gün |
| Faz 5 | e-İrsaliye giden + gelen→mal kabul | ~4-6 gün |

> Önce **K1-K8 kararları** onaylanmalı (özellikle K6-K8: gelen belge otomasyonu). Faz 1 olmadan gelen e-Fatura adaptörü de çalışmaz (aynı SovosAdapter).
> Her faz sonunda `mvn clean install` yeşil + kabul kriterleri sağlanmış olmalı.
