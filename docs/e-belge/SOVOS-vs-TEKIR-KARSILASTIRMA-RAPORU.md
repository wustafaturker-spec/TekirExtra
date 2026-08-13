# Sovos e-Belge Dokümantasyonu ↔ Tekir ERP Mevcut Sistem — Ayrıntılı Karşılaştırma Raporu

> Tarih: 2026-05-31
> Kapsam: `e-belge/` altındaki Sovos WS API kılavuzları (e-Fatura v2.3, e-Arşiv v2.3, e-İrsaliye v1.3) ile
> mevcut `backend/.../invoice` ve `backend/.../despatch` modüllerinin satır bazlı karşılaştırması.
> Amaç: Sovos özel entegratörüne geçiş için boşluk (gap) analizi ve yol haritası.

---

## 0. Yönetici Özeti

Mevcut sistem **çalışan, port/adapter mimarisiyle yazılmış, çok-tenant** bir e-fatura altyapısına sahip.
Ancak `e-belge/` klasöründeki **tüm dokümantasyon Sovos'a aittir ve kodda hiçbir Sovos adaptörü yoktur.**
Mevcut adaptörler (Foriba/Uyumsoft/Mikro) **REST/JSON** varsayımıyla, GibDirect ise **GİB e-Arşiv vatandaş
portalı REST**'iyle yazılmış. Sovos ise tümüyle farklı bir model kullanıyor: **SOAP 1.1 + UBL zarfı (zip/base64)
+ sunucu tarafı imza + asenkron durum/rapor akışları.**

**En kritik 5 boşluk:**

| # | Boşluk | Etki | Öncelik |
|---|---|---|---|
| G1 | Sovos adaptörü yok; protokol uyumsuz (REST vs SOAP 1.1 + zarf + zip) | Sovos'a tek fatura gönderilemez | 🔴 BLOKER |
| G2 | UBL'e **XSLT gömülmüyor** (`FaturaID.xslt`) | GİB Görüntüleyici/alıcı faturayı **gösteremez**, Sovos reddeder | 🔴 BLOKER |
| G3 | **e-Arşiv raporlaması yok** (`sendReport`/`getReportData`/`getReportList`) | e-Arşiv yasal olarak eksik — GİB'e günlük rapor zorunlu | 🔴 BLOKER (e-Arşiv için) |
| G4 | **CustInvID / idempotency anahtarı yok**, zarf modeli yok | Hata sonrası tekrar gönderim çift fatura riski | 🟠 YÜKSEK |
| G5 | Gelen belge / Uygulama Yanıtı (UY) akışı yok (`getUBLList`/`getInvResponses`) | Alıcı KABUL/RED, gelen e-fatura işlenemiyor | 🟠 YÜKSEK |

---

## 1. Entegratör Mimarisi

### Mevcut Sistem
- **Port/Adapter** deseni doğru kurulmuş: `InvoiceIntegratorPort` (sendInvoice / queryStatus / queryAlias).
- `IntegratorType`: `GIB_DIRECT, FORIBA, UYUMSOFT, MIKRO, MOCK`.
- `IntegratorFactory` tenant config'ine göre adaptör seçiyor (multi-tenant ✔).
- Tüm gerçek adaptörler **RestClient (REST/JSON)** kullanıyor; `IntegratorSendRequest` tek fatura taşıyor.
- e-İrsaliye için ayrı simetrik `despatch` modülü (`DespatchIntegratorPort` + GIB/Foriba/Uyumsoft/Mock).

### Sovos Dokümantasyonu
- **SOAP 1.1** (SOAP 1.2 desteklenmez), HTTPS/443, **HTTP Basic Auth** (WS-Security DEĞİL).
- WSDL'ler dosyadan import edilmeli (`?wsdl` kapalı): `ClientEInvoiceServices-2.2.wsdl`, `EArchiveInvoiceService_v2.wsdl`, `ClientEDespatchServices-1.1.wsdl`.
- Veri modeli **zarf tabanlı**: `DocType = ENVELOPE | INVOICE | APP_RESP`, zip(base64) içinde tek UBL XML, dosya adı = UUID.

### ⚠️ Uyumsuzluk
| Boyut | Mevcut | Sovos | Karar |
|---|---|---|---|
| Taşıma | REST/JSON | SOAP 1.1 | **Yeni `SovosAdapter` gerekir** (JAX-WS client) |
| Birim | Tek fatura | Zarf (zip/base64) | Zarf sarıcı katmanı eklenmeli |
| Auth | API key / Bearer | HTTP Basic (3 ay geçerli şifre) | Config'e WS user/pass + uyarı alanı |
| Etiket | Tek `gibSenderAlias` | **GB + PK** ayrı etiketler | Config genişletilmeli |

**Sonuç:** Port arayüzü Sovos'u kaldıracak kadar soyut; `IntegratorType.SOVOS` + `SovosAdapter` eklemek yeterli ama **adaptör içi protokol tamamen farklı** (SOAP + zarf + zip).

---

## 2. UBL Üretimi (UblGenerator)

### Mevcut
- `UblGenerator` UBL-TR 1.2.1 üretiyor: `UBLVersionID=2.1`, `CustomizationID=TR1.2`, `ProfileID` senaryodan.
- Senaryolar: TICARIFATURA, TEMELFATURA, EARSIVFATURA, IHRACAT, MIKRO_IHRACAT, YOLCUBERABERFATURA, YATIRIMTESVIK, IHRACKAYITLI.
- İhracat/Yolcu Beraber için Gümrük VKN (`1460415308`) gömülü ✔.

### Sovos Gereksinimleri & Boşluklar
- 🔴 **XSLT gömme yok.** Sovos: her fatura UBL'ine `AdditionalDocumentReference` içinde `DocumentTypeCode=XSLT`, `filename="FaturaID.xslt"`, base64 XSLT **zorunlu**. Yoksa GİB Görüntüleyici ve alıcı faturayı gösteremez. → **UblGenerator'a XSLT eklenmeli.**
- 🟠 **İmza düğümleri:** Sovos gönderilen UBL'de `UBLExtensions`/`Signature` **istemiyor** (varsa siliyor, kendi HSM'iyle imzalıyor). Mevcut UblGenerator zaten imza eklemiyor → **bu nokta Sovos ile uyumlu** (artı puan).
- 🟠 **CustInvID:** Otomatik fatura ID modunda `AdditionalDocumentReference / DocumentTypeCode=CUST_INV_ID` gerekiyor. Mevcut UBL bunu üretmiyor.

---

## 3. İmzalama / Mali Mühür

| | Mevcut | Sovos |
|---|---|---|
| İmza kütüphanesi | **Yok** (pom'da xades/santuario/bouncycastle yok) | Gerekmez — **Sovos sunucu tarafında imzalar** |
| Sertifika yönetimi | `IntegratorConfig`'te alan var ama kullanılmıyor | Sovos'a kayıt sırasında bir kez, HSM Sovos'ta |

**Önemli kazanım:** Tasarım belgenizin (`tekirpkus-efatura-tasarim.docx`) "Bölüm 8 Mali Mühür — prod'a geçmeden zorunlu en kritik teknik borç" ve "her tenant kendi sertifikası mı" açık sorusu, **Sovos kullanılırsa büyük ölçüde ortadan kalkar.** Buna karşılık GIB_DIRECT adaptörü imza olmadan **production'da kullanılamaz** (mevcut haliyle yalnızca test/mock seviyesinde).

---

## 4. Fatura Numarası & Idempotency

| | Mevcut | Sovos |
|---|---|---|
| Numara | `InvoiceNumberGenerator` → `[PREFIX3][YEAR4][SEQ9]` (16 hane, PG sequence) | Müşteri üretebilir **veya** Sovos otomatik (`IN0`+yıl+9hane, GB etiketi başına ön ek) |
| Idempotency | Yok (envelopeId=UUID her seferinde yeni) | **CustInvID** (≤64 char, GB+VKN başına tekil) → hata sonrası aynı ID, çift gönderim engeli |
| Tekrar gönderim | `scheduleRetry()` yeni envelope UUID | `RESEND:<zarfUUID>` + aynı CustInvID/ID |

🟠 **Boşluk:** Mevcut modelde `gibInvoiceId`, `gibEnvelopeId` var ama **CustInvID kavramı yok**. Sovos otomatik ID modunda CustInvID zorunlu; manuel modda 16 hane GİB numarasını biz üretiriz (mevcut üretici uyumlu). Karar: **Numarayı biz üretelim** (mevcut generator korunur), CustInvID alanı = invoice.number map'lenebilir.

---

## 5. Gönderim & Durum Akışı (Saga)

### Mevcut (`InvoiceSaga`)
- RabbitMQ saga: UBL üret → MinIO'ya XML+PDF yükle → entegratöre gönder → `WAITING_RESPONSE`.
- Polling: `QUEUE_POLL` üzerinden per-fatura, **15s→30s→60s**, max **20 deneme**.
- Durum eşleme: `1300=ACCEPTED`, `1220=REJECTED`, `1000/1100=PENDING`.
- Red → otomatik storno yevmiye kaydı ✔. MinIO arşiv (VUK 10 yıl) ✔.

### Sovos Gereksinimleri
- `getEnvelopeStatus` **20'şerli toplu**, aynı zarf **günde max 2 kez**, son statü **2 haftaya kadar** sürebilir.
- Son statüye ulaşmış zarf **tekrar sorgulanmamalı** (otomatik bloklanma riski).

### ⚠️ Uyumsuzluk
- 🟠 Mevcut polling **çok agresif** (15s) ve **tek tek** → Sovos bunu "hatalı kullanım" sayıp erişimi otomatik bloklar.
  Sovos için: **zamanlanmış toplu job** (saatlik/gecelik), 20'şerli `getEnvelopeStatus`, son durumda durdurma gerekir.
- Mevcut per-fatura Rabbit polling modeli Sovos'a **doğrudan taşınamaz**; SovosAdapter için ayrı batch durum-güncelleme job'ı yazılmalı.

---

## 6. Gelen Belge & Uygulama Yanıtı (UY)

| Akış | Mevcut | Sovos |
|---|---|---|
| Gelen e-fatura listesi | **Yok** | `getUBLList` (INBOUND, tarih aralığı max 1 gün) |
| Gelen belge indirme | **Yok** | `getUBL` (20'şerli, ZIP) |
| Alıcı KABUL/RED gönderme | **Yok** | `sendUBL` DocType=APP_RESP |
| Gelen UY sorgulama | **Yok** | `getInvResponses` / `getDesReceipts` |

🟠 **Büyük boşluk:** Mevcut sistem yalnızca **giden (OUTBOUND)** faturaya odaklı. TICARIFATURA senaryosunda **alıcının 8 gün içinde KABUL/RED** verme zorunluluğu var; gelen faturaları işleme (inbox), gelen faturaya UY üretme tamamen eksik. Tasarım belgesi Bölüm 10.2'de planlanmış ama **kodda yok**.

---

## 7. Kullanıcı Listesi / Alias Sorgu

| | Mevcut (`ChannelSelectorService`) | Sovos tavsiyesi |
|---|---|---|
| Yöntem | Partner başına **canlı** `queryAlias`, 24s cache | **Günde 1 kez** tam PK listesi indir (`getPartialUserList`), kontrol **lokalde** |
| Risk | Her yeni partner için API çağrısı → yoğunlukta bloklanma | Parçalı (100k'lık), `correlationID` bütünlüğü |

🟠 **Boşluk:** Mevcut yaklaşım düşük hacimde çalışır ama Sovos "her gönderimde alias sorma, listeyi indir lokalde bak" diyor. **`getPartialUserList` ile günlük senkronizasyon + lokal mükellef tablosu** eklenmeli. Mevcut `partner.efaturaRegistered`/`gibAlias` alanları bu lokal cache'in temeli olabilir.

---

## 8. e-Arşiv

| | Mevcut | Sovos (ayrı WS) |
|---|---|---|
| Senaryo yönlendirme | `ChannelSelector` → EARSIVFATURA ✔ | — |
| Gönderim | Aynı `sendInvoice` (GibConnector earsiv-services REST) | `sendInvoice` (senkron) / `sendEnvelope` (asenkron, max 100) |
| **Günlük GİB raporu** | 🔴 **Yok** | `getReportList/getReportData/getReportStatus` — **yasal zorunlu** |
| İptal | Storno yevmiye ✔, ama GİB iptali yok | `cancelInvoice` (tutar+tarih, rapor dönemi içinde) |
| İtiraz | Yok | `actionService` (EARSIV_ITIRAZ: KEP/NOTER/TELGRAF/TAAHHUTLU_MEKTUP) |
| Şube | Yok | `BRANCH` (customizationParams) — VKN başına çok ön ek/XSLT |
| Gönderim Şekli | UBL'de yok | `KAGIT`/`ELEKTRONIK` zorunlu alan |

🔴 **Kritik:** e-Arşiv'in özü faturanın kendisi değil **günlük rapordur**. Mevcut sistemde e-Arşiv raporlama tamamen yok → **e-Arşiv yasal olarak tamamlanmamış.** Ayrıca alıcı e-fatura mükellefiyse e-Arşiv reddedilmeli (Sovos hata 30) — ChannelSelector bunu yönlendiriyor ama gönderim öncesi lokal mükellef kontrolü garanti değil.

---

## 9. e-İrsaliye (despatch modülü)

- Mevcut: Tam simetrik modül (`Despatch`, `DespatchSaga`, `UblDespatchGenerator`, `DespatchXmlValidator`).
- Adaptörler: GIB_DIRECT, FORIBA, UYUMSOFT, MOCK. **Sovos yok.**
- Sovos: `sendDesUBL`, `getDesUBLList`, `getDesUBL`, `getDesEnvelopeStatus`, `getDesView`, `getDesPartialUserList`, `getDesReceipts` (`DESPATCH`/`RECEIPT` belge tipleri, CustDesID idempotency).
- 🟢 İyi haber: e-Fatura ile aynı protokol; SovosAdapter yazıldıktan sonra despatch için **simetrik** `SovosDespatchAdapter` aynı kalıpla çıkar.

---

## 10. Hata Kodu Eşlemesi

| | Mevcut | Sovos |
|---|---|---|
| Eşlenen | 1300/1220/1221/1000/1100 | **Çok daha geniş:** 3010 (zarf UUID mevcut), 3012 (fatura ID mevcut), 3240 (8 gün geçti), 3230 (UY sonuçlanmadı)… + e-Arşiv sayısal (5/20/25/30/40/56…) |
| RESEND edilebilir kodlar | Yok | 1150/1160/1171/1195/1215/1230… (geçici durumlar) |

🟠 Mevcut eşleme **eksik**. Sovos kod tabloları (kılavuzlarda tam liste) referans alınarak `mapStatus` genişletilmeli; özellikle "RESEND edilebilir" vs "kalıcı hata" ayrımı saga retry mantığı için kritik.

---

## 11. Config / Veri Modeli Boşlukları (`IntegratorConfig`)

Mevcut alanlar: `integratorType, apiEndpoint, apiKey, apiSecret, gibUsername, gibPassword, gibSenderAlias, staticIp, certificate*, invoicePrefix, earsivPrefix, testMode, active`.

Sovos için **eksik**:
- GB etiketi + PK etiketi (ayrı) — mevcut tek `gibSenderAlias`.
- WS kullanıcı adı/şifre + **şifre 3 ayda bir yenileniyor** uyarısı (cert_expires_at deseni gibi `ws_pass_expires_at`).
- Şube (BRANCH) eşlemesi (e-Arşiv için).
- Fatura ID otomatik üretim modu bayrağı (Sovos mu biz mi üretiyoruz).

---

## 12. Uyum Matrisi (özet)

| Yetenek | Mevcut | Sovos uyumu | Durum |
|---|---|---|---|
| Port/Adapter soyutlama | ✔ | Genişletilebilir | 🟢 |
| Çok-tenant config | ✔ | ✔ | 🟢 |
| UBL-TR 1.2.1 üretimi | ✔ | XSLT hariç ✔ | 🟡 |
| İmza eklenmemesi | ✔ | Sovos ile uyumlu | 🟢 |
| XSLT gömme | ✘ | Zorunlu | 🔴 |
| SOAP 1.1 + zarf + zip | ✘ | Zorunlu | 🔴 |
| CustInvID idempotency | ✘ | Otomatik ID'de zorunlu | 🟠 |
| Toplu/yavaş durum polling | ✘ (agresif) | Zorunlu | 🟠 |
| Gelen belge + UY (KABUL/RED) | ✘ | TICARIFATURA'da zorunlu | 🟠 |
| getPartialUserList lokal liste | ✘ (canlı sorgu) | Tavsiye | 🟠 |
| e-Arşiv günlük rapor | ✘ | Yasal zorunlu | 🔴 |
| e-Arşiv iptal/itiraz WS | ✘ | Gerekli | 🟠 |
| e-İrsaliye modülü | ✔ (Sovos hariç) | Simetrik | 🟡 |
| Storno yevmiye | ✔ | — | 🟢 |
| MinIO arşiv (VUK 10 yıl) | ✔ | — | 🟢 |

---

## 13. Önerilen Yol Haritası

**Faz 0 — Karar:** Hedef entegratör Sovos mu? Eğer evet, Foriba/Uyumsoft/Mikro adaptörleri "ileride" olarak kalır, öncelik Sovos.

**Faz 1 — Sovos e-Fatura çekirdeği (BLOKER'lar):**
1. `IntegratorType.SOVOS` + `SovosAdapter` (JAX-WS, SOAP 1.1, Basic Auth).
2. Zarf sarıcı (SENDERENVELOPE) + zip(base64) yardımcı katmanı.
3. `UblGenerator`'a **XSLT gömme** (`FaturaID.xslt`) — tek standart XSLT yeterli başlangıçta.
4. `IntegratorConfig`'e GB/PK etiket + WS user/pass alanları (yeni migration `V165`).
5. Durum güncelleme için **toplu, zamanlanmış** job (per-fatura Rabbit polling yerine SovosAdapter'a özel).

**Faz 2 — Bütünlük:**
6. `getPartialUserList` günlük senkron + lokal mükellef tablosu; ChannelSelector'ı lokalden okut.
7. CustInvID alanı + RESEND akışı + genişletilmiş hata kodu eşlemesi.
8. Gelen belge (`getUBLList`/`getUBL`) + Uygulama Yanıtı (KABUL/RED) inbox akışı.

**Faz 3 — e-Arşiv tamamlama:**
9. e-Arşiv WS (`sendInvoice`/`sendEnvelope`) + **rapor akışı** (`getReportList/Data/Status`) — yasal zorunluluk.
10. `cancelInvoice` + `actionService` (itiraz) + BRANCH desteği.

**Faz 4 — e-İrsaliye Sovos:**
11. `SovosDespatchAdapter` (Faz 1 kalıbının simetriği).

---

## 14. Notlar

- Tasarım belgeniz (`tekirpkus-efatura-tasarim.docx`) **genel GİB/Foriba/Uyumsoft** varsayımıyla yazılmış; Sovos'un getirdiği iki sadeleştirmeyi (sunucu tarafı imza, opsiyonel otomatik ID) henüz yansıtmıyor. Sovos kararı kesinleşirse tasarım belgesi Bölüm 7-8-9 güncellenmeli.
- Mevcut `GibDirectAdapter`/`GibConnector` GİB **e-Arşiv vatandaş portalı** (`earsivportal.efatura.gov.tr/earsiv-services`) REST'ini kullanıyor — bu **özel entegratör WS'i değil**, ölçeklenebilir/sözleşmeli bir kanal değil. Production hedefi entegratörse bu adaptör test/POC seviyesinde kalmalı.
- Bu rapor yalnızca inceleme çıktısıdır; hiçbir üretim kodu değiştirilmemiştir.
