# TekirExtra — Yazılım İster Dokümanı (SRS)

**Sürüm:** 0.17
**Tarih:** 2026-07-16
**Durum (2026-07-16):** **UI Tamamlama** sürüyor (plan: `docs/UI-TAMAMLAMA.md`);
Paket 1/2/3/4/7 bitti. Paket 3 ile **KSB-05 iki kez genişletildi**:
1. **Tahsil artık para hareketi doğuruyor** — yalnız durum değişiyordu.
   `PATCH /kasa-banka/cek-senet/:id` → `hesapKasaId` / `hesapBankaHesapId` /
   `islemTarihi`; seçilen hesaba tahsilat fişi yazılır.
2. **Verilen (kendi kestiğimiz) çek/senet eklendi** — model yalnız alınan çeki
   varsayıyordu; kendi çekimiz kaydedilseydi cari ters yönde işlenir, ödeme
   parayı hesaba *sokar* ve müşterinin risk limitini şişirirdi. `CekSenet.yon`
   (`alinan` | `verilen`) + `verildi`/`odendi` durumları eklendi (migration
   `20260716203342_cek_senet_yon`; mevcut kayıtlar `alinan`).
Kurallar: tahsilde/ödemede hesap, ciroda ciro carisi, verilende lehtar cari
sunucuda zorunlu; hesap para birimi çek/senetle uyuşmalı; durum yönle tutarlı
olmalı; aynı duruma ikinci geçişte tekrar fiş yazılmaz. Cari, çek alınırken/
verilirken zaten işlendiği için fişte cari hareketi yazılmaz (çift kayıt olurdu).
Cari riskine (CARI-17) yalnız `yon=alinan` çekler sayılır.
**Durum (FTR-10, 2026-08-10):** tekrarlayan faturalar eklendi. Mevcut bir
fatura şablon seçilerek haftalık, aylık veya yıllık plan tanımlanabilir;
aralık, ilk üretim ve isteğe bağlı bitiş tarihi izlenir. Vadesi gelen
dönemler idempotent olarak **taslak** fatura üretir; cari, depo, kalem,
fiyat/vergi bilgileri ve şablondaki vade günü korunur. Otomatik kesinleştirme
yoktur; stok ve cari etkisi kullanıcı kontrolünden sonra doğar.
**Durum (2026-07-15):** **Fiyat Listeleri modülü tamamlandı** — STK-11'in eksik
kalan *tanımlama* tarafı kapatıldı: `FiyatListesi`/kalem CRUD uçları
(`/fiyat-listeleri`), yönetim ekranı (Stok altında) ve **CARI-10** için cari
formuna fiyat listesi + varsayılan iskonto/vade seçicileri eklendi. Fatura
önerisi (FTR-14, `tavsiye-fiyat`) artık listeleri uçtan uca kullanıyor: cariye
atanan liste fiyatı, stok satış fiyatını override ediyor (doğrulandı). Ayrıca
web UI baştan aşağı açık+turuncu tasarım sistemine geçirildi ve stok/cari kayıt
formundaki iki hata (fiyat sayı→string; kod zorunlu) düzeltildi.
**Durum (Tamamlama Paketi, 2026-07-14):** **tamamlandı**: kalan tüm [Z] ve
[İ] maddeler kapatıldı — **AYR-07** kopyalama uçları (fatura, cari, stok,
belge; izinliEylemler "kopyala" diyordu ama uç yoktu), **KLN-03** firma logosu
(ekler altyapısıyla; tüm PDF'lere data URI ile gömülür), **FTR-14** fiyat
listesi/iskonto önerisi (GET /stok/:id/tavsiye-fiyat) + **kullanıcı bazlı
maksimum iskonto yetkisi** (User.maksIskontoYuzdesi; boşsa sınırsız),
**FTR-11** istisna senaryosu **satır bazında GİB istisna koduyla** (PDF ve
UBL-TR'ye yansır; tevkifat zaten mevcut), **RPR-05** kâr/zarar özeti (satış
matrahı − alış matrahı − kasa/banka tediye giderleri). v1.0 kapsamında artık
yalnız [G] maddeler kalıyor.
**Durum (UI Tamamlama, 2026-08-05):** 7 paketin tamamı bitti; ayrıntı
`docs/UI-TAMAMLAMA.md`. Paket 6b'de backend de genişledi (gelen e-Belge kutusu:
`GelenEbelge` + UBL-TR okuma + EBLG-06 kabul/ret), Paket 5'te cari adres/kişi
silme uçları eklendi. **v1.0 kapsamı böylece doldu.**

**Durum (KSB-06, 2026-08-05):** v1.0 sonrası ilk [G] maddesi kapatıldı —
**banka ekstresi içe aktarma ve eşleştirme**. Kapsam CSV (+ sütun eşleme
sihirbazı); **OFX kapsam dışı bırakıldı** (S-01: Türkiye'de bankaların çoğu
OFX vermiyor). Satırlar önce kutuya düşer, sistem cari (IBAN → VKN → ünvan) ve
açık fatura önerir, kullanıcı onayıyla tahsilat/tediye fişine dönüşür; yoksay
ve geri al var. Ayrıntı §KSB-06 notu ve `apps/api/src/kasa-banka/ekstre*.ts`.

**Durum (STK-07, 2026-08-06):** **çoklu depo** açıldı. Kiracıda her zaman bir
varsayılan depo bulunur (göçte "Merkez Depo"; yeni kayıtta otomatik açılır) ve
**tek depolu firmalarda arayüz depo seçimi göstermez** — davranış değişmez.
Miktarlar `StokDepoBakiye` (stok × depo) satırlarında tutulur; stok kartındaki
mevcut/rezerve/yoldaki alanları bunların **toplamı** olarak korunur, böylece
mevcut rapor ve göstergeler bozulmadan çalışır. S-01 kararları: **ortalama
maliyet firma genelinde tektir** (depo bazlı maliyet yok → transfer maliyeti
değiştirmez), **depo belge başlığında seçilir** (satır bazlı değil), depolar
arası taşıma **transfer fişiyle** yapılır (sevk irsaliyesi üretilmez),
**kullanıcı-depo yetkisi kapsam dışı**. Eksi stok kontrolü (STK-17) artık
hareketin yapıldığı **deponun** kullanılabilir stoğuna bakar. Ayrıntı
`apps/api/src/stok/depo.*`, `transfer.service.ts` ve §STK-07 kabul senaryosu.

**Sıradaki paket — Entegratör Paketi (S-01 kapısı kısmen alındı, 2026-07-14):**
e-belge adaptörleri bugüne dek yalnızca mock; gerçek adaptörler yazılacak.
Kararlar: **İzibiz ile başlanır** (diğerleri aynı sözleşmeyi izleyerek eklenir),
sandbox erişimi henüz yok → adaptör kamuya açık dokümana göre yazılıp birim
testler ve kaydedilmiş örnek yanıtlarla doğrulanır, canlı doğrulama sandbox
gelince yapılır. **EBLG-07 pakete dahil**, ancak İzibiz e-Arşiv dokümanı
olmadan kapsamı netleşmiyor → paket A-06 kapanana kadar başlatılmıyor.
İzibiz servis yapısı (kamuya açık kılavuz): AuthenticationWS (Login/Logout,
8 saatlik SESSION_ID), EInvoiceWS (SendInvoice, GetInvoice, GetInvoiceStatus,
CheckUser, SendInvoiceResponseWithServerSign).
Önceki kapılar: Belge Zinciri Paketi — FTR-12 tam kapsam (satış+alış), FTR-13,
FTR-09, belge PDF'leri; stok düşümü her zaman faturada, satış siparişinde
otomatik rezervasyon, alış siparişinde yoldaki stok, STK-17 kullanılabilir stok
(mevcut − rezerve) üzerinden; tamamlandı. 4. aşama — T-02 Playwright/Chromium
PDF altyapısı, FTR-07, CARI-04/RPR-04 PDF, barkod etiket basımı, ekler ortak
altyapısı (MinIO); tamamlandı.
Önceki kapılar: Stok Genişletme Paketi — STK-14…21, tamamlandı.
Cari Genişletme Paketi — CARI-11 + CARI-13…20, tamamlandı.
Rapor aşaması — RPR-06 araç seti + tüm [Z] modül raporları,
tamamlandı; RPR-07 (Metabase) ertelendi. 3. aşama — CARI-05/06/07/08/10,
STK-05/06/08/09/10/11 dahil tam kapsam.

---

## 1. Giriş

### 1.1 Amaç
Bu doküman, KOBİ'lere yönelik web tabanlı ön muhasebe uygulaması **TekirExtra**'nın
ilk sürümünün (v1.0) fonksiyonel ve fonksiyonel olmayan isterlerini tanımlar.

### 1.2 Kapsam
TekirExtra v1.0 aşağıdaki modülleri kapsar:

- Cari hesap takibi
- Fatura yönetimi (alış/satış) ve e-Fatura / e-Arşiv (GİB) entegrasyonu
- Stok takibi
- Kasa ve banka yönetimi
- Kullanıcı ve yetki yönetimi
- Raporlama

**Kapsam dışı (v1.0):** Resmi defter (genel muhasebe/yevmiye), bordro/personel,
e-İrsaliye, e-Defter, üretim/reçete takibi, mobil uygulama.

**v1.0 sonrası, mimaride hazırlanacak (bkz. §3.9):** Pazaryeri entegrasyonları
(Trendyol, Hepsiburada, N11, Amazon TR), kredi kartı ile tahsilat (sanal POS)
ve banka entegrasyonları (hareket çekme, eşleştirme, ödeme talimatı).

### 1.3 Hedef Kitle
- Birincil: 2–50 çalışanlı KOBİ'lerin ön muhasebe personeli ve işletme sahipleri
- İkincil: İşletmenin mali müşaviri (raporlara salt-okunur erişim)

### 1.4 Tanımlar
| Terim | Açıklama |
|---|---|
| Cari | Müşteri, tedarikçi veya her iki rolü taşıyan hesap |
| e-Fatura | GİB kayıtlı mükellefler arası elektronik fatura (UBL-TR) |
| e-Arşiv | e-Fatura mükellefi olmayan alıcılara kesilen elektronik fatura |
| Özel entegratör | GİB ile e-belge trafiğini sağlayan aracı servis sağlayıcı |
| KDV | Katma Değer Vergisi |

---

## 2. Genel Tanım

### 2.1 Ürün Perspektifi
TekirExtra, tarayıcı üzerinden erişilen, çok kiracılı (multi-tenant) bir
SaaS uygulamasıdır. Her firma (kiracı) sisteme bağımsız kaydolur; verileri
diğer firmalardan yalıtılmıştır. e-Belge gönderimi özel entegratörler
üzerinden yapılır ve **her firma kendi entegratörünü bağımsız seçer**:
örneğin A firması Foriba ile çalışırken B firması İzibiz kullanabilir.
Firma, entegratör erişim bilgilerini girerek bağlantıyı kendisi kurar.

### 2.2 Kullanıcı Rolleri
| Rol | Yetkiler |
|---|---|
| Yönetici | Tüm modüller + kullanıcı/yetki yönetimi + firma ayarları |
| Muhasebe | Tüm operasyonel modüller (fatura, cari, kasa/banka, stok) |
| Satış | Satış faturası ve cari görüntüleme; kasa/banka erişimi yok |
| Salt-okunur | Tüm raporları görüntüler, hiçbir kayıt oluşturamaz/değiştiremez |

---

## 3. Fonksiyonel İsterler

Öncelik: **[Z]** Zorunlu (v1.0'da olmalı) · **[İ]** İstenen (v1.0'a sığarsa) · **[G]** Gelecek sürüm

### 3.1 Cari Hesap Takibi (CARI)

| No | İster | Öncelik |
|---|---|---|
| CARI-01 | Sistem; müşteri, tedarikçi veya her ikisi tipinde cari kartı oluşturabilmelidir (unvan, VKN/TCKN, vergi dairesi, adres, iletişim, IBAN). | Z |
| CARI-02 | Cari kartında e-Fatura mükellefiyet durumu tutulmalı ve entegratör üzerinden sorgulanabilmelidir. | Z |
| CARI-03 | Her cari için borç/alacak bakiyesi anlık izlenebilmelidir. | Z |
| CARI-04 | Tarih aralığı seçilerek cari hesap ekstresi alınabilmeli, PDF/Excel dışa aktarılabilmelidir. | Z |
| CARI-05 | Carilere döviz cinsi tanımlanabilmeli (TRY, USD, EUR); bakiye hem döviz hem TRY karşılığı izlenebilmelidir. | İ |
| CARI-06 | Vadesi geçen bakiyeler için yaşlandırma raporu (0-30-60-90+ gün) alınabilmelidir. | İ |
| CARI-07 | Cari kartları Excel'den toplu içe aktarılabilmelidir. | İ |
| CARI-08 | Cari için risk limiti tanımlanabilmeli, limit aşımında fatura kesiminde uyarı verilmelidir. | İ |
| CARI-09 | Cari kartında birden çok adres (fatura/sevk) ve ilgili kişi (ad, telefon, e-posta) tutulabilmelidir. | Z |
| CARI-10 | Cari bazında özel satış koşulları tanımlanabilmelidir: özel fiyat listesi, varsayılan iskonto oranı, varsayılan vade (gün). | İ |
| CARI-11 | Cariler kategori/etiketlerle gruplanabilmeli (ör. bayi, perakende, VIP); listeler ve raporlar bu kırılımla filtrelenebilmelidir. | İ |
| CARI-12 | **Modül içi raporlar:** ekstre, yaşlandırma, cari bazlı satış/alış özeti, tahsilat performansı (ortalama tahsilat süresi), en yüksek bakiyeli cariler. Tümü RPR-06 rapor araç setini kullanır. | Z |
| CARI-13 | Kimlik genişletme: kısa ad, gerçek/tüzel kişi ayrımı, sektör, cari temsilcisi (kullanıcı); cari tipine **personel** ve **ortak** eklenir. | Z |
| CARI-14 | Resmi bilgiler: MERSİS no, ticaret sicil no, KVKK onay tarihi; VKN/TCKN format ve checksum doğrulaması yapılmalıdır. | Z |
| CARI-15 | İletişim/adres genişletme: web sitesi, faks; adres tipleri merkez/şube/depo ile genişler, posta kodu eklenir. | Z |
| CARI-16 | Cari başına birden çok banka hesabı tutulabilmelidir (banka, şube, hesap sahibi, IBAN, SWIFT, para birimi). | Z |
| CARI-17 | Kara liste / işlem blokajı: blokajlı cariye belge kesimi AYR-04 kural altyapısıyla engellenir. Kart üzerinde risk özeti gösterilir: risk limiti, mevcut risk (bakiye + çek/senet riski), kalan limit. | Z |
| CARI-18 | Kart detayında hesaplanan finansal özet sunulmalıdır: son işlem/tahsilat/ödeme tarihi, vadesi geçmiş bakiye. | Z |
| CARI-19 | ✅ CRM özellikleri: tarihçeli görüşme/telefon/e-posta/ziyaret kayıtları, kullanıcıya atanabilen görev ve hatırlatmalar, görev durum takibi, cari teklif geçmişi. | G |
| CARI-20 | ✅ Açıklanabilir karar desteği: FIFO tahsilat geçmişinden gecikme tahmini, bileşenli risk skoru, ödeme davranışı/güven analizi ve son 6 aylık hacme dayalı otomatik limit önerisi. | G |

### 3.2 Fatura Yönetimi (FTR)

| No | İster | Öncelik |
|---|---|---|
| FTR-01 | Satış faturası oluşturulabilmelidir: cari seçimi, kalem satırları (stok/hizmet), miktar, birim fiyat, iskonto (satır ve genel), KDV oranı (%0, %1, %10, %20). | Z |
| FTR-02 | Alış faturası girilebilmeli; girişte ilgili stok miktarları otomatik artmalıdır. | Z |
| FTR-03 | Satış faturası kesildiğinde stok miktarları otomatik azalmalı, cari bakiye borçlandırılmalıdır. | Z |
| FTR-04 | Fatura satırlarında KDV, iskonto ve genel toplam otomatik hesaplanmalı; kuruş yuvarlaması mevzuata uygun yapılmalıdır. | Z |
| FTR-05 | Fatura taslak olarak kaydedilebilmeli, kesinleştirilmeden düzenlenebilmelidir. Kesinleşen fatura değiştirilemez; iptal/iade süreci işletilir. | Z |
| FTR-06 | Faturalar numaralandırma serisiyle (ör. TKR2026...) otomatik ve kesintisiz numaralanmalıdır. | Z |
| FTR-07 | Fatura PDF çıktısı üretilebilmeli, e-posta ile gönderilebilmelidir. | Z |
| FTR-08 | İade faturası (alış/satış) düzenlenebilmeli, stok ve cari hareketleri ters yönde işlenmelidir. | Z |
| FTR-09 | Proforma fatura oluşturulabilmeli ve tek tıkla satış faturasına dönüştürülebilmelidir. | İ |
| FTR-10 | ✅ Tekrarlayan (abonelik tipi) faturalar tanımlanabilmelidir. | G |
| FTR-11 | Tevkifatlı ve istisnalı fatura senaryoları desteklenmelidir. | İ |
| FTR-12 | Belge zinciri desteklenmelidir: teklif → sipariş → irsaliye → fatura; her adım bir sonrakine tek tıkla dönüştürülebilmeli, zincir izlenebilmelidir (e-İrsaliye kapsam dışı; kağıt/PDF irsaliye). Not (2026-07-13): sipariş aşamasında stok rezervasyonu ile rezerve/yoldaki stok göstergeleri bu kapsamda ele alınır. | İ |
| FTR-13 | Bekleyen siparişler/irsaliyeler toplu seçilip tek faturada birleştirilebilmelidir (toplu faturalama). | İ |
| FTR-14 | Fatura kaleminde carinin fiyat listesi ve özel iskontosu otomatik önerilmeli (CARI-10, STK-11); satıcı kullanıcı bazında maksimum iskonto yetkisi tanımlanabilmelidir. | İ |
| FTR-15 | **Modül içi raporlar:** dönemsel satış/alış özeti, kâr marjı analizi (satış - ağırlıklı ortalama maliyet), iskonto analizi, KDV dökümü, iade oranları, taslakta bekleyen belgeler. Tümü RPR-06 rapor araç setini kullanır. | Z |

### 3.3 e-Fatura / e-Arşiv Entegrasyonu (EBLG)

| No | İster | Öncelik |
|---|---|---|
| EBLG-01 | Entegratör katmanı adaptör mimarisiyle soyutlanmalıdır: her firma, desteklenen entegratörlerden (Foriba, İzibiz, eLogo, Uyumsoft vb.) dilediğini bağımsız seçebilmelidir. Yeni bir entegratör, çekirdek kod değişmeden adaptör eklenerek desteklenebilmelidir. | Z |
| EBLG-01a | Firma yöneticisi, entegratör erişim bilgilerini (kullanıcı adı, parola/API anahtarı, servis adresi) arayüzden girebilmeli ve "bağlantı testi" ile doğrulayabilmelidir. | Z |
| EBLG-01b | Entegratör erişim bilgileri veritabanında şifrelenerek (at-rest encryption) saklanmalı, arayüzde ve loglarda asla açık gösterilmemelidir. | Z |
| EBLG-02 | Fatura kesinleştirilirken alıcının e-Fatura mükellefiyeti otomatik sorgulanmalı; mükellefse e-Fatura, değilse e-Arşiv olarak gönderilmelidir. | Z |
| EBLG-03 | Giden e-belgeler UBL-TR 1.2 standardına uygun üretilmelidir. | Z |
| EBLG-04 | Gönderilen belgelerin durumu (kuyrukta, iletildi, kabul, ret, hata) izlenmeli ve arayüzde gösterilmelidir. | Z |
| EBLG-05 | Gelen e-Faturalar entegratörden çekilebilmeli; kullanıcı onayıyla alış faturası olarak sisteme işlenebilmelidir. | Z |
| EBLG-06 | Ticari e-Faturalarda kabul/ret yanıtı gönderilebilmelidir. | Z |
| EBLG-07 | e-Arşiv faturaları için GİB'e günlük raporlama entegratör üzerinden otomatik yürütülmelidir. | Z |
| EBLG-08 | Gönderim hatalarında belge "hata" durumuna düşmeli, kullanıcı düzeltip yeniden gönderebilmelidir; otomatik yeniden deneme uygulanmalıdır. | Z |
| EBLG-09 | e-belge XML ve PDF görüntüleri arşivlenmeli, mevzuat gereği en az 10 yıl saklanabilir yapıda tutulmalıdır. | Z |

### 3.4 Stok Takibi (STK)

| No | İster | Öncelik |
|---|---|---|
| STK-01 | Ürün/hizmet kartı oluşturulabilmelidir: kod, ad, birim, barkod, KDV oranı, alış/satış fiyatı, kategori. | Z |
| STK-02 | Stok hareketleri (alış, satış, iade, sayım düzeltme) kalem bazında izlenebilmelidir. | Z |
| STK-03 | Anlık stok miktarı ve stok değeri raporlanabilmelidir. | Z |
| STK-04 | Kritik stok seviyesi tanımlanabilmeli, altına düşünce panelde uyarı gösterilmelidir. | Z |
| STK-05 | Ürünler Excel'den toplu içe aktarılabilmelidir. | İ |
| STK-06 | Stok sayımı (fiili envanter) girilebilmeli, farklar düzeltme hareketi olarak işlenmelidir. | İ |
| STK-07 | ✅ Çoklu depo desteği sağlanmalıdır. **(2026-08-06'da yapıldı — §STK-07 notu)** | G |
| STK-08 | Maliyetlendirme ilk sürümde ağırlıklı ortalama yöntemiyle yapılmalıdır. | İ |
| STK-09 | Ürünler hiyerarşik kategori ağacıyla sınıflandırılabilmeli; ürün görseli eklenebilmelidir. | İ |
| STK-10 | Çoklu birim desteği: ürün için ana birim + çevrim katsayılı ek birimler (ör. adet/koli/palet); alış-satış farklı birimle yapılabilmelidir. | İ |
| STK-11 | Çoklu fiyat listesi tanımlanabilmelidir (ör. perakende, bayi, ihracat); fatura kesilirken carinin fiyat listesi otomatik uygulanmalıdır (CARI-10 ile birlikte). | İ |
| STK-12 | ✅ Ürün varyantları (renk/beden gibi nitelik kombinasyonları) tanımlanabilmeli, stok varyant bazında izlenebilmelidir. **(2026-08-10'da yapıldı — varyant kodu/barkodu/fiyatı, depo bakiyesi, hareket, sipariş rezervi ve fatura zinciri)** | G |
| STK-13 | **Modül içi raporlar:** envanter değeri, stok hareket özeti, en çok/en az satanlar, stok devir hızı, ürün bazlı kârlılık (ağırlıklı ortalama maliyete göre), kritik stok listesi; ayrıca sipariş önerisi (STK-16), fire/zayi, hareketsiz stok ve eksi stok raporları. Tümü RPR-06 rapor araç setini kullanır. | Z |
| STK-14 | Kart genişletme: kısa ad, açıklama, marka, model, menşei, GTİP kodu, üretici ürün kodu; stok tipine **sarf** eklenir. | Z |
| STK-15 | Ürün başına birden çok barkod tutulabilmelidir; barkod bir birime ve birime özgü satış fiyatına bağlanabilmeli, barkodla ürün bulunabilmelidir. | Z |
| STK-16 | Minimum/maksimum stok, güvenlik stoğu ve tedarik süresi tanımlanabilmeli; yeniden sipariş noktası (ort. günlük satış × tedarik süresi + güvenlik stoğu) ile otomatik sipariş önerisi raporu sunulmalıdır. | Z |
| STK-17 | Eksi stok politikası modül ayarı olarak yönetilmelidir (izin ver / uyar / engelle) ve satış kesinleştirmede uygulanmalıdır. | Z |
| STK-18 | Ürün-tedarikçi ilişkisi: tedarikçi carisi, tedarikçi ürün kodu, alış fiyatı, tedarik süresi, varsayılan tedarikçi; sipariş önerisinde kullanılır. | Z |
| STK-19 | Stok hareket türleri genişletilmelidir: fire, zayi, numune, promosyon, açılış fişi; fire/zayi raporlanabilmelidir. | Z |
| STK-20 | Sayım farkları doğrudan stoğa işlenmemeli; taslak → onay → düzeltme hareketi akışıyla, onay yetkisine bağlı işlenmelidir. | Z |
| STK-21 | ✅ Seri numarası ve lot/parti + son kullanma tarihi takibi (FEFO çıkış desteğiyle). **(2026-08-10'da yapıldı — varyant/depo bazlı parti, tekil seri, hareket izi, transfer ve fatura/belge zinciri)** | G |

### 3.5 Kasa ve Banka (KSB)

| No | İster | Öncelik |
|---|---|---|
| KSB-01 | Birden fazla kasa ve banka hesabı tanımlanabilmelidir (TRY ve döviz). | Z |
| KSB-02 | Tahsilat ve ödeme (tediye) fişleri kesilebilmeli, ilgili cari bakiyesine yansımalıdır. | Z |
| KSB-03 | Kasalar/hesaplar arası virman yapılabilmelidir. | Z |
| KSB-04 | Kasa ve banka hesap hareketleri tarih aralığıyla listelenebilmeli, anlık bakiye görülebilmelidir. | Z |
| KSB-05 | Çek ve senet takibi yapılabilmelidir. **Alınan** (müşteri çeki, varlık): portföy → tahsil / ciro / karşılıksız / iade; tahsilde tutar seçilen kasa/banka hesabına **tahsilat** fişi olarak girer. **Verilen** (kendi kestiğimiz çek, borç): verildi → ödendi / karşılıksız / geri alındı; lehtar cari zorunludur, verilişte lehtara borç yazılır, ödemede tutar seçilen hesaptan **tediye** fişi olarak çıkar. Yalnız alınan çekler cari riskine sayılır. | İ |
| KSB-06 | Banka ekstresi (CSV/OFX) içe aktarılıp hareketlerle eşleştirilebilmelidir (otomatik banka bağlantısı için bkz. ENT-06). | G — ✅ 2026-08-05 (CSV; OFX kapsam dışı) |
| KSB-07 | Fatura üzerinden doğrudan tahsilat/ödeme kaydı oluşturulabilmelidir (kapama). | Z |

> **KSB-06 uygulama notu (2026-08-05).** Ekran: `/panel/kasa-banka/ekstre`.
> Akış gelen e-Belge kutusuyla aynı: satırlar önce **muhasebeye dokunmadan**
> `BankaEkstreSatir` kutusuna düşer, onayla `KasaBankaHareket` üretilir.
> - **Yalnız CSV.** Sütun düzeni bankadan bankaya değiştiği için kullanıcı ilk
>   yüklemede sütunları eşler; eşleme `BankaHesap.ekstreEslemesi`'ne kaydedilir
>   ve sonraki yüklemelerde sorulmaz. Başlıklardan otomatik tahmin yapılır.
> - Tutar **işaretli** saklanır (artı = giriş → tahsilat, eksi = çıkış →
>   tediye); banka ayrı borç/alacak sütunu veriyorsa ikisinden yön kurulur.
> - Mükerrer koruması: `[tenantId, bankaHesapId, satirOzeti]` teklik. Özet
>   tarih+tutar+açıklama+dekont özetine **tekrar sayacı** ekler, böylece aynı
>   gün aynı tutarlı *gerçek* tekrarlar (iki kez EFT masrafı) ezilmez ama aynı
>   dosyanın ikinci yüklemesi yeni satır üretmez.
> - Cari önerisi sırası: karşı IBAN → açıklamadaki VKN/TCKN → ünvanın açıklamada
>   geçmesi. Karşılaştırma ASCII'ye indirgenir (bankalar aksansız yazıyor).
> - Cari bulunduysa **açık faturaları** (kesin, ödemesi eksik) önerilir; tutarı
>   birebir tutan başa alınır. Fatura seçilmesi zorunlu değil — bağlanmazsa
>   tutar yalnız cari bakiyesine işler.
> - **Yoksay** (banka masrafı/faiz gibi cariyle ilgisiz satırlar) ve **geri al**
>   (fişi *ve* onun cari hareketini siler) vardır.
> - Kapsam dışı: **OFX** (Türkiye'de bankaların çoğu vermiyor) ve otomatik banka
>   bağlantısı — o ENT-06.

### 3.6 Raporlama (RPR)

| No | İster | Öncelik |
|---|---|---|
| RPR-01 | Ana panelde özet göstergeler sunulmalıdır: aylık satış/alış, tahsilat/ödeme, vadesi gelen alacak/borç, kritik stok. | Z |
| RPR-02 | KDV özet raporu (hesaplanan/indirilecek) dönem bazında alınabilmelidir. | Z |
| RPR-03 | Satış raporları: cari, ürün, dönem kırılımında. | Z |
| RPR-04 | Tüm raporlar PDF ve Excel olarak dışa aktarılabilmelidir. | Z |
| RPR-05 | Kâr/zarar özeti (basit gelir-gider farkı) raporlanabilmelidir. | İ |
| RPR-06 | **Ortak rapor araç seti:** Her modülün kendi "Raporlar" sekmesi olmalıdır (CARI-12, STK-13, FTR-15). Tüm raporlar ortak yetenek setini sunar: tarih aralığı + modüle özgü filtreler, gruplama/kırılım, sıralama, PDF/Excel dışa aktarım (RPR-04), kayıtlı rapor görünümleri (filtre setini adlandırıp saklama). | Z |
| RPR-07 | **Gömülü analitik (Metabase):** Sistem, Metabase ile gömülü analiz panoları sunmalıdır. Hazır panolar (satış trendi, nakit akış, cari risk, stok analizi) uygulama içinde gösterilir; kiracı yalıtımı imzalı gömme parametresiyle (kilitli tenant_id) garanti edilir. Operasyonel/mali belgeler (ekstre, KDV özeti gibi) Metabase'e değil, yerli rapor araç setine (RPR-06) aittir. | İ |

### 3.7 Kullanıcı ve Firma Yönetimi (KLN)

| No | İster | Öncelik |
|---|---|---|
| KLN-01 | E-posta + parola ile oturum açılmalı; parola politikası uygulanmalıdır (asgari uzunluk, karmaşıklık). | Z |
| KLN-02 | Bölüm 2.2'deki roller atanabilmeli; yetkisiz modüller arayüzde ve API'de erişime kapalı olmalıdır. | Z |
| KLN-03 | Firma bilgileri (unvan, VKN, vergi dairesi, logo, e-imza/mali mühür entegratör bilgileri) yönetilebilmelidir. | Z |
| KLN-04 | Tüm kritik işlemler (fatura kesme/iptal, kayıt silme, yetki değişikliği) denetim izine (audit log) yazılmalıdır: kim, ne zaman, ne yaptı. | Z |
| KLN-04a | Denetim izi yönetici rolüne görüntülenebilmelidir: tarih aralığı, kullanıcı ve varlık türüne göre filtrelenebilen, sayfalanan bir liste (API + Ayarlar ekranı). Kayıtlar salt-okunurdur; hiçbir rol silemez/değiştiremez. | Z |
| KLN-05 | İki adımlı doğrulama (TOTP) desteklenmelidir. | Z |
| KLN-09 | Firma kaydında e-posta doğrulaması yapılmalıdır: kayıtta doğrulama linki gönderilir, link tıklanmadan oturum açılamaz. | Z |
| KLN-06 | Sistem çok kiracılı (multi-tenant) çalışmalıdır: her firma bağımsız kaydolur, firmalar arası veri yalıtımı hem uygulama hem veri katmanında garanti edilmelidir. | Z |
| KLN-07 | Firma kaydı (onboarding) self-servis olmalıdır: firma bilgileri, ilk yönetici kullanıcı ve entegratör bağlantısı sihirbazla kurulabilmelidir. | Z |
| KLN-08 | ✅ Firma hesabı modeli plan, durum, faturalama iletişimi, sağlayıcı referansı ve dönem bilgilerini ayrı abonelik profiliyle taşıyabilir; v1.0'da fiyatlandırma uygulanmaz. | G |

### 3.8 Ayarlar ve Kayıt İşlem Kuralları (AYR)

| No | İster | Öncelik |
|---|---|---|
| AYR-01 | Her modülün **kendi ayarlar sayfası** olmalıdır; modüle özgü tüm parametreler orada yönetilir. Örnekler — Fatura: seri tanımları, varsayılan KDV oranı, fatura şablonu; Cari: varsayılan vade, döviz; Stok: varsayılan birim, kritik seviye politikası; Kasa/Banka: varsayılan kasa, fiş numaralandırma. | Z |
| AYR-02 | **Sistem ayarları** altında yalnızca modüller-üstü (global) ayarlar bulunmalıdır: firma bilgileri, kullanıcı/rol yönetimi, entegrasyon bağlantıları, güvenlik politikaları, mevzuat parametreleri (KDV oranları — V-02). Modüle özgü hiçbir ayar sistem ayarlarına konmaz. | Z |
| AYR-03 | Yeni bir modül ayarı, ortak ayar altyapısı üzerinden tanımlanabilmelidir (şema + doğrulama + arayüz); her modül için sıfırdan ayar sayfası kodlanmaz. | Z |
| AYR-04 | Her işlem sayfasında (fatura, cari, stok, fiş vb.) kayıt üzerinde **silme, değiştirme, kopyalama, iptal** gibi eylemler ortak bir **kural altyapısına** bağlı olmalıdır: eylemin görünürlüğü/izni; kaydın durumu (ör. taslak/kesin), kullanıcının rolü ve bağlı kayıtları (ör. hareketi olan cari) birlikte değerlendirilerek belirlenir. | Z |
| AYR-05 | Kural örnekleri (varsayılan set): kesinleşmiş fatura değiştirilemez/silinemez ama **kopyalanabilir** ve iptal edilebilir; hareketi olan cari/stok kartı silinemez (pasife alınır); taslak kayıtlar serbestçe düzenlenir/silinir. | Z |
| AYR-06 | İzin verilen eylemler API yanıtında kayıtla birlikte dönmelidir; arayüz düğmeleri buna göre çizer, asıl denetim sunucudadır. | Z |
| AYR-07 | Kopyalama eylemi: mevcut kayıttan yeni taslak üretir (ör. faturayı kopyala → yeni taslak fatura, yeni tarih/numara ile). | Z |

### 3.9 Entegrasyon Aileleri — Pazaryeri, Sanal POS, Banka (ENT)

Bu bölümdeki isterler **v1.0'da uygulanmaz**; ancak veri modeli ve adaptör
mimarisi bu ailelere baştan hazır tasarlanır (bkz. MIMARI.md). Tümü **[G]**
önceliklidir; ENT-01 hariç.

| No | İster | Öncelik |
|---|---|---|
| ENT-01 | Tüm dış bağlantılar (e-belge, pazaryeri, POS, banka) **ortak bağlantı modeli** üzerinden yönetilmelidir: firma, sağlayıcıyı seçer, erişim bilgilerini girer, bağlantıyı test eder (EBLG-01a/01b desenine uygun). Mimari v1.0'da bu genel modeli kurar. | Z |
| ENT-02 | ✅ Pazaryeri entegrasyonu: Trendyol, Hepsiburada, N11 ve Amazon TR'den siparişler çekilebilmeli, tek tıkla/toplu faturalaştırılabilmelidir. **Sipariş kutusu, idempotent içe aktarım, ürün eşleme, şifreli bağlantı, ekrandan senkronizasyon ve toplu fatura taslakları; dört sağlayıcının canlı adaptörleri tamamlandı.** | G |
| ENT-03 | ✅ Pazaryeri stok/fiyat senkronizasyonu: TekirExtra'daki kullanılabilir stok miktarı ve satış fiyatı, bağlı Trendyol, Hepsiburada, N11 ve Amazon TR mağazalarına gönderilebilmektedir. **Varyant önceliği, rezerv düşümü, sağlayıcı limitlerine göre toplu gönderim, asenkron işlem kimlikleri ve panel işlemi tamamlandı.** | G |
| ENT-04 | Sanal POS ile kredi kartı tahsilatı yapılabilmelidir: hem ödeme kuruluşları (iyzico, PayTR vb.) hem doğrudan banka sanal POS'ları adaptör olarak desteklenebilmelidir. **iyzico Checkout Form ve PayTR Link API adaptörleri tamamlandı. POS tahsilatı önce sağlayıcı bazında açılan POS hesabına işlenir ve cari bakiyeyi kapatır. Sağlayıcı ödemesi banka ekstresinden seçilerek POS hesabıyla mutabık hale getirilebilir; brüt tahsilat, komisyon/kesinti ve net banka ödemesi ayrı ve tekrarsız izlenir, geri alma üç hareketi birlikte kaldırır. PayTR callback imzası doğrulanır ve tekrarlanan bildirimler idempotent işlenir.** Kart verisi TekirExtra'da tutulmaz. | G |
| ENT-05 | Cariye e-posta/SMS ile **ödeme linki** gönderilebilmeli; link üzerinden yapılan kart tahsilatı ilgili faturayı/bakiyeyi kapatmalıdır. **iyzico Checkout Form başlatma, IYZWSv2 imza, callback sonrası sağlayıcıdan ikinci kez sonuç doğrulama, idempotent POS/cari/fatura tahsilat kaydı ve cari e-postasına veya telefonuna otomatik/yeniden bağlantı gönderimi tamamlandı. SMS kanalı Netgsm REST API ve onaylı gönderici başlığıyla çalışır.** | G |
| ENT-06 | Banka entegrasyonu: hesap hareketleri otomatik çekilmeli, gelen/giden tutarlar cari ve faturalarla eşleştirilebilmelidir (önerili otomatik eşleştirme + kullanıcı onayı). **Vomsis App Key/Secret kimlik doğrulaması, hesap eşlemesi, `lastId` ile artımlı hareket çekimi ve mevcut cari/fatura öneri-onay kutusuna idempotent aktarım tamamlandı. Yetkili banka/fintek sağlayıcıları ayrıca Bearer anahtarlı webhook ile hareket aktarabilir.** | G |
| ENT-07 | Banka entegrasyonu üzerinden ödeme talimatı (EFT/havale) oluşturulabilmelidir; talimat gönderimi çift onay (oluşturan ≠ onaylayan) ve zorunlu TOTP ile korunmalıdır. **Talimat kaydı, oluşturan ≠ onaylayan atomik denetimi, onaylayanda zorunlu yeniden TOTP doğrulaması, iptal ve yönetim ekranı tamamlandı. Vomsis'in kamuya açık portalında para transferi gönderim endpoint'i yayımlanmadığından onaylanan kayıt sağlayıcıya gönderilmez ve muhasebe hareketi üretmez; gönderim adaptörü sözleşmeli dokümanı bekler.** | G |
| ENT-08 | Pazaryeri komisyon/kesinti kayıtları gider olarak işlenebilmelidir. **İdempotent kesinti kaydı, kasa/banka tediye giderine güvenli dönüştürme, yönetim ekranı ve Amazon Finances v2024-06-19 canlı çekimi tamamlandı. Trendyol, Hepsiburada ve N11 için kamuya açık resmî finans API dokümanı bekleniyor.** | G |

---

## 4. Fonksiyonel Olmayan İsterler

### 4.1 Performans
- **NFR-01:** Sayfa yüklenme süresi normal yükte 2 saniyeyi aşmamalıdır.
- **NFR-02:** Sistem 50 eşzamanlı kullanıcıyı performans kaybı olmadan desteklemelidir.
- **NFR-03:** 100.000 fatura ve 500.000 stok hareketi içeren veri setinde listeleme/raporlama 5 saniye altında tamamlanmalıdır.

### 4.2 Güvenlik
- **NFR-04:** Tüm trafik TLS ile şifrelenmelidir; parolalar geri döndürülemez algoritmayla (bcrypt/argon2) saklanmalıdır.
- **NFR-05:** KVKK yükümlülükleri karşılanmalıdır: kişisel verilerin envanteri, silme/anonimleştirme yeteneği.
- **NFR-06:** Oturumlar makul sürede zaman aşımına uğramalı; API erişimi token tabanlı ve yetki denetimli olmalıdır.
- **NFR-07:** OWASP Top 10 açıklarına karşı önlem alınmalıdır (girdi doğrulama, CSRF, XSS, SQL enjeksiyonu).

### 4.3 Veri Bütünlüğü ve Yedekleme
- **NFR-08:** Mali kayıtlar (kesinleşmiş fatura, kasa/banka fişi) hiçbir koşulda fiziksel silinmemeli; iptal/ters kayıt ile yönetilmelidir.
- **NFR-09:** Veritabanı günlük otomatik yedeklenmeli, yedekten dönüş prosedürü belgelenmelidir.
- **NFR-10:** Parasal tutarlar kayan nokta yerine tam sayı/decimal tipte saklanmalıdır.

### 4.4 Kullanılabilirlik
- **NFR-11:** Arayüz Türkçe olmalıdır; metinler i18n altyapısıyla yönetilmeli, ileride ek dil eklenebilmelidir.
- **NFR-12:** Uygulama güncel Chrome, Firefox, Edge ve Safari sürümlerinde çalışmalıdır; temel akışlar tablet ekranında kullanılabilir olmalıdır.
- **NFR-13:** Fatura kesme akışı, deneyimli kullanıcı için klavye ile 1 dakikanın altında tamamlanabilmelidir.

### 4.5 İşletim
- **NFR-14:** Uygulama konteyner (Docker) olarak paketlenebilmeli, tek komutla ayağa kaldırılabilmelidir.
- **NFR-15:** Hedef çalışma süresi %99,5; planlı bakım pencereleri kullanıcılara önceden duyurulmalıdır.
- **NFR-16:** Uygulama ve e-belge trafiği için yapılandırılmış log tutulmalıdır.

---

## 5. Kısıtlar ve Varsayımlar

- **S-01 (Süreç kuralı):** Her modülün geliştirilmesine **başlanmadan önce**, o modülün ister bölümü ürün sahibiyle birlikte gözden geçirilir ve son hali onaylanır. Değişen kararlar bu kapıda dokümana işlenir; onaysız modül geliştirmesine başlanmaz.
- **K-01:** e-Belge gönderimi yalnızca özel entegratörler üzerinden yapılır; doğrudan GİB portal entegrasyonu kapsam dışıdır. Entegratör sözleşmesi firma ile entegratör arasındadır; TekirExtra yalnızca teknik bağlantıyı sağlar.
- **K-02:** Mevzuat referansı Türkiye'dir: VUK, KDV mevzuatı, e-Fatura/e-Arşiv tebliğleri (UBL-TR 1.2).
- **K-03:** Sistem çok kiracılıdır; firma başına tek şube ve tek depo varsayımıyla başlanır, mimari çoklu şube/depoya engel olmamalıdır. *(Çoklu depo STK-07 ile 2026-08-06'da açıldı; çoklu şube hâlâ kapsam dışı.)*
- **V-01:** Firmanın e-Fatura mükellefiyet başvurusu ve entegratör sözleşmesi uygulama dışında tamamlanmış kabul edilir; firma yalnızca erişim bilgilerini girer.
- **V-02:** KDV oranları ve mevzuat parametreleri değişebilir; sistemde sabit kodlanmayıp yönetilebilir parametre olarak tutulmalıdır.

---

## 6. Kabul Ölçütleri (Özet)

v1.0 aşağıdaki uçtan uca senaryolar hatasız çalıştığında kabul edilir:

1. Cari kartı aç → stoklu satış faturası kes → e-Fatura/e-Arşiv otomatik yönlendirilsin ve entegratörden "iletildi" durumu görülsün → stok düşsün → cari borçlansın → tahsilat gir → bakiye kapansın.
2. Gelen e-Fatura entegratörden çekilsin → alış faturası olarak işlensin → stok artsın → ödeme girilsin.
3. İade faturası ile stok ve cari hareketler ters yönde doğru işlensin.
4. Dönem sonunda KDV özeti, cari ekstre ve stok raporu PDF/Excel alınabilsin.
5. Satış rolündeki kullanıcı kasa/banka modülüne erişememeli; tüm kritik işlemler denetim izinde görünmelidir.
6. İki ayrı firma sisteme kaydolsun, farklı entegratörler bağlasın (ör. A firması Foriba, B firması İzibiz); her ikisi de kendi entegratörü üzerinden e-belge gönderebilsin ve hiçbir koşulda birbirinin verisini görememelidir.

---

## 7. Açık Konular

| No | Konu | Durum |
|---|---|---|
| A-01 | v1.0 entegratör adaptörleri | **Karar verildi:** İzibiz, Foriba (SAP), eLogo, Uyumsoft — dördü de v1.0'da (2026-07-12) |
| A-02 | Teknoloji yığını seçimi | **Karar verildi:** TypeScript + NestJS / React + Next.js / PostgreSQL (bkz. Bölüm 8) (2026-07-12) |
| A-03 | Dağıtım modeli | **Karar verildi:** SaaS, çok kiracılı; her firma entegratörünü bağımsız seçer (2026-07-12) |
| A-04 | Fiyatlandırma/lisanslama modeli | **Ertelendi:** Pazara çıkmadan önce karar verilecek. Mimari, abonelik/faturalandırma altyapısı eklenmesine engel olmamalıdır (bkz. KLN-08). (2026-07-12) |
| A-05 | Gömülü analitik aracı | **Karar verildi:** Metabase (AGPL, ayrı servis olarak). Ücretsiz OSS sürümle başlanır; gelişmiş white-label/interaktif gömme gerekirse Pro lisansı değerlendirilir (bkz. MIMARI §10). (2026-07-12) |
| A-06 | İzibiz e-Arşiv servis dokümanı | **Beklemede (2026-07-14):** İzibiz'in kamuya açık kılavuzu yalnızca AuthenticationWS ve EInvoiceWS metotlarını belgeliyor; EIArchiveWS metot adları/parametreleri ve **e-Arşiv günlük GİB raporlaması (EBLG-07)** belgesiz. Ürün sahibi dokümanı entegratörden temin edecek; **Entegratör Paketi bu doküman gelene kadar başlatılmayacak.** |

---

## 8. Teknoloji Yığını (A-02 Kararı)

| Katman | Teknoloji | Gerekçe (özet) |
|---|---|---|
| Backend | TypeScript + NestJS | Frontend ile tek dil; modül + DI yapısı entegratör adaptör desenine (EBLG-01) birebir uyum |
| Frontend | React + Next.js | Tablo/form ağırlıklı muhasebe arayüzü için en olgun bileşen ekosistemi |
| Veritabanı | PostgreSQL | `NUMERIC` para tipleri (NFR-10); Row-Level Security ile kiracı yalıtımı veritabanı seviyesinde (KLN-06) |
| ORM | Prisma veya TypeORM | Şema geçişleri ve tip güvenliği; kesin seçim mimari tasarımda yapılacak |
| Kuyruk | Redis + BullMQ | Asenkron e-belge gönderimi, durum takibi ve otomatik yeniden deneme (EBLG-04, EBLG-08) |
| Paketleme | Docker / Docker Compose | NFR-14 gereği tek komutla ayağa kalkma |

Karar tarihi: 2026-07-12. Alternatif olarak değerlendirilen .NET 8, tek-dil
avantajının kaybı nedeniyle ikinci sırada bırakılmıştır.
