# TekirExtra — Yazılım İster Dokümanı (SRS)

**Sürüm:** 0.20
**Tarih:** 2026-09-06
**Durum (2026-09-06):** **Bildirim ve Görev Merkezi (§3.10) tamamlandı** —
BLD-01…BLD-10'un tamamı kapatıldı; ayrıntı o bölümdedir.
**Durum (2026-09-05):** Uygulama/modül inceleme raporunun (2026-09-02) P0
bulguları kapatıldı (B2B bayi yalıtımı ve fiyatlandırma, mali müşavir XML/CSV
üretimi, AI/OCR'ın simülasyon olduğunun arayüzde ayrılması, CI'nin e2e adımı) ve
şirket geneli **mali dönem kapatma** ile **aksansız arama** eklendi.
**Durum (2026-08-17):** UI tamamlama paketleri tamamlandı; üretim hazırlığı
devam ediyor. Kalıcı worker/kuyruk, gerçek sağlayıcı doğrulaması, readiness,
CI kabul testleri ve operasyonel gözlemlenebilirlik release kapılarıdır.
Önceki UI durumu: **UI Tamamlama** sürüyor (plan: `docs/UI-TAMAMLAMA.md`);
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

**Durum (KLN-08, 2026-08-14):** **abonelik ve paket yönetimi tamamlandı.**
Başlangıç, Profesyonel ve Kurumsal plan kataloğu; kullanıcı/cari/stok/aylık
fatura kullanım sayaçları ve kayıt anında limit denetimi; limit aşımını
engelleyen plan değişimi; faturalama iletişimi; dönem sonunda iptal/yeniden
etkinleştirme ve salt-okur değişiklik geçmişi eklendi. Ödeme sağlayıcısı henüz
bağlı değildir; sağlayıcı referansı mevcut abonelik modelinde hazırdır.
**Düzeltme (2026-09-16):** abonelik kaydı yalnız web kayıt akışında açıldığı
için betikle ya da elle oluşturulan kiracıda kayıt bulunmuyor, cari/stok/fatura
oluşturma "abonelik aktif değil" diye kilitleniyordu. Kaydın yokluğu artık
askıya alma sayılmaz: ilk erişimde varsayılan planla (`v1` → Profesyonel) aktif
bir abonelik açılır. Gerçek askıya alma `durum` alanıyla yapılır ve engellemeyi
sürdürür.

**Durum (e-İrsaliye, 2026-08-14):** Onaylı satış irsaliyeleri Sovos DESPATCH
servisine gönderilebilir, durumları sorgulanabilir; gelen e-İrsaliyeler kutuya
alınıp kabul/ret yanıtı gönderilebilir. Bu akışta stok ve cari hareketi
oluşturulmaz; stok faturada işlenir. Gelen e-İrsaliyenin mal kabul/stok
akışına dönüştürülmesi kapsam dışıdır.

**Entegratör Paketi (S-01 kapısı kısmen alındı, 2026-07-14; e-Fatura/e-Arşiv ve
e-İrsaliye dilimleri uygulanıyor):**
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
| CARI-21 | ✅ Gerçek kişi carilerde **ad ve soyad** ayrı alanlarda tutulmalı ve zorunlu olmalıdır; unvan bunlardan türer. e-Arşiv UBL'inde (`FirstName`/`FamilyName`) ve POS ödemesinde bu alanlar kullanılır; boşsa (eski kayıt) unvandan tahmin edilir ve e-Belge sihirbazı tahmini gösterir. **(2026-09-11'de yapıldı — docs/e-belge/NES-ENTEGRASYON-PLANI.md)** | G |
| CARI-20 | ✅ Açıklanabilir karar desteği: FIFO tahsilat geçmişinden gecikme tahmini, bileşenli risk skoru, ödeme davranışı/güven analizi ve son 6 aylık hacme dayalı otomatik limit önerisi. | G |
| CARI-22 | **İptal edilen faturanın hareketleri ekstrede varsayılan olarak gizlenir** (karar 2026-09-15). İptal edilmiş faturanın cari hareketi ile iptalin ters hareketi birbirini sıfırlar; ekstrede yan yana durmaları kafa karıştırıyordu. (1) Ekstre (ekran, PDF, Excel, e-posta) bu çifti göstermez; **"İptalleri de göster"** işaretlenince görünür, e-posta ve dışa aktarma seçime uyar. (2) Gizlenen çift **devir bakiyesinden de düşülür**: tarih aralığı iptali ikiye böldüğünde (fatura aralıktan önce, iptal aralıkta) devir ile dönem sonu tutarlı kalır; çift sıfırlandığı için dönem sonu bakiyesi seçimden etkilenmez. (3) İptaller gösterildiğinde bu satırlar soluk ve **"İptal" rozetiyle**, PDF/Excel'de açıklamaya "(iptal)" eklenerek ayırt edilir. Çift, `kaynakRef`'i iptal durumundaki faturayı gösteren `fatura`/`fatura_iptal`/`fatura_iptal_duzeltme` hareketleridir. Stok tarafı STK-22. | G |

### 3.2 Fatura Yönetimi (FTR)

**Durum (Fatura Senaryoları, 2026-09-06):** FTR-16…FTR-21 tamamlandı. Paket,
FTR-11'in e-belge tarafındaki açığını kapatıyordu: `InvoiceTypeCode` fatura
tipinin büyük harfi olarak yazılıyor (GİB'de karşılığı olmayan `SATIS_IADE`,
`ALIS`, `PROFORMA` değerleri üretiyor), istisnalı fatura `SATIS` olarak
gidiyor, tevkifat UBL'e hiç yansımıyor ve `ProfileID` sabit `TEMELFATURA`
oluyordu — sonuncusu yüzünden alıcı kabul/ret veremediği için EBLG-13 yanıt
takibi pratikte hiç tetiklenmiyordu.

Şimdi senaryo satırlardan türetilip `faturalar.senaryo` alanında saklanıyor ve
UBL'e `InvoiceTypeCode` olarak yazılıyor; tevkifat satırda GİB koduyla giriliyor
(oran koddan türer) ve UBL'de kod başına `WithholdingTaxTotal` bloğu üretiliyor;
istisna kodu listeden seçiliyor ve KDV sıfırken zorunlu; profil cari kartından
geliyor, fatura üzerinde değiştirilebiliyor. Kural kümesi
`packages/shared/src/fatura-senaryo.ts`, kod listeleri
`packages/shared/src/gib-kodlari.ts` (sürüm sabiti `GIB_KOD_LISTESI_SURUMU`) —
aynı kuralı hem zod şeması hem fatura ekranındaki senaryo özeti çağırıyor, iki
taraf kuralı ayrı yorumlamıyor. Göç: `20260906160000_fatura_senaryolari`.

**S-01 kapı kararları (2026-09-06, kullanıcı onayı):**

1. **Senaryo satırlardan türetilir**, kullanıcı elle seçmez ve geçersiz kılamaz.
   Böylece seçilen senaryo ile satırların çelişmesi imkânsız olur; sihirbaz
   türettiği senaryoyu onay adımında gösterir.
2. **Tevkifat GİB koduyla girilir**, oran koddan gelir. Kod ile oranın
   birbirini tutmaması mümkün olmaz; kullanıcı "606 İşgücü Temin (9/10)" seçer.
3. **Profil cari kartında varsayılan**, fatura üzerinde değiştirilebilir.
   Kabul/ret döngüsü yalnız gerçekten gereken müşterilerde açılır.
4. **Kapsam SATIS / IADE / TEVKIFAT / ISTISNA.** Bu dördü mevcut veriden
   türetilebiliyor. IHRACKAYITLI ve OZELMATRAH gümrük beyanname alanları ve
   özel matrah tabanı gerektirdiğinden ayrı pakete bırakıldı (ikisi de sonradan
   yapıldı: EBLG-60 ve EBLG-69); ÖTV istisna kodları kalem modelinde ÖTV
   bulunmadığı için hâlâ kapsam dışıdır.

**Kod listelerinin kapsamı** (UBL-TR Kod Listeleri v1.16, `docs/e-belge/`):
KDV kısmi istisna 2xx (36 kod), KDV tam istisna 3xx (30 kod, `351` "istisna
olmayan diğer" dahil), tevkifat 601…623 ve 650 (24 kod, her biri kendi oranıyla; yalnız `650 Diğerleri`
birden çok oranla kullanılabilir).

| No | İster | Öncelik |
|---|---|---|
| FTR-01 | Satış faturası oluşturulabilmelidir: cari seçimi, kalem satırları (stok/hizmet), miktar, birim fiyat, iskonto (satır ve genel), KDV oranı (%0, %1, %10, %20). | Z |
| FTR-02 | Alış faturası girilebilmeli; girişte ilgili stok miktarları otomatik artmalıdır. | Z |
| FTR-03 | Satış faturası kesildiğinde stok miktarları otomatik azalmalı, cari bakiye borçlandırılmalıdır. | Z |
| FTR-04 | Fatura satırlarında KDV, iskonto ve genel toplam otomatik hesaplanmalı; kuruş yuvarlaması mevzuata uygun yapılmalıdır. | Z |
| FTR-05 | Fatura taslak olarak kaydedilebilmeli, kesinleştirilmeden düzenlenebilmelidir. Kesinleşmiş ancak e-belgesi henüz oluşturulmamış faturada stok yönü/miktarı, cari ve depo sabit kalmak kaydıyla tutar, iskonto, vergi ve açıklama düzeltilebilmelidir. e-Belge oluşturulduktan sonra fatura değiştirilemez; iptal/iade süreci işletilir. | Z |
| FTR-06 | Faturalar numaralandırma serisiyle (ör. TKR2026...) otomatik ve kesintisiz numaralanmalıdır. | Z |
| FTR-07 | Fatura PDF çıktısı üretilebilmeli, e-posta ile gönderilebilmelidir. | Z |
| FTR-08 | İade faturası (alış/satış) düzenlenebilmeli, stok ve cari hareketleri ters yönde işlenmelidir. | Z |
| FTR-09 | Proforma fatura oluşturulabilmeli ve tek tıkla satış faturasına dönüştürülebilmelidir. | İ |
| FTR-10 | ✅ Tekrarlayan (abonelik tipi) faturalar tanımlanabilmelidir. | G |
| FTR-11 | Tevkifatlı ve istisnalı fatura senaryoları desteklenmelidir. | İ |
| FTR-12 | Belge zinciri desteklenmelidir: teklif → sipariş → irsaliye → fatura; her adım bir sonrakine tek tıkla dönüştürülebilmeli, zincir izlenebilmelidir (e-İrsaliye kapsam dışı; kağıt/PDF irsaliye). Not (2026-07-13): sipariş aşamasında stok rezervasyonu ile rezerve/yoldaki stok göstergeleri bu kapsamda ele alınır. | İ |
| FTR-13 | Bekleyen siparişler/irsaliyeler toplu seçilip tek faturada birleştirilebilmelidir (toplu faturalama). | İ |
| FTR-14 | Fatura kaleminde carinin fiyat listesi ve özel iskontosu otomatik önerilmeli (CARI-10, STK-11); satıcı kullanıcı bazında maksimum iskonto yetkisi tanımlanabilmelidir. | İ |
| FTR-16 | ✅ Faturanın GİB senaryosu (`InvoiceTypeCode`) **satırlardan türetilmelidir**: tevkifatlı satır varsa TEVKIFAT, KDV oranı sıfır ve istisna kodu girilmiş satır varsa ISTISNA, iade tipindeyse IADE, aksi halde SATIS. Türetilen senaryo kaydedilmeli, gönderim onayında kullanıcıya gösterilmeli ve UBL'e bu değer yazılmalıdır. Kullanıcı senaryoyu elle seçmez. | G |
| FTR-17 | ✅ KDV oranı sıfır girilen satırda **GİB istisna kodu zorunlu** olmalı ve aranabilir bir listeden seçilmelidir; serbest metin kabul edilmemelidir. Liste UBL-TR Kod Listeleri'nin KDV kısmi istisna (2xx) ve tam istisna (3xx) kümelerini içerir. Vergisiz ama istisna sayılmayan satışlar için `351` seçeneği listede açıklamasıyla bulunmalıdır. | G |
| FTR-18 | ✅ Tevkifat, satırda **GİB tevkifat kodu** seçilerek girilmelidir (601…623, 650); tevkifat oranı koddan türetilir, kullanıcı pay/payda girmez. Seçilen kod UBL'de `WithholdingTaxTotal` altında `TaxTypeCode` olarak yazılmalı, tevkifat tutarı ve oranı aynı bloktan raporlanmalıdır. | G |
| FTR-19 | ✅ Faturanın e-Fatura profili (TEMELFATURA / TICARIFATURA) **cari kartındaki varsayılandan** gelmeli, fatura üzerinde değiştirilebilmelidir; UBL'e `ProfileID` olarak bu değer yazılır. Alıcının kabul/ret yanıtı yalnız TICARIFATURA'da beklendiği için (EBLG-13) profil seçimi bu takibin kapısıdır. | G |
| FTR-20 | ✅ Satış faturası ekranı, kaydetmeden önce **senaryo özetini** göstermelidir: türetilen fatura tipi, profil, istisna ve tevkifat içeren satır sayısı, tevkifat sonrası tahsil edilecek tutar. Eksik istisna kodu veya geçersiz senaryo bu adımda engellenmelidir. | G |
| FTR-21 | ✅ GİB kod listeleri (istisna, tevkifat) kod ve açıklamalarıyla uygulamada tanımlı olmalı; kod listesinin sürümü izlenebilmelidir. Liste dışı bir kod ne arayüzden ne API'den kabul edilmelidir. | G |
| FTR-15 | **Modül içi raporlar:** dönemsel satış/alış özeti, kâr marjı analizi (satış - ağırlıklı ortalama maliyet), iskonto analizi, KDV dökümü, iade oranları, taslakta bekleyen belgeler. Tümü RPR-06 rapor araç setini kullanır. | Z |
| FTR-22 | **Üç hazır belge şablonu** (karar 2026-09-17): fatura modülü ayarındaki `faturaSablonu` gerçek karşılık kazanır — **Standart** (renkli üst şerit, koyu tablo başlığı; bugünkü düzen ve varsayılan), **Modern** (geniş logo alanı, vurgu renkli tablo başlığı, ferah satırlar), **Klasik** (çerçeveli, sık, serif, yazıcı dostu). Şablon kiracı genelidir, belge başına seçilmez; ayar okunamazsa Standart'a düşülür ve belge basımı ayar yüzünden durmaz. | G |
| FTR-23 | **Logo ve vurgu rengi** (karar 2026-09-17): kiracı bir vurgu rengi seçer (hazır palet + serbest `#rrggbb`); rengin üzerine gelen yazı rengi WCAG parlaklığına göre otomatik seçilir, geçersiz renk varsayılana düşer. Logo **mevcut Firma ayarından** gelir (KLN-03), ikinci bir yükleme yeri açılmaz. | G |
| FTR-24 | **Şablon önizlemesi** (karar 2026-09-17): ayar ekranında örnek faturayla önizleme bulunur; şablon ya da renk değişince kendiliğinden tazelenir ve seçim **kaydedilmeden** görülür. Önizleme gerçek PDF üretecinden geçer — ekranda taklit bir düzen çizilmez, gördüğü şey bastığı şeydir. | G |
| FTR-25 | **Şablonun kapsamı** (karar 2026-09-17, 2026-09-17'de daraltıldı): şablon ve renk **bizim bastığımız** tüm belgeleri kapsar — fatura, e-Belge yedek görünümü, teklif/sipariş/irsaliye çıktıları, tahsilat/tediye makbuzları ve rapor sayfaları. ~~UBL'e gömülen görünüme de işler~~: giden belgeye görünüm gömülmediği için (EBLG-31 iptal) alıcının gördüğü tasarımı entegratör belirler. Geçersiz renk ve bilinmeyen şablon varsayılana düşer; şablon değişikliği kesilmiş belgeleri etkilemez. | G |

### 3.3 e-Fatura / e-Arşiv Entegrasyonu (EBLG)

**Durum (Çağrı Disiplini, 2026-09-06): EBLG-10…EBLG-15 eklendi ve
tamamlandı.** Sovos'un "Doğru Kullanım Tavsiyeleri" kılavuzları çağrı sayısına
üst limit koymuyor ama hatalı kullanım kalıplarında erişimin **otomatik
bloklandığını** yazıyor. Mevcut kod üç kalıba da giriyordu: her fatura
gönderiminde tam mükellef listesi indiriliyor, gelen belge taraması beş
dakikada bir son 30 günü yeniden sorguluyor, zarf durumu tek tek soruluyordu.

Neyin indiği: global `gib_mukellefler` tablosu ve günlük senkron (kanal kararı
artık lokalden, gönderim başına sorgu yok); `ebelge_gelen_kursor` ile ilerleyen
gelen belge taraması (saatlik zamanlanmış iş + saatlik sınırlı elle tazeleme);
zarf düzeyinde gelen çekim ve buradan okunan alıcı kabul/ret yanıtı
(`ebelge_kayitlari.alici_yaniti`, ret kritik bildirim üretir); 20'şerli ve iki
saatlik pencereyle toplu zarf durumu sorgusu; `ebelge_entegrator_cagri_total`
metriği.

**Bu paketin kapsamı dışında kalan Sovos metotları** (sonraki pakete):
`getInvoiceView` ve e-Arşiv `getInvoiceDocument`/`getSignedInvoice` (fatura
görüntüsü ve imzalı UBL — yasal saklama için gerekir), `actionService`
(e-Arşiv itirazı), `sendEnvelope` (toplu e-Arşiv), `getDesReceipts`
(gönderdiğimiz e-İrsaliyeye gelen yanıt), `getPartialUserList`.

**S-01 kapı kararları (2026-09-06, kullanıcı onayı):**

1. **Mükellef listesi:** kiracıdan bağımsız **tek global tablo**, günde bir kez
   tam senkron. GİB kaydı kamuya açık ve her kiracı için aynı; kiracı başına
   indirmek aynı listeyi N kez saklamak olurdu.
2. **Liste bayatsa:** gönderim **durdurulur**. Yanlış kanal seçimi (e-Fatura
   yerine e-Arşiv) yasal ve ticari hata olduğundan, tahmin etmektense durmak
   tercih edildi.
3. **Alıcı yanıtı:** `EbelgeKayit` üzerinde **ayrı alanlar**; mevcut `durum`
   alanı zarfın GİB durumu olarak kalır. Tek alana sıkıştırılırsa "zarf kabul
   edildi" ile "alıcı kabul etti" birbirini ezer.
4. **Sıklık:** gelen belge **saatte bir**, zarf durumu **2 saatte bir** ve
   20'şerli. Arayüzdeki elle tazeleme korunur, kiracı başına saatte bir.

| No | İster | Öncelik |
|---|---|---|
| EBLG-01 | Entegratör katmanı adaptör mimarisiyle soyutlanmalıdır: her firma, desteklenen entegratörlerden (Sovos, NES, Foriba, İzibiz, eLogo, Uyumsoft vb.) dilediğini bağımsız seçebilmelidir. Yeni bir entegratör, çekirdek kod değişmeden adaptör eklenerek desteklenebilmelidir. | Z |
| EBLG-01a | Firma yöneticisi, entegratör erişim bilgilerini (kullanıcı adı, parola/API anahtarı, servis adresi) arayüzden girebilmeli ve "bağlantı testi" ile doğrulayabilmelidir. **NES'te servis adresi girilmez (karar 2026-09-14):** adres "Test Ortamı" seçiminden türetilir — işaretliyse `https://apitest.nes.com.tr`, değilse `https://api.nes.com.tr` (NES geliştirici belgesi, "Test ve Canlı Ortam Hakkında"). Böylece test bayrağı ile gidilen ortam ayrışamaz, canlıya geçişte adres değiştirmek unutulamaz ve API anahtarı başka bir sunucuya gönderilemez. Formda seçimin hangi adrese gideceği gösterilir; düzenlemede mevcut seçim korunur. | Z |
| EBLG-01b | Entegratör erişim bilgileri veritabanında şifrelenerek (at-rest encryption) saklanmalı, arayüzde ve loglarda asla açık gösterilmemelidir. **Bağlantı düzenleme (karar 2026-09-14):** güncelleme config'i baştan yazdığı için düzenleme formu boş açılınca kullanıcının yeniden yazmadığı her alan siliniyordu (ör. seri öneki silinince numaralandırmanın sahibi değişiyor, iyzico ortamı sandbox'a dönüyordu). Düzenleme formu **gizli olmayan ayarları** (ortam/servis adresleri, VKN, GB/PK etiketleri, seri önekleri, test ortamı) kayıtlı değerle açar; API bunları bir izin listesiyle döndürür, listede olmayan alan gösterilmez. **Gizli alanlar** (kullanıcı adı, parola, API anahtarı) gösterilmez ve düzenlemede zorunlu değildir; boş bırakılırsa kayıtlı değer korunur. Doldurulmuş gizli olmayan bir alanı silen kullanıcı onu bilerek temizlemiş sayılır. | Z |
| EBLG-02 | Fatura kesinleştirme e-belge gönderimini başlatmamalıdır. Kesinleşmiş ve e-belgesi bulunmayan faturada **e-Fatura Oluştur** wizard'ı açılmalı; kontrol adımında aktif entegratör, alıcı VKN/TCKN ve mükellefiyet gösterilmeli, kullanıcı onayından sonra mükellefse e-Fatura, değilse e-Arşiv olarak gönderilmelidir. | Z |
| EBLG-03 | Giden e-belgeler UBL-TR 1.2 standardına uygun üretilmelidir. | Z |
| EBLG-04 | Gönderilen belgelerin durumu (kuyrukta, iletildi, kabul, ret, hata) izlenmeli ve arayüzde gösterilmelidir. | Z |
| EBLG-05 | Gelen e-Faturalar entegratörden çekilebilmeli; kullanıcı onayıyla alış faturası olarak sisteme işlenebilmelidir. | Z |
| EBLG-06 | Ticari e-Faturalarda kabul/ret yanıtı gönderilebilmelidir. | Z |
| EBLG-07 | e-Arşiv faturaları için GİB'e günlük raporlama entegratör üzerinden otomatik yürütülmelidir. | Z |
| EBLG-08 | Gönderim hatalarında belge "hata" durumuna düşmeli, kullanıcı düzeltip yeniden gönderebilmelidir; otomatik yeniden deneme uygulanmalıdır. | Z |
| EBLG-09 | e-belge XML ve PDF görüntüleri arşivlenmeli, mevzuat gereği en az 10 yıl saklanabilir yapıda tutulmalıdır. | Z |
| EBLG-10 | Alıcının e-Fatura mükellefiyeti **lokal listeden** belirlenmelidir. Tam mükellef listesi günde bir kez indirilip saklanır; belge gönderiminde entegratöre canlı liste sorgusu yapılmaz. Liste hiç indirilmemişse veya tazelik penceresinin dışındaysa gönderim durdurulur ve kullanıcıya listenin güncellenmesi gerektiği bildirilir. | G |
| EBLG-11 | Gelen belge çekimi **tarih kursörüyle** ilerlemelidir: en son sorgulanan ana kadar olan aralık ikinci kez sorgulanmaz, her tarama kursörden bugüne kadarki aralığı en çok birer günlük dilimler hâlinde ister. Zamanlanmış tarama en sık **saatte bir** çalışır; arayüzdeki elle tazeleme kiracı başına saatte bir ile sınırlanır. | G |
| EBLG-12 | Gelen belge çekimi **zarf düzeyinde** yapılmalıdır; fatura, uygulama yanıtı ve sistem yanıtı belge tipleri için ayrı ayrı çağrı yapılmaz. | G |
| EBLG-13 | Kestiğimiz ticari faturaya alıcının verdiği **kabul/ret yanıtı** gelen zarflardan okunup faturanın e-belge kaydında ayrı alanlarda (yanıt, zaman, gerekçe) izlenmelidir; zarfın GİB durumu ile alıcının yanıtı ayrı eksenlerdir. Gelen **ret** kritik bildirim üretir (bkz. §3.10). | G |
| EBLG-14 | Zarf durumu **20'şerli toplu** sorgulanmalıdır; son duruma ulaşmış (kabul/ret/kalıcı hata) zarf bir daha sorgulanmaz ve aynı zarf en erken **2 saat** sonra yeniden sorgulanır. | G |
| EBLG-15 | Entegratöre yapılan çağrılar metot bazında metrik olarak yayımlanmalıdır; çağrı disiplininin (EBLG-10…14) korunduğu ölçülebilir olmalıdır. | G |
| EBLG-16 | Belge numarasını **entegratör atıyorsa** (sağlayıcıda otomatik numaralandırılan seri tanımlıysa) yerel sayaç ilerletilmemelidir: UBL'e yalnız seri öneki yazılır, numara gönderim yanıtından okunup faturaya işlenir. Numarası henüz atanmamış kesin fatura yazdırılamaz ve e-postalanamaz. Numarayı bizden bekleyen sağlayıcılarda yerel sayaç kullanılmaya devam eder; numaralandırma sahipliği sağlayıcı başına belirlenir. | G |
| EBLG-17 | Gönderim ağ çağrısı ile veritabanına yazma aynı atomik birim olmadığından, başarılı çağrıdan sonra gelen bir hata belgeyi sağlayıcıda bırakabilir. **Yeniden denemeden önce** sağlayıcıya aynı kaynak kayıt için belge oluşup oluşmadığı sorulmalı; oluşmuşsa belge yeniden gönderilmez, mevcut belge benimsenir. İlk gönderimde bu sorgu yapılmaz. | G |

**e-Belge PDF görüntüleme (EBLG-27…EBLG-32) — S-01 kapı kararları (2026-09-12,
kullanıcı onayı):** Gelen ve giden e-Fatura/e-Arşiv belgeleri PDF olarak
görüntülenebilmelidir. İnceleme sırasında görüldü ki gelen belgenin
yazdırılabilir hiçbir görünümü yok (yalnız eşleştirme modalı var); giden belgenin
PDF'i ise iç çıktıdır, e-belge kimlik alanlarını taşımaz; ayrıca UBL'e gömdüğümüz
XSLT bir taslaktır (yalnız numara, tarih, toplam), yani alıcı faturamızı böyle
görür. **Kararlar:** görünüm belgenin kendi gömülü XSLT'sinden çizilir; giden
tarafta hem PDF zenginleştirilir hem aynı görünüm XSLT olarak gömülür; PDF
saklanmaz, istendiğinde XML'den üretilir.

| No | İster | Öncelik |
|---|---|---|
| EBLG-27 | Gelen ve giden e-Fatura/e-Arşiv belgesi, kayıtlı UBL'inden **PDF olarak görüntülenebilmelidir**. PDF saklanmaz, her istekte üretilir; saklanan asıl belge XML'dir. Belge numarasıyla adlandırılır ve tarayıcıda satır içi açılır. | G |
| EBLG-28 | Görünüm, belgenin UBL'ine **gömülü XSLT** eklentisinden çizilmelidir; eklenti türü (`DocumentType` ya da `DocumentTypeCode`) `XSLT` olan **ya da** türü yazılmamış olsa da dosya adı `.xsl`/`.xslt` olan ek görünüm sayılır (gönderenlerin bir kısmı türü hiç yazmaz, portallar bu belgeleri de görünümüyle gösterir); belge, gönderenin tasarladığı resmî görünümle çıkar. XSLT yoksa veya dönüşüm başarısızsa uygulamanın kendi şablonuna düşülür ve çıktıda bunun yedek görünüm olduğu belirtilir. | G |
| EBLG-29 | XSLT yabancı bir kaynaktan gelir; dönüşüm **yalıtılmış** çalışmalıdır: dış ağ erişimi, yerel dosya okuma ve betik çalıştırma kapalı olmalı, dönüşüm süre sınırına bağlanmalıdır. Bozuk veya kötü niyetli XSLT PDF üretimini düşürmemeli, yedek görünüme düşürmelidir. | G |
| EBLG-30 | Giden faturanın PDF'i e-belge kimlik alanlarını taşımalıdır: **ETTN (UUID)**, GİB **senaryosu** ve **profili**. | G |
| EBLG-31 | ~~UBL'e gömülen XSLT, giden faturanın PDF'iyle **aynı görünümü** üretmelidir~~ — **İPTAL (karar 2026-09-17):** giden belgeye görünüm gömülmez. Entegratör (NES) belgeyi kendi tasarımıyla basıyor; portalda üç ayrı şablonla gönderilen belgeler aynı göründü, yani gömdüğümüz görünüm okunmuyor ve her faturaya ~80 KB ölü yük ekliyordu. Kendi çıktılarımızın görünümü FTR-22…24'ten gelir; **gelen** belgelerde gönderenin gömülü görünümü okunmaya devam eder (EBLG-28). | — |
| EBLG-32 | Giden **e-Arşiv ve e-Fatura** PDF'inde **GİB karekodu** bulunmalıdır. İçerik GİB *Karekod Standardı Kılavuzu* v1.0 (Şubat 2023, `docs/e-belge/GIB-Karekod-Standardi-Kilavuzu-v1.0.pdf`) §2.1–2.2'deki JSON'dur: `vkntckn`, `avkntckn`, `senaryo`, `tip`, `tarih`, `no`, `ettn`, `parabirimi`, `malhizmettoplam`, her KDV oranı için `kdvmatrah(oran)` ve `hesaplanankdv(oran)`, `vergidahil`, `odenecek`; değerler UBL'den okunur, tutarlar 2 ondalıklı metindir. **Karekod iki yerde üretilir (karar 2026-09-14, 2026-09-13 kararının yerine):** (1) **Gömülen XSLT** karekodu belge açıldığında XML'den okuyarak JavaScript ile çizer (NES *QR Kod Zorunluluğu* yöntemi); sabit bir görsel gömülmediği için sağlayıcının numarayı yazdığı XML'de alıcının ve portalın görünümünde de doğru numarayla çıkar. Kütüphane `qrcode-generator` (MIT) XSLT'ye gömülür. XSLT'nin ürettiği JSON, sunucudaki `faturaKarekodVerisi` çıktısıyla birebir aynı olmalıdır (KDV oranları satırlardan gruplanır). (2) **Bizim bastığımız PDF'te** JavaScript kapalı kalır (EBLG-29); sunucuda üretilen karekod görseli XSLT'deki yer tutucuya yerleşir, çift karekod oluşmaz. Karekod **sağ üstte** ve 35 mm'dir; yedek görünümde de sağ üstte durur (kılavuz konum belirtmez, NES sağ üst köşeyi zorunlu yazar). Tam numarası olmayan belgede (yalnız seri öneki) iki yol da karekod basmaz. e-İrsaliye kapsam dışı. | G | **Not (2026-09-17):** karekodu gömülü XSLT'nin de çizmesi kuralı EBLG-31 ile birlikte düştü; karekod artık yalnız sunucuda üretilip kendi PDF'imize basılır, giden belgede entegratörün şablonu çizer.
| EBLG-33 | **Gelen e-İrsaliye** kayıtlı UBL'inden **PDF olarak görüntülenebilmelidir** (karar 2026-09-13). Görünüm EBLG-28 kuralıyla gömülü XSLT'den çizilir; XSLT yoksa ya da dönüşüm başarısızsa **irsaliye yedek görünümü** basılır: gönderen ve alıcı (VKN/TCKN), belge no, tarih, ETTN, senaryo/tip, fiili sevk tarihi ve zamanı, teslimat adresi, taşıyıcı, plaka, şoför ve satırlar (kod, mal, miktar, birim); çıktı bunun yedek görünüm olduğunu yazar. PDF saklanmaz, belge numarasıyla adlandırılır ve tarayıcıda açılır. | G |
| EBLG-34 | **Başka yerden verilmiş yanıt benimsenir** (karar 2026-09-13): gelen ticari e-Faturaya ya da gelen e-İrsaliyeye entegratör portalından veya aynı hesabı kullanan başka bir yerden kabul/ret verildiyse bu karar uygulamaya da yansımalı, belge "yanıt bekliyor" görünmemelidir. (1) Gelen tarama entegratörün bildirdiği kararı, yerelde yanıtı olmayan kayda yazar; yerel kararın üzerine yazmaz. (2) Kabul/ret gönderilmeden hemen önce belgenin entegratördeki yanıt durumu sorulur; yanıt verilmişse gönderilmez, karar kayda işlenir ve kullanıcıya hangi yanıtın zaten verildiği söylenir — fatura taraması kursörle ilerlediği için (EBLG-11) önceden içe aktarılmış belgeler ancak bu yolla düzelir. Sorgu yapılamazsa gönderim sürer; mükerrer yanıtı entegratör reddeder. Entegratörün ret notu gerekçe olarak saklanır. | G |
| EBLG-35 | **Belge durum geçmişi** (karar 2026-09-14): faturanın kendi durumu (taslak/kesin/iptal), e-Belge durumu (kuyrukta/iletildi/kabul/ret/hata/iptal), alıcı yanıtı (kabul/ret) ve e-İrsaliye durumu her değiştiğinde **eski → yeni durum, zaman, değiştiren kullanıcı** (otomatik işlerde "Sistem") ve varsa açıklama (hata mesajı, ret gerekçesi, fatura no) kaydedilir. Kayıt **veritabanı tetikleyicisiyle** tutulur ki durumu değiştiren hiçbir yol (bugün 12 ayrı nokta, yarın eklenecekler) atlanamasın; yalnız gerçek değişiklik yazılır — durumu değiştirmeyen periyodik sorgu satır üretmez. Geçmiş **yalnız eklenir**: uygulama rolü güncelleyemez ve silemez, kiracıya göre yalıtılır. Geçmiş **fatura e-Belge panelinde** ve **Belgeler detayında** (e-İrsaliye dahil) belge bilgilerinin altında, en yeni üstte listelenir. Özelliğin öncesinden kalan her kayda mevcut durumuyla **tek başlangıç satırı** eklenir ve gerçek değişiklik olmadığı belirtilir. | G |
| EBLG-36 | **Giden e-İrsaliye durumu otomatik güncellenir** (karar 2026-09-14). Önceden yalnız elle sorgulanıyordu; GİB'in reddettiği iki irsaliye günlerce "iletildi" göründü. (1) Worker `kuyrukta`/`iletildi` ve entegratör referansı olan irsaliyeleri kiracı başına tek işte, aynı irsaliyeyi en erken **2 saatte** bir sorgular; `kabul`, `ret`, `kismi_kabul` ve `hata` son durumdur. (2) Zarfın GİB durumu faturadaki eşlemeyle okunur; GİB/alıcı hatasında açıklama kayda yazılır. (3) **Alıcı kararı ayrı belgedir** (irsaliye yanıtı / ReceiptAdvice): NES giden irsaliyede yalnız yanıtın gelip gelmediğini bildirir; yanıt belgesi bulunur, bu irsaliyeye ait olduğu doğrulanır ve karar satır miktarlarından çıkarılır — yalnız teslim alınan → **kabul**, hiç teslim alınmayan → **ret**, ikisi birden → **kısmi kabul** (yeni durum); reddedilen/eksik miktar ve gerekçe açıklamaya yazılır. (4) Alıcı yanıt vermezse `iletildi` irsaliye gönderimden itibaren **10 gün** sorgulanır, sonra otomatik sorgu durur, elle sorgu açık kalır; süre `ebelge` modül ayarı `eirsaliyeYanitGunSayisi`'dır. (5) Entegratöre ulaşılamazsa kayıt `hata` yapılmaz (geçici kesinti belgeyi kalıcı hatalı göstermesin), sonraki turda yeniden denenir. Değişiklikler EBLG-35 durum geçmişine düşer. | G |
| EBLG-37 | **Yarım kalmış gönderim kurtarılabilir** (karar 2026-09-15). Gönderim kaydı önce `kuyrukta` yazar, sonucu entegratör çağrısından sonra yazar; süreç arada ölürse kayıt referanssız kalır ve ne sorgulanabilir ne yeniden gönderilebilirdi. (1) `kuyrukta`, entegratör referansı olmayan ve **15 dakikadır** güncellenmemiş kayıt, o fatura için bekleyen/çalışan gönderim işi yoksa **yarım kalmış** sayılır. (2) Kurtarma **elle** yapılır: sihirbaz ve gönderim bu kaydı kabul eder, arayüz "Yeniden gönder" gösterir; referansı olmayan kayıtta "Durumu sorgula" gösterilmez. Planlayıcı kendiliğinden yeniden göndermez. (3) Yeniden gönderim EBLG-17 gereği önce entegratöre sorar; belge oluşmuşsa benimsenir, mükerrer gönderilmez. (4) Düzeltme Merkezi yalnız yarım kalmış rezervasyonu "uzun bekliyor" sayar; referanslı `kuyrukta` belge durum sorgusuyla ilerlediği için sayılmaz. (5) 2026-08-23'e kadar kesinleştirmenin otomatik açtığı, hiç gönderilmemiş (referanssız, arşivsiz, hiç güncellenmemiş) `kuyrukta` kayıtlar migration ile silinir; fatura e-belgesi olmayan duruma döner, durum geçmişindeki başlangıç satırları kalır. | G |
| EBLG-38 | **Sorgulanamayan belgenin durum sorgusu hataya düşmez** (karar 2026-09-15). Gönderilmemiş belgede açılan durum işi kalıcı hatayı geçici sanıp 5 kez deniyor, dead-letter'a düşüyor ve o faturanın sonraki sorgularını sessizce yutuyordu. (1) Elle durum sorgusu **kuyruğa alınmadan önce** kontrol edilir: e-belge kaydı yoksa, entegratör referansı yoksa ya da belge son durumdaysa (`kabul`/`ret`/`hata`) iş açılmaz, kullanıcıya sebep söylenir. (2) İş kuyruktayken belge bu duruma düşerse worker işi **yeniden denemeden atlanmış** olarak bitirir; dead-letter'a düşmez. Entegratör çağrı hataları geçici sayılır, yeniden denenir. (3) Fatura başına durum işini yalnız kullanıcı açtığından, aynı fatura için dead-letter'da duran eski durum işi **elle sorgu istendiğinde temizlenir** ve iş yeniden kuyruğa alınır. | G |
| EBLG-39 | **Entegratör tarafındaki iptal yansır, çağrı hatası belgeyi hatalı yapmaz** (karar 2026-09-15). (1) Durum sorgusu e-Arşiv belgesinin entegratörde (ör. NES portalından) **iptal edildiğini** görürse e-Belge kaydı `iptal` olur ve durum geçmişine düşer. **Fatura kendiliğinden iptal edilmez** (stok/cari ters hareketleri kullanıcının kararıdır); fatura hâlâ iptal değilse muhasebe ve yöneticiye "belge entegratörde iptal edilmiş, faturayı iptal edin" bildirimi gider; bildirim tarama tarafından da bu durumdan türetilir, fatura kesin kaldıkça açık kalır ve fatura iptal edilince kendiliğinden kapanır. Fatura sonradan iptal edilirken entegratöre ikinci iptal çağrısı yapılmaz. (2) `iptal` son durumdur: sorgu iptal edilmiş belgeyi yeniden sormaz, "iletildi"ye çevirmez. (3) Durum sorgusunda entegratöre **ulaşılamazsa** kayıt `hata` yapılmaz: elle sorguda kullanıcıya söylenir, toplu sorguda o belge atlanıp sonraki turda yeniden sorulur, diğer belgeler etkilenmez (EBLG-36'daki irsaliye kuralının faturaya uygulanışı). Adaptörler çağrı hatasını durum olarak değil hata olarak bildirir. (4) Uygulamadan e-Arşiv faturası iptal edilirken önce yapılan durum sorgusu entegratöre ulaşamazsa **iptal durdurulur**: belgenin zaten iptal olup olmadığı ve GİB raporuna girip girmediği bilinmeden iptal çağrısı yapılmaz. | G |
| EBLG-40 | **Giden faturanın otomatik durum sorgusu süreyle sınırlıdır** (karar 2026-09-15). Önceden `iletildi` her belge sonsuza kadar 2 saatte bir sorgulanıyordu. (1) Entegratör referanslı `kuyrukta` belge GİB sonucu gelene kadar sorgulanır. (2) **Temel e-Fatura** `iletildi` olunca (zarf alıcıya ulaştı) otomatik sorgu durur; alıcının yanıtı olmadığından öğrenilecek başka durum yoktur, belge `kabul` sayılmaz. (3) **Ticari e-Fatura** alıcı yanıtı için gönderimden itibaren **10 gün** sorgulanır (mevzuattaki 8 günlük yanıt süresi + 2 gün teslim payı); süre `ebelge` modül ayarı `efaturaYanitGunSayisi`'dır; geç gelen yanıtı gelen tarama okur (EBLG-13). (4) **e-Arşiv** fatura tarihinden itibaren iptal edilebildiği süre (`earsivIptalGunSayisi`, varsayılan 8 gün) boyunca sorgulanır ki entegratör tarafındaki iptal yakalansın (EBLG-39). (5) Süre dolan belgenin durumu değişmez, **elle sorgu açık kalır**. | G |
| EBLG-41 | **Giden e-İrsaliye ekranı** (karar 2026-09-16): `/panel/ebelge/irsaliye-giden`, "Belgeler & e-Belge" alanında gelen karşılığının yanında. Onaylı satış irsaliyeleri **gönderilmiş ve gönderilmeyi bekleyen** ayrımıyla tek listede toplanır; satırda irsaliye no, cari, sevk tarihi, e-İrsaliye durumu (`kuyrukta/iletildi/kabul/kismi_kabul/ret/hata` ya da henüz gönderilmemiş), entegratör referansı ve hata mesajı yer alır. Durum, tarih aralığı ve serbest metin (belge no, cari, VKN) ile süzülür; detayda UBL XML indirilebilir. | G |
| EBLG-42 | **Gönderim engelleri önceden gösterilir** (karar 2026-09-16): gönderilmemiş her irsaliye için gönderime engel eksikler listelenir — cari VKN/TCKN yok, cari e-İrsaliye alıcısı değil, il/ilçe/posta kodu dolu sevk (ya da merkez/fatura) adresi yok, taşıyan bilgisi (taşıyıcı cari VKN'si veya şoför adı-soyadı-plaka) eksik. Denetim `gonder` ile **aynı kuralı** kullanır ve yalnız yerel veriden hesaplanır; mükellefiyet yerel GİB listesinden bakılır, liste yoksa ya da bayatsa engel sayılmaz, "doğrulanamadı" olarak gösterilir. | G |
| EBLG-43 | **Ekrandan gönderim ve durum sorgulama** (karar 2026-09-16): engeli olmayan irsaliye tek tek ya da **seçilerek toplu** gönderilir; toplu gönderimde her belge kendi işleminde ilerler, biri başarısız olunca diğerleri sürer ve sonuç `{gönderilen, başarısız[]}` olarak belge numarasıyla raporlanır (tek seferde en çok 50 belge). Hata almış irsaliye, engeli giderildikten sonra aynı uçtan yeniden gönderilir. Durum tek belge için ya da bekleyenlerin tamamı için sorgulanır; toplu sorgu mevcut `durumlariTopluSorgula` servisini kullanır ve EBLG-36'daki 2 saatlik aralığı korur. | G |
| EBLG-44 | **Satış çalışma alanında kuyruk** (karar 2026-09-16): satış çalışma alanına "e-İrsaliye bekleyen sevkiyatlar" kuyruğu eklenir; gönderilmemiş ve hata almış irsaliyelere giden ekranın ilgili süzgecini açar. | G |
| EBLG-45 | **Resmi durum adımları form altında gösterilir** (karar 2026-09-16): e-Belge ekranlarında, durum geçmişinin üstünde, belgenin resmi akıştaki yerini gösteren bir şerit bulunur — gönderildi → maliyeye iletildi → alıcıya ulaştı → alıcı yanıtı. Adım kümesi akışa göre değişir: **temel** e-Faturada alıcı yanıtı adımı **yoktur** (o senaryoda yanıt hiç gelmez), e-Arşivde üçüncü adım "GİB'e işlendi"dir (zarf alıcıya gitmez), e-İrsaliyede alıcı kararı kabul/kısmi kabul/ret olarak ayrı adımdır, gelen belgelerde akış "bize ulaştı → yanıtlandı" iki adıma iner. Hata ve iptal adım değil sapmadır: hata sıradaki adımı kırmızı yapar, iptal tamamlanmamış adımları kapatır. Tamamlanan adımın altında geçmişten eşleştirilen tarih-saat yazılır; kaydı yoksa boş kalır. Şerit fatura e-Belge panelinde, belge detayında, giden ve gelen e-İrsaliye ile gelen e-Fatura ekranlarında görünür; ayrıntılı geçmiş listesi altında durmayı sürdürür. | G |
| EBLG-49 | **Onaylanmış irsaliyenin taşıma bilgisi ekrandan girilir** (karar 2026-09-17): şoför, plaka ve fiili sevk zamanı çoğu zaman belge onaylandıktan sonra, mal yüklenirken belli olduğu için sunucu bu alanları onaydan sonra da açık tutar (EBLG-23); arayüzde bunu kullanan bir yer yoktu ve taşıyan bilgisi girilmeden onaylanan irsaliye e-İrsaliye olarak gönderilemiyordu. Taşıma bilgisi paneli hem giden e-İrsaliye ekranındaki satırdan hem belge detayından açılır, değerleri belgeden okur, kayıtlı araç ve şoför kartlarından doldurmayı sürdürür. Panel gönderim kuralının aynısını gösterir (taşıyıcı cari ya da şoför adı+soyadı+plaka; taşıyıcı carinin VKN'si yoksa uyarır) ve eksik bilgi kaydetmeyi engellemez. Panel yalnız gönderilmemiş ya da hata almış, iptal edilmemiş irsaliyede açılır — sunucunun sınırıyla aynı. Belge detayında taşıma bilgisi özeti ayrıca görünür. | G |
| EBLG-50 | **Plaka biçimi GİB şematronuna uydurulur** (14.09.2026 şematron değişikliği §3, `docs/e-belge/SEMATRONDEGISIKLIKLERI_484.pdf`): irsaliyede **şoför bildirilmişse araç plakası zorunludur** (taşıyıcı firma seçili olsa bile). Türkiye plakası `01-81 il kodu + 1-3 büyük harf + 1-5 rakam` biçiminde ve `schemeID="PLAKA"` ile, yabancı plaka yalnız büyük harf/rakam/tire/alt çizgiden oluşur ve `schemeID="YABANCIPLAKA"` ile yazılır; dorsede karşılıkları `DORSEPLAKA` ve `YABANCIDORSEPLAKA`'dır. Girdi kaydedilirken boşluklar atılıp harfler büyütülür; biçime uymayan plaka ne araç kartına ne belgeye kaydedilir, gönderim engelleri arasında da görünür. Kural tek yerdedir (`packages/shared/src/plaka.ts`), API ve arayüz onu çağırır. | G |
| EBLG-51 | **Kısmi istisna kod listesine 233 eklenir** (aynı şematron §5): "2942 Sayılı Kamulaştırma Kanunu Kapsamında Taşınmazların Devri". | G |
| EBLG-52 | **Birim kodu GİB kod listesinden yazılır** (karar 2026-09-17): satır birimi serbest metindir, UBL ise `unitCode` bekler; giden belgelerde kod sabit yazıldığı için kiloyla satılan mal "adet" görünüyordu. Eşleme tek yerdedir (`packages/shared/src/birim-kodu.ts`) ve hem fatura hem irsaliye satırını besler: adet `C62`, kg `KGM`, litre `LTR`, metre `MTR`, m² `MTK`, m³ `MTQ`, saat `HUR`, ton `TNE` ve yaygın diğer birimler; yazım farkları (büyük harf, nokta, `M²`) aynı koda iner. Tanınmayan birim belgeyi düşürmez, `C62` yazılır ama e-Fatura sihirbazı bunu satır satır uyarır. | G |
| EBLG-53 | **İhracat faturası kendi türüyle düzenlenir** (karar 2026-09-18, GİB resmî örneği `docs/e-belge/…/UBL-TR 1.2.1/XSLT/IHRACAT.xml`): alıcının fatura adresindeki ülke Türkiye dışıysa belge ihracat faturasıdır — karar sihirbazda sorulmaz, adresten türer ve GİB mükellef listesi hiç sorgulanmaz. Belge e-Fatura kanalından **Ticaret Bakanlığı'nın posta kutusuna** (`urn:mail:ihracatpk@gtb.gov.tr`) gider. Belgenin **alıcısı da Bakanlıktır** (`AccountingCustomerParty`, VKN `1460415308`); malı alan yabancı firma ayrı tarafta, `cac:BuyerCustomerParty` içinde `PARTYTYPE`/`EXPORT` kimliğiyle, adresi ve kendi ülkesindeki vergi numarasıyla (`PartyLegalEntity/CompanyID`) bildirilir. `ProfileID=IHRACAT`, `InvoiceTypeCode=**ISTISNA**`. Teslimat **satır düzeyindedir**: `InvoiceLine/cac:Delivery` içinde fiili ihracat tarihi, teslim adresi, teslim şartı (`DeliveryTerms`, Incoterms), GTİP (`Shipment/GoodsItem/RequiredCustomsID`, 12 hane) ve taşıma şekli (`ShipmentStage/TransportModeCode`). Menşei satırın `Item/OriginCountry` alanında **ülke adıyla** yazılır (yalnız kod yazılan belge şemadan döner). KDV istisna kodu satırdan türer — mal `301`, hizmet `302` — ve fatura düzeyindeki `TaxTotal`'da açıklamasıyla birlikte bildirilir; tasarım belgesindeki `351` yanlıştır. Eksikler tek listede toplanır ve gönderimi durdurur (ülke, fiili ihracat tarihi, GTİP'siz satır, sıfırlanmamış KDV). Kural tek yerdedir (`packages/shared/src/ihracat.ts`), sihirbaz ile gönderim aynı listeyi üretir. **TRY ihracat faturası NES test ortamında kabul edildi (2026-09-18).** | G |
| EBLG-54 | **Gümrük beyanname numarası kayda işlenir** (karar 2026-09-18): beyanname numarası gümrük çıkışı kapandıktan sonra, belge çoktan gönderilmişken belli olur. Numara ve tarihi fatura üzerine, e-Belge durum panelinden girilir; **GİB'e ikinci bir gönderim yapılmaz** — imzalanıp iletilmiş e-Fatura zaten değiştirilemez ve gümrük eşleşmesi fatura UUID'si üzerinden yürür. Numara gönderimden önce girilmişse belgeye `AdditionalDocumentReference` içinde `CUST_INV` olarak gider. | G |
| EBLG-55 | **Alıcı adresi cari kartından yazılır** (karar 2026-09-18): giden belgelerde alıcının adresi sabit "Merkez / Istanbul / Türkiye" yazılıyordu — kartta adres duruyorken belgeye yanlış şehir gidiyordu. Adres artık karttan gelir; birden çok adres varsa sıra **fatura → merkez → şube → sevk → depo**'dur ve seçim tek yerdedir (`packages/shared/src/adres.ts`), ihracat kanalı kararı da aynı adresin ülkesini okur. Belgeye sokak, ilçe, il, posta kodu ve ülke kodu (`Country/IdentificationCode`) yazılır. Kartta hiç adres yoksa şehir uydurulmaz: zorunlu alanlar `-` gider ve sihirbaz "cari kartında adres yok" uyarısı gösterir. Kural hem e-Fatura/e-Arşiv hem e-İrsaliye alıcı tarafında geçerlidir. Satıcı tarafı 2026-09-19'dan beri firma kartından gelir (EBLG-62). | G |
| EBLG-56 | **e-Arşiv internet satışı alan grubu** (karar 2026-09-18): satış internet üzerinden yapıldıysa GİB faturada satışın nerede yapıldığını, nasıl ödendiğini ve malın nereye gönderildiğini arar. İşaret **e-Belge sihirbazında** konur ("bu bir internet satışı") ve faturaya yazılır; işaret kalkarsa alanlar da temizlenir. Zorunlu alanlar: sipariş numarası ve tarihi (faturadan gelir, `cac:OrderReference`), satışın yapıldığı web adresi (`cbc:Note`), ödeme şekli (`PaymentMeans/PaymentMeansCode`, UN/ECE 4461) ve ödeme tarihi, teslimat adresi (`Delivery/DeliveryAddress`; e-İrsaliye ile aynı kuralla seçilir — sevk adresi, yoksa merkez/fatura). İsteğe bağlı: ödeme aracısı (`InstructionNote`), kargo firması unvanı/VKN (`Delivery/CarrierParty`) ve gönderi tarihi (`ActualDeliveryDate`). **Grup yalnız e-Arşiv kanalında belgeye yazılır**; alıcı e-Fatura mükellefi çıkarsa istenmez. Sipariş referansı ise kanaldan bağımsız, sipariş numarası dolu her faturaya yazılır. Eksikler sihirbazda anında listelenir ve gönderimi durdurur; kural tek yerdedir (`packages/shared/src/internet-satisi.ts`) ve sunucu gönderimde aynı listeyi yeniden üretir. | G |
| EBLG-57 | **Dövizli belge** (bulgu 2026-09-18, **kapandı 2026-09-19**, `23ca527`, `da80d2d`): NES'in "Para birimi TRY olmayan belgelerde kur bilgisi zorunludur" reddi belgeden değil, yeniden gönderimlerin **dead-letter kaydı yüzünden worker'da sessizce atlanmasından** kaynaklanıyordu (kuyruğa ekleme artık eski `dead-<jobId>` kaydını temizler). Kur `PricingExchangeRate/CalculationRate` ile gider (NES bunu saklar); EUR ihracat faturası NES testte kabul edildi. Dövizli faturada kur **1 olamaz**; kendi PDF'lerimiz toplamların TL karşılığını da basar. | A |
| EBLG-58 | **İade faturası iade edilen faturalara referans verir** (karar 2026-09-19, `3bce0d6`): e-Belge olarak gönderilen iade **alış iadesidir** (satış iadesinin faturasını müşteri keser; satış iadesi, alış ve proforma gönderilemez). İade edilen her fatura ayrı `cac:BillingReference/InvoiceDocumentReference` olur: 16 haneli GİB numarası, tarih (iade tarihinden sonra olamaz) ve `DocumentTypeCode` `IADE`; en çok 20 referans. Referans aynı tedarikçinin kesinleşmiş alış faturalarından seçilir ya da elle girilir (`fatura_iade_referanslari`, RLS). Alış iadesi kendi serimizden numaralanır; IADE tipi TICARIFATURA ile gidemez, profil TEMELFATURA olur. Kural `packages/shared/src/iade.ts`. | G |
| EBLG-59 | **İstisna kodu belge altında ve tipe göre** (2026-09-19, `bf365c7`): istisna kodu ve açıklaması belge düzeyi KDV alt toplamına yazılır (yoksa sıfır KDV'li yurt içi belge hiç gidemiyordu); tevkifat oranı `Percent` alanına tam sayı ("90") yazılır. Seçilebilir istisna kodları fatura tipine göre süzülür (şematron matrisi `docs/e-belge/FATURA-TURLERI-ALAN-TABLOSU.md` §4): tevkifatlı belgede sıfır KDV satırı yalnız 351 alır. İstisnalı alış iadesi (yalnız istisna ya da %20 satırla karışık) IADE tipinde gider, NES önizlemesinde denendi (2026-09-19). | G |
| EBLG-60 | **İhraç kayıtlı satış** (karar 2026-09-19, `a11b5c0`, `a2341e9`): satış faturasında 701/702 kodu işaretlenir (703 ÖTV kapsam dışı), senaryo IHRACKAYITLI olur. KDV hesaplanır ama tahsil edilmez: genel toplam ve cari borç matrahtır; UBL'de kod ve açıklama KDV'li alt toplamda, `TaxInclusiveAmount` matrah+KDV, `PayableAmount` matrah. Alıcı yurt dışındaysa işaret reddedilir. Kendi PDF'imiz KDV'yi "tahsil edilmez" diye etiketler ve belge altı ibaresi basar. | G |
| EBLG-61 | **Tevkifatlı faturanın iadesi TEVKIFATIADE'dir** (2026-09-19, `e20c58c`; KDV GUT 2.1.4.1): iade tevkifatsız düzenlenir — `WithholdingTaxTotal` yazılmaz (şematron reddeder), belgede yalnız tevkif dışı KDV görünür, oran aynı kalır. | G |
| EBLG-62 | **Satıcı adresi firma kartından gelir** (2026-09-19, `899664c`): firma kartına adres, ilçe, il, posta kodu, telefon, e-posta, web, MERSİS ve ticaret sicil eklenir (Ayarlar › Firma). Adres, ilçe, il ya da vergi dairesi eksikse **e-Belge gönderimi durur** (`firmaEbelgeEksikleri`). | G |
| EBLG-63 | **İhraç kayıtlı satışın süre takibi** (2026-09-19, `c452dc4`): son gün teslimi izleyen ay başından itibaren 3 aydır (702 de aynı; mali müşavirle doğrulanmalı). Gümrük beyannamesi girilince takip biter; fatura listesinde "beyannamesi gelmemiş" süzgeci ve bildirim merkezinde 15 gün kala uyarı, süre geçince kritik özet. | G |
| EBLG-64 | **Gönderim sihirbazı üç adımlıdır** (karar 2026-09-19, `a5fdfb3`, `b7367c4`): Kontrol → Bilgiler (türe özel alanlar) → Önizle ve gönder. Son adım belgeyi gönderilecek hâliyle entegratörün önizleme ucundan geçirir (numara/kayıt oluşturmaz); **Gönder** ancak önizleme geçince açılır, önizleme tam ekran açılabilir. Önizleme ile gönderim aynı yoldan üretilir. | G |
| EBLG-65 | **Yurt dışındaki tedarikçiye iade e-Belge ile kesilmez** (karar 2026-09-19, `bfff380`): tedarikçinin fatura adresi yurt dışındaysa sihirbaz ilk adımda durur, sunucu gönderim ve önizlemeyi aynı mesajla reddeder (`YURT_DISI_IADE_ENGELI`). Not: NES şematronu IHRACAT/ISTISNA belgesinde serbest numaralı iade referansını kabul ediyordu; gerekirse bu yol açılabilir. | G |
| EBLG-66 | **KAMU senaryosu** (karar 2026-09-20, `0216ca3`, `a185718`; GİB Kamu e-Fatura Teknik Kılavuzu + şematron 14.09.2026 §4): merkezi yönetim kamu idaresine kesilen e-Fatura `ProfileID=KAMU` ile gider (SATIS, TEVKIFAT, ISTISNA; kamu idaresinden alınan malın iadesi IADE). Alıcı GİB mükellef listesinde `<Type>KAMU</Type>` ise kendiliğinden, listede ÖZEL görünen kurum için cari kartındaki "kamu idaresi" işaretiyle. Belgeye ödemeyi yapacak **harcama biriminin VKN'si ve adı** (`BuyerCustomerParty`; kartta varsayılan, yoksa alıcının kendisi, sihirbazda faturaya yazılır) ve ödemenin yapılacağı **IBAN** (`PaymentMeans` `ZZZ`/`PayeeFinancialAccount`, kendi TRY banka hesaplarımızdan seçilir; şematron deseni + mod-97) yazılır. Kamu alıcısı e-Fatura listesinde yoksa belge e-Arşiv'e düşürülmez, gönderim durur. Kendi PDF'imiz harcama birimini ve IBAN'ı basar. NES testte K072026000000062 test kamu alıcısına 1300 ile teslim edildi. Kural `packages/shared/src/kamu.ts`. | G |
| EBLG-67 | **Yolcu beraberi (tax-free) faturası** (karar 2026-09-20; GİB Gümrük İşlemleri Kılavuzu v1.8 §4 + resmî `XSLT/YOLCUBERABER.xml`): Türkiye'de ikamet etmeyen yolcuya KDV hesaplanarak yapılan satış `ProfileID=YOLCUBERABERFATURA`, `InvoiceTypeCode=ISTISNA` ile Gümrük Bakanlığı'nın **yolcu beraberi kutusuna** (`urn:mail:yolcuberaberpk@gtb.gov.tr`) gider. İşaret **sihirbazda** konur ve cari adresinden türeyen ihracat kararını ezer; satış genel bir perakende cariye kesildiği için alıcının VKN'si aranmaz. Yolcu `BuyerCustomerParty` (`PARTYTYPE`=TAXFREE) içinde bildirilir: ad, soyad, uyruk (ISO2), pasaport no ve veriliş tarihi (bilinmiyorsa 2005-01-01), ikamet şehri ve ülkesi (TR olamaz), isteğe bağlı iade hesabı. KDV iadesini yapacak **aracı kurum** `TaxRepresentativeParty` içinde zorunludur (VKN, posta kutusu etiketi, unvan); varsayılanı firma kartında durur (Ayarlar › Firma), sihirbazda faturaya özel değiştirilir. KDV hesaplanır ve tahsil edilir; belge düzeyindeki KDV alt toplamı **501** kodu ve açıklamasıyla işaretlenir, sıfır KDV'li ya da tevkifatlı satır kabul edilmez. Gümrük onayı ve uygulama yanıtı aracı kuruma gider, satıcıya dönen yanıt yoktur; satış iptali/iadesi ayrıca GİB'in Tax-Free Satış İptal/İade Bildirim Portalı'ndan bildirilir (sistem dışı). Kendi PDF'imiz yolcuyu, aracı kurumu ve 501 ibaresini basar. NES testte K072026000000066 kabul edildi. Kural `packages/shared/src/yolcu-beraberi.ts`. | G |
| EBLG-68 | **Gönderim tarihi Türkiye gününe göre denetlenir** (hata 2026-09-20): "fatura tarihi bugün ya da en çok 7 gün önce" kuralı, gün başı UTC olarak saklanan fatura tarihini o anki zamanla karşılaştırıyordu; Türkiye'de gece yarısı ile 03:00 arasında kesilen **bugünkü** fatura "gelecek tarihli" sayılıp gönderilemiyordu. Karşılaştırma artık Türkiye takvimindeki gün üzerinden yapılır. | A |
| EBLG-69 | **Özel matrah faturası** (karar 2026-09-20, `08cf89c`, `b1d4216`; KDV Kanunu 23. madde, GİB resmî örneği `docs/e-belge/…/UBL-TR 1.2.1/XSLT/OZELMATRAH.xml` + UBL-TR Kod Listeleri v1.26 + saha örneği `docs/e-belge/matrah.jpeg`): verginin matrahı satış bedeli değil, maddede sayılan **özel matrahtır** — KDV'siz alınan ikinci el araç/taşınmazda alış ile satış farkı (812), gümrük deposu/müzayedede komisyon (804), bayi işlerinde sıfır. Senaryo (`InvoiceTypeCode`) OZELMATRAH olur, **profil normal kalır** (TEMELFATURA/TICARIFATURA). Kod, matrah ve oran **fatura formunda** girilir — sihirbazda değil: toplamları anlatırlar ve e-Arşiv'de de geçerlidirler. Kod listesi 801…812'dir. **Satıra KDV hariç bedel yazılır** (karar 2026-09-20, saha örneğiyle karşılaştırmadan sonra): özel matrahın KDV'si satır toplamının üzerine eklenir, genel toplam ve cari borç bu toplamdır — alıcının defterinde net bedel ile KDV ayrışsın diye. Örnek: 92.000'e alınan araç 95.500'e satılır → satır 95.465,35, özel matrah 3.465,35, %1 KDV 34,65, ödenecek 95.500. Matrahı kullanıcı yazar; **"KDV dahil kâr farkı" yardımcısı** farkın içindeki KDV'yi iç yüzdeyle ayırır (3.500 · %1 → 3.465,35), çünkü satıcı alış/satış bedeliyle düşünür. UBL: belge düzeyinde tek `TaxSubtotal` (özel matrah, oranı ve `TaxExemptionReasonCode` 8xx), `TaxExclusiveAmount` satır toplamı, `TaxInclusiveAmount` = `PayableAmount` = satır toplamı + KDV. **Satır düzeyine de kendi payı yazılır** (karar 2026-09-20): alıcının gördüğü görünümdeki "özel matrah nedeni/tutarı" ve satır KDV sütunları böyle dolar; belgeye girilen tek matrah satırlara tutarları oranında bölünür, kuruş farkı son satıra bırakılır (`ozelMatrahSatirPaylari`). Kurallar tek yerdedir (`packages/shared/src/ozel-matrah.ts`) ve hem zod şeması hem fatura ekranı aynı listeyi üretir: yalnız satış faturasında, tanımsız kod yok, matrah eksi olamaz ve satış bedelini aşamaz, matrah sıfırdan büyükse oran zorunlu, satırların KDV oranı sıfır olmalı ve tevkifatlı satır bulunamaz. Sıfır KDV'li satır bu belgede **istisna kodu istemez** — sebebi belge düzeyindeki özel matrah kodudur. Kendi PDF'imizde toplam kutusu "Mal/Hizmet Toplamı" + "Hesaplanan KDV (özel matrah %x)" yazar, belge altı ibaresi kodu, matrahı ve oranı basar. **NES testte kabul edildi:** K072026000000067 (ilk kurgu) ve yeni kuralla K072026000000068 — ikincisinin entegratör görünümü saha örneğiyle birebir (satırda %1,00 · 34,65 · 812 · 3.465,35; toplamlar 95.465,35 → 34,65 → 95.500,00), cari borcu 95.500. | G |
| EBLG-70 | **SGK faturası** (karar 2026-09-20; SGK e-Fatura Uygulama Kılavuzu ve e-Fatura Teknik Doküman 29.09.2017 v1.0): Sosyal Güvenlik Kurumu'na (VKN **7750409379**, Çankaya VD) kesilen satış faturası `InvoiceTypeCode=SGK` ile gider. **Karar alıcının VKN'sinden türer**, kartta işaret aranmaz; SGK e-Fatura mükellefi olduğundan belge e-Arşiv'e düşerse gönderim durur. Senaryo **TEMELFATURA'ya zorlanır** (kılavuz §1: "Temel Fatura Senaryosu üzerinden yürütülecektir"); cari kartında ticari seçili olsa bile belge temel gider. Belgeye beş ek alan yazılır: **ilave fatura tipi** (`cbc:AccountingCost`; SAGLIK_ECZ / SAGLIK_HAS / SAGLIK_OPT / SAGLIK_MED / ABONELIK / MAL_HIZMET / DIGER), **mükellef kodu**, **mükellef adı** ve **dosya no** (üçü ayrı `cac:AdditionalDocumentReference`; değer `DocumentType`, alan adı `DocumentTypeCode`, anlamı `DocumentDescription`) ve **dönem** (`cac:InvoicePeriod` StartDate/EndDate). Zorunluluk gruba göredir: mükellef kodu/adı yalnız sağlık hizmeti sunucularında (Kurum'da kayıt yoksa `0000` / ruhsattaki ad), dosya no DİĞER dışında her grupta (hastanede MEDULA evrak referans no, abonelikte abone no, mal/hizmette harcama referans no — yoksa harcama birim no), dönem MAL_HIZMET ve DİĞER dışında. Gruba girmeyen alan belgeye **hiç yazılmaz**. Sabit alanların (grup, kod, ad) varsayılanı **firma kartındadır** (Ayarlar › Firma), dosya no ve dönem her faturada **sihirbazda** girilir; kural tek yerdedir (`packages/shared/src/sgk.ts`) ve sihirbaz ile gönderim aynı listeyi üretir. Kendi PDF'imiz bu alanları belge altına basar. **NES testte K072026000000069 (MAL_HIZMET) kabul edildi;** eczane (SAGLIK_ECZ, tam alan kümesi) önizlemeden geçti. Kural `packages/shared/src/sgk.ts`. | G |
| EBLG-71 | **Elektrikli araç şarj faturası** (karar 2026-09-20; şematron 14.09.2026 §1, `docs/e-belge/SEMATRONDEGISIKLIKLERI_484.pdf`): araca verilen şarj hizmeti `InvoiceTypeCode=SARJ`, şarj ünitesi/işletmeciliği satışı `SARJANLIK` tipiyle gider; ikisi de e-Arşiv'de geçerlidir. **Tür seçilmez, stok kartından türer** (S-01): hizmet/ürün kartına konan "Elektrikli araç şarjı" işareti satıra düştüğünde belgenin tipi kendiliğinden oluşur. İki tür aynı belgede karışamaz — belge tek `InvoiceTypeCode` taşır, karışık fatura hem ekranda hem sunucuda durdurulur. Her iki tipte **aracın plakası** (`PLAKA` schemeID) ile şarjın **başlangıç ve bitişi** (`InvoicePeriod`, `StartDate`/`StartTime`/`EndDate`/`EndTime`) zorunludur; plaka kuralı irsaliyedekinden gevşektir (büyük harf, rakam, `_` ve `-`; il kodu aranmaz, yabancı plakalı araç da şarj olur). SARJ'da ayrıca en az bir **ESU rapor kimliği** (GUID; `AdditionalDocumentReference`, `schemeID="ESURaporID"`), SARJANLIK'ta her satırda **ünite seri numarası** (`ItemInstance/SerialID`) aranır. Plaka, süre ve ESU raporları **sihirbazda**, ünite seri numarası **fatura satırında** girilir. Kendi PDF'imiz plakayı, süreyi, rapor kimliklerini ve seri numaralarını belge altına basar. **Profil `ENERJI`'dir** (bulgu 2026-09-20, NES test gönderimi): şematron değişiklik belgesi profili yazmıyor ama NES "cbc:ProfileID değeri ENERJI olduğu durumda cbc:InvoiceTypeCode değeri SARJ veya SARJANLIK olmalıdır" diyerek TEMELFATURA+SARJ belgesini reddetti; e-Arşiv'e düşen şarj faturasında profil EARSIVFATURA kalır ve tip yine SARJ'dır. **NES testinde kabul edildi:** K072026000000078 (SARJ, ENERJI), K072026000000079 (SARJANLIK) ve e-Arşiv SNC2026000000020 (SARJ). Kural `packages/shared/src/sarj.ts`; sihirbaz, fatura formu ve gönderim aynı listeyi üretir. | G |
| EBLG-72 | **İDİS (İnşaat Demiri İzleme Sistemi) fatura ve irsaliyesi** (karar 2026-09-20; GİB "İDİS Kapsamında Yapılan Teslimlere İlişkin Fatura ve İrsaliye Teknik Kılavuzu" v1.0 Aralık 2025, `docs/e-belge/IDIS-Teknik-Kilavuzu-v1.0.pdf`; sevkiyat no biçimi şematron 14.09.2026 §2 ile genişledi): Darphane'ye İDİS üzerinden bildirimi yapılan teslimde belge **profili** `IDIS` (e-İrsaliye `IDISIRSALIYE`) olur; `InvoiceTypeCode` normal kurallarla türer (SATIS, ISTISNA, TEVKIFAT, TEVKIFATIADE, IADE, IHRACKAYITLI) — İDİS bir profildir, fatura tipi değil. Ayrı bir işaret yoktur: **sevkiyat numarası girildiyse belge İDİS kapsamındadır**. Sevkiyat numarası satıcının `PartyIdentification`'ına `schemeID="SEVKIYATNO"` ile (kılavuz `SE-` + 7 rakam der, şematron `ES-` önekini de kabul eder), **etiket numarası** her satırın `Item/AdditionalItemIdentification`'ına `schemeID="ETIKETNO"` ile yazılır (2 harf + 7 rakam). Faturada ikisi de **fatura formunda** girilir, sihirbaz yalnız eksikleri gösterir; irsaliyede sevkiyat numarası **taşıma bilgisi panelinden de** girilebilir, çünkü numara Darphane bildiriminden çoğu zaman onaydan sonra döner. İrsaliyeden faturaya dönüşümde etiket numaraları taşınır. Alıcı e-Fatura mükellefi değilse belge e-Arşiv'e düşer ve profil `EARSIVFATURA` olur — İDİS senaryosu yalnız e-Faturada tanımlıdır — ama sevkiyat/etiket numaraları belgede taşınmaya devam eder. Kendi PDF'imiz sevkiyat ve etiket numaralarını basar. **NES testinde kabul edildi (2026-09-20):** fatura K072026000000080 (`ProfileID=IDIS`, tip SATIS) ve e-İrsaliye GBZ2026000800009 (`ProfileID=IDISIRSALIYE`, sevkiyat SE-1345840, etiket CV0152457). Kural `packages/shared/src/idis.ts`; fatura, irsaliye ve gönderim aynı listeyi üretir. | G |
| EBLG-73 | **Vade ve sipariş referansı e-Belgeye yazılır** (karar 2026-09-20; GİB resmî örneği `UBL-TR 1.2.1/XSLT/TicariFaturaOrnegi.xml` + genel görünüm `XSLT/general.xslt`): faturadaki **vade tarihi** artık belgeye `cac:PaymentTerms` içinde gider — `cbc:PaymentDueDate` makine için, `cbc:Note` ("Son ödeme tarihi: gg.aa.yyyy") alıcının gördüğü sayfa için; GİB'in genel XSLT'si **yalnız Note'u basar**, tarih tek başına yazılırsa görünümde hiç çıkmaz. Vade boşsa blok hiç yazılmaz, e-Arşiv'de de aynı şekilde taşınır. **Sipariş numarası ve tarihi** zaten `cac:OrderReference` ile gidiyordu ama tarih boş bırakılabiliyordu; **hata (2026-09-20, NES denemesi):** tarihsiz referans `FAILED_XML_SCHEMA_CHECK — 'OrderReference' … has incomplete content` ile reddediliyor. UBL-TR'de `IssueDate` zorunlu olduğu için sipariş tarihi girilmemişse belgeye **fatura tarihi** yazılır (fatura ekranı bunu satır altında söyler); böylece kesinleşmiş, tarihsiz sipariş nolu fatura gönderimde kilitlenmez. Gelen belgeden okurken vade üç yerden aranmaya devam eder (`PaymentMeans/PaymentDueDate`, `PaymentTerms/PaymentDueDate`, `SettlementPeriod/EndDate`) — sahada iki kullanım da görülüyor. | A |
| EBLG-74 | **e-İrsaliyede sipariş referansı** (karar 2026-09-20; GİB `UBL-TR 1.2.1/XML/DespatchAdvice.xml`): irsaliye de `cac:OrderReference` taşır — şemadaki yeri `DespatchAdviceTypeCode`/`LineCountNumeric` ile `Signature` arasıdır. Referans **iki kaynaktan** gelir: belgeye elle girilen **müşteri sipariş no/tarihi** (yeni alanlar, irsaliye formunda Sevkiyat bölümünde), yoksa irsaliyenin **türediği sipariş belgesinin** numarası ve tarihi — zincirden gelen irsaliyede kullanıcı hiçbir şey girmeden doğru referans gider. Fatura tarafındaki kuralın aynısı geçerlidir (EBLG-73): `IssueDate` zorunlu olduğu için tarih boşsa **belgenin tarihine** düşülür. Referans yoksa blok hiç yazılmaz. Sipariş referansı belge faturaya dönüşürken faturaya da taşınır ve irsaliye detayında özet satırında görünür. | G |
| EBLG-75 | **"e-Belge PDF" resmî görünümü entegratörden gelir** (hata 2026-09-20): düğme, alıcının gördüğü resmî belgeyi değil bizim **yedek görünümümüzü** basıyordu. Sebep: belgeye XSLT gömmüyoruz (EBLG-31 kararı, tasarım entegratörün işi), dolayısıyla arşivlenen UBL'de gömülü görünüm yok ve `EbelgeGorunumService` doğrudan yedek görünüme düşüyordu. Artık önce **sağlayıcıdan** indirilir — NES'te e-Fatura `/einvoice/v1/outgoing/invoices/{uuid}/pdf`, e-Arşiv `/earchive/v1/invoices/{uuid}/pdf` (ikincisi swagger'da yok, denenerek bulundu); `uuid` bizim fatura kimliğimizdir, UBL'e `cbc:UUID` olarak o yazılır. Gelen belge GİB logosu, karekodu, ETTN'si ve "e-Fatura" ibaresiyle alıcının gördüğünün aynısıdır. İndirme başarısızsa (uç yok, yetki yok, sağlayıcı erişilemiyor) **eski yedek görünüm** basılmaya devam eder — belge görüntülemek entegratöre bağlı olmamalı. Adaptör yöntemi `gidenBelgePdf` isteğe bağlıdır; uygulamayan sağlayıcıda tanımsız kalır. | A |
| EBLG-76 | **Fatura–e-İrsaliye eşleşmesi ve irsaliye yerine geçen fatura** (karar 2026-09-21; UBL-TR Fatura v0.4 §2.3.22/§2.3.33): Firma **e-İrsaliye mükellefiyse**, fiziksel mal içeren satış faturasında sihirbaz sevkiyatın nasıl belgelendiğini sorar ve üç yoldan biri seçilmeden belge gönderilmez: **(a) e-İrsaliye düzenlendi** — aynı müşteriye gönderilmiş irsaliyeler seçilir, no/tarihleri faturaya `cac:DespatchDocumentReference` ile yazılır; **(b) fatura sevkten önce düzenleniyor** — sonradan kesilen e-İrsaliye irsaliye formundan bu faturaya bağlanır ve irsaliyeye `cac:AdditionalDocumentReference` + `DocumentType=FATURA` ile fatura no/tarihi gider; **(c) mal fatura beraberinde sevk edildi** — hiç irsaliye düzenlenmez, faturaya fiili sevk tarih+saati `cac:Delivery/cac:Despatch/ActualDespatchDate+ActualDespatchTime` ile ve "Mal e-Fatura beraberinde sevk edildiğinden ayrıca e-İrsaliye düzenlenmemiştir. Bu fatura irsaliye yerine geçer." ibaresi `cbc:Note` ile yazılır. **İbare şarttır:** GİB'in genel XSLT'si sevk alanlarını basmaz, yalnız notu basar (EBLG-73'te vade tarihinde aynı tuzağa düşmüştük); alıcı mükellef değilse belge e-Arşiv'e düşer ve ibare o belgenin adını söyler. Sevk anı sihirbazda girilir, varsayılanı gönderim anıdır; kendi yedek görünümümüz ibareyi ve sevk anını belgeden okuyup basar (`ubl-oku` artık `cbc:Note` ve `Despatch` okur). **Sevk saati Türkiye saatiyle yazılır** (hata 2026-09-22, NES denemesi): tarih/saat `toISOString()` ile UTC yazılıyordu — 09:30'da çıkan mal belgede 06:30'da çıkmış görünüyor, gece 00:00–03:00 arası sevkte gün de geri kayıyordu. Aynı hata e-İrsaliyenin `ActualDespatchDate/Time`'ında ve şarj faturasının dönem saatlerinde (EBLG-71) de vardı; üçü de `anTR` (`packages/shared/src/tarih.ts`) kullanır. Kural **satıcının** mükellefiyetine bağlı olduğu için e-Arşiv'e düşen belgede de aynı işler; firma mükellef **değilse** bölüm hiç gösterilmez ve hiçbir kontrol çalışmaz. Mükellefiyet firma ayarından elle belirlenir (`tenants.eirsaliye_mukellefi`), boşsa entegratörün GİB mükellef listesinden okunur; liste yoksa ya da 48 saatten eskiyse durum "bilinmiyor" sayılır ve gönderim durur — listeye güvenip sessizce "mükellef değil" saymak irsaliyesiz fatura göndermek olurdu. Kural `packages/shared/src/sevkiyat.ts`, mükellefiyet `apps/api/src/ebelge/eirsaliye-mukellefiyeti.ts`; fatura `faturalar.sevkiyat_yontemi` + `fiili_sevk_zamani` alanlarını taşır. | G |
| EBLG-77 | **Firma e-belge uygulamaları: e-Fatura / e-Arşiv / e-İrsaliye** (karar 2026-09-21): Uygulama bugüne kadar her kiracıyı e-Fatura mükellefi saydı; oysa yalnız e-Arşiv kullanan, hatta hiçbir e-belge uygulamasına kayıtlı olmayan (kağıt fatura kesip programı ön muhasebe olarak kullanan) firmalar da var. Firma kartına üç ayar geldi — her biri **Otomatik / Evet / Hayır**. Otomatikte firmanın **kendi VKN'si** GİB mükellef listesinde aranır; **e-Arşiv listesi GİB'de yayınlanmadığı için** otomatikte e-Fatura mükellefiyetini izler (e-Fatura mükellefi zorunlu e-Arşiv mükellefidir), yalnız e-Arşiv kullanan firma durumu elle söyler. **e-İrsaliye e-Fatura'ya kayıtlı olmayı gerektirir:** e-Fatura kapalıyken e-İrsaliye elle "evet" denmiş olsa bile kapalıdır (EBLG-76 sevkiyat sorusu da sorulmaz). **Kanal kararında satıcının kapsamı alıcınınkinden önce gelir:** e-Fatura kapalıysa alıcı mükellef olsa bile belge **e-Arşiv**'dir ve alıcının mükellef listesi hiç sorulmaz; ihracat ve yolcu beraberi yalnız e-Fatura mükellefinde düzenlenebilir; ikisi de kapalıysa e-belge gönderimi yoktur, "e-Fatura Oluştur" düğmesi çıkmaz ve fatura kendi şablonumuzla (FTR-22…25) kağıda basılır. **Durum "bilinmiyor" ise gönderim durur** (liste hiç çekilmemiş ya da 48 saatten eski ve firma ayarı boş): alıcıya bakarak e-Arşiv'e düşmek, firma aslında mükellefse mükellef alıcıya yanlış belge kesmek olurdu. Kapalı uygulamanın **ekranları menüden kalkar** (`apps/web/src/lib/ebelge-yollari.ts`, `/ebelge/uygulamalar` ucundan okunur) ve **uçları reddedilir** (`@EbelgeUygulamasi` dekoratörü + `EbelgeUygulamasiGuard`, `RollerGuard` kalıbı): e-Fatura kapalıysa gelen kutusu, gelen belge çekme, kabul/ret yanıtı, mükellef listesi ve senkronu; e-Arşiv kapalıysa iptal bildirimi ve raporlar; e-İrsaliye kapalıysa `ebelge/irsaliye` denetleyicisinin tamamı. Kural `packages/shared/src/ebelge-uygulamalari.ts`, çözüm `apps/api/src/ebelge/ebelge-uygulamalari.service.ts`; alanlar `tenants.efatura_mukellefi`, `earsiv_mukellefi`, `eirsaliye_mukellefi`. Periyodik işler de kapsama uyar: gelen belge taraması yalnız e-Fatura, e-İrsaliye durum sorgusu yalnız e-İrsaliye açıkken kuyruğa girer, mükellef listesi hiçbir kiracı e-Fatura kullanmıyorsa indirilmez. e-SMM/e-MM kapsam dışıdır. | G |
| EBLG-78 | **Yatırım teşvik belgeli (YTB) fatura** (karar 2026-09-21; GİB "Yatırım Teşvik Kapsamında Yapılan Teslimlere İlişkin Fatura Teknik Kılavuzu" **v1.2**, Ocak 2026 — `docs/e-belge/Yatirim-Tesvik-Fatura-Teknik-Kilavuzu-v1.2.pdf`; v1.1 GİB'in kılavuz listesinde hâlâ görünüyor, v1.2'ye ancak dosya adı tahmin edilerek ulaşıldı): YTB bir **profildir**, fatura tipi değil — İDİS kalıbının (EBLG-72) aynısı. Ayrı işaret yoktur: **teşvik belge numarası girildiyse fatura YTB kapsamındadır.** e-Faturada `ProfileID=YATIRIMTESVIK` ve tip normal kurallarla türer (SATIS, ISTISNA, TEVKIFAT, TEVKIFATIADE, IADE); belge **e-Arşiv'e düşerse** profil `EARSIVFATURA` olur ve **tipin başına `YTB` gelir** (YTBSATIS, YTBISTISNA, YTBTEVKIFAT, YTBTEVKIFATIADE, YTBIADE). Teşvik belge no ve tarihi `cac:ContractDocumentReference` içinde `<cbc:ID schemeID="YTBNO">` + `IssueDate` ile gider. Her satırda **harcama tipi** `Item/CommodityClassification/cbc:ItemClassificationCode` ile yazılır (01 makine-teçhizat/yazılım/gayrimaddi hak, 02 inşaat işleri, 03 arsa-arazi, 04 diğer) ve belgede **en az bir satırda** bulunmak zorundadır; **01**'de ayrıca makine adı `Item/ModelName` (v1.2'de `Item/Name`'den taşındı), makine ID `ItemInstance/SerialID` ve teçhizat sıra no `ItemInstance/ProductTraceID` zorunludur. Kurallar: 01 ve 02 KDV'siz düzenlenebilir ama o zaman tip yalnız ISTISNA/YTBISTISNA ve istisna kodu **01 → 308**, **02 → 339** olur; **03 ve 04 KDV'siz düzenlenemez**. **Vazgeçilen KDV** (kılavuz §2.1.4): istisnalı YTB faturasında alınmayan KDV, satırın kendi oranından değil **stok kartındaki normal orandan** hesaplanıp alt toplama yazılır ve `<cbc:CalculationSequenceNumeric>-1</cbc:CalculationSequenceNumeric>` ile fatura toplamına katılmayacağı söylenir; belge toplamı KDV'siz kalır. Alanlar **fatura formunda** girilir (belge no/tarihi başlıkta, harcama tipi ve makine bilgileri satır ayrıntısında), sihirbaz yalnız eksikleri gösterir. Kendi PDF'imiz teşvik belge no/tarihini, satır harcama tiplerini ve makine kimliklerini basar. E-TUYS liste doğrulaması (etuys.sanayi.gov.tr) kullanıcının sorumluluğundadır, uygulama sorgulamaz. Kural `packages/shared/src/ytb.ts`; alanlar `faturalar.ytb_no`, `ytb_tarihi` ve `fatura_satirlari.ytb_harcama_tipi`, `ytb_makine_adi`, `ytb_makine_id`, `ytb_makine_sira_no`. **Ön koşul olarak kod listesi 1.17'den 1.43'e çekildi** (GİB `UBLTR_1.2.1_Kilavuzlar.zip`, Temmuz 2026): tam istisna 329–344 ve kısmi istisna 241–242 eklendi, 307 ile 318'in adları kılavuzdaki tam metinle değiştirildi. **NES testinde kabul edildi (2026-09-22):** K072026000000087 (YATIRIMTESVIK/SATIS, makine satırı), SNC2026000000022 (e-Arşiv **YTBTEVKIFAT** — NES'in swagger'ı bu tipi listelemiyor ama kabul ediyor), K072026000000088 (YATIRIMTESVIK/ISTISNA 308, vazgeçilen KDV). Denemede çıkan iki kural: **teşvik belge numarası 6 haneli sayıdır** — kılavuz yalnız örnek veriyor, şematron "6 Haneli Yatırım Teşvik Numarası olmalıdır" diye reddetti, kural fatura kaydında çalışır; **vazgeçilen KDV kalemde de yazılır** — satırın vergi alt toplamı da vazgeçilen tutarı, `-1`'i ve stok kartındaki oranı taşır, yoksa şematron "Kalem Bazında KDV Oranı ve Değeri girilmelidir" der. YTBTEVKIFATIADE denenmedi. | G |

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
| STK-22 | **İptal edilen faturanın stok hareketleri varsayılan olarak gizlenir** (karar 2026-09-15, CARI-22 ile aynı kural). Stok kartının Hareketler sekmesi, "Ürün hareketleri" raporu ve "Stok hareket özeti" raporu iptal edilmiş faturanın çıkış/giriş hareketini, iptalin ters hareketini ve varsa telafisini göstermez ya da saymaz; **"İptalleri de göster"** seçeneği (raporlarda filtre) işaretlenince görünür. Gösterildiğinde satırlar soluk ve "İptal" rozetli, raporda açıklamaya "(iptal)" eklenir. Çift sıfırlandığı için bakiye ve net değişim seçimden etkilenmez; özet raporda gizlemek giriş/çıkış sütunlarının şişmesini önler. | G |

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
| RPR-08 | **Modül ekran standardı:** Her iş modülünde ayrı bir "Düzeltme/İşlemler" ve "Raporlar" ekranı bulunmalıdır. Düzeltme ekranı hatalı, eksik veya bekleyen kayıtları filtreleyebilmeli; kayıt ayrıntısına, düzeltme eylemine ve yeniden işleme akışına doğrudan erişim vermelidir. Raporlar ekranı tarih aralığı, durum, kullanıcı, cari/ürün ve modüle özgü filtreleri desteklemeli; sonuçların kaynağı, hesaplama dönemi ve dışa aktarım zamanı gösterilmelidir. | Z |

**Modül ekran matrisi (RPR-08):**

| Modül | Düzeltme/İşlemler ekranı | Raporlar ekranı |
|---|---|---|
| Cari | Hatalı/eksik kart bilgileri, bloke durumu, vade ve risk koşulları, içe aktarma hataları | Ekstre, yaşlandırma, bakiye, tahsilat performansı, en yüksek riskli cariler |
| Satış/Fatura | Taslak ve hatalı e-belgeler, eksik cari/ürün, risk limiti uyarıları, yeniden gönderim | Satış/alış özeti, kâr marjı, KDV, iskonto, iade, açık tahsilat ve bekleyen belgeler |
| e-Fatura/e-Arşiv | Kuyruk, gönderim hatası, ret/kabul yanıtı, günlük e-Arşiv raporu ve yeniden deneme | Gönderim durumu, hata/ret analizi, kanal ve dönem bazlı belge raporu |
| Stok | Sayım farkları, eksi stok uyarıları, hatalı hareketler, ürün/barkod eksikleri | Envanter, hareket, kritik stok, devir hızı, kârlılık, fire/zayi ve sipariş önerisi |
| Kasa/Banka | Eşleşmeyen ekstre satırları, hatalı fişler, başarısız ödeme/talimatlar | Hesap hareketi, bakiye, tahsilat/ödeme, mutabakat, komisyon ve nakit akışı |
| Pazaryeri/POS | Senkronizasyon, ürün eşleme, stok/fiyat, callback ve başarısız tahsilat işlemleri | Sipariş, ciro, komisyon, iade, kanal ve sağlayıcı performansı |

RPR-08 kapsamındaki her düzeltme eylemi sunucu tarafında yetki, durum ve
idempotensi kontrolünden geçmeli; başarılı/başarısız sonuçlar denetim izine
yazılmalı ve kullanıcıya neden ile sonraki önerilen adım gösterilmelidir.

**Döviz kuru kaynağı:** USD ve EUR gösterge kurları TCMB EVDS3 REST servisinden
sunucu tarafında alınır. API anahtarı yalnızca `TCMB_EVDS_API_KEY` ortam
değişkeninde tutulur. Belge tarihinde kur yayımlanmamışsa önceki iş gününün kuru
kullanılır; kaynak tarih kullanıcıya gösterilir ve alınan değerler veritabanında
önbelleğe alınır. EVDS erişilemezse kullanıcı manuel kur girebilir.
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
| KLN-08 | ✅ Abonelik ve paket yönetimi: plan kataloğu, dönem/durum, faturalama iletişimi, kullanım limitleri, plan değişimi, iptal/yeniden etkinleştirme ve değişiklik geçmişi. Ödeme sağlayıcısı entegrasyonu ayrıca bağlanabilir. | G |

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
| AYR-08 | **Düzeltme standardı:** Her modülün düzeltme ekranı, yalnızca düzenlenebilir durumdaki kayıtları gösterir; kesinleşmiş kayıtlar için ters kayıt/iptal/kopyalama akışını kullanır. Hatalı entegrasyon ve içe aktarma kayıtlarında yeniden işleme idempotent olmalı, hata nedeni ve düzeltme önerisi gösterilmelidir. | Z |

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

### 3.10 Bildirim ve Görev Merkezi (BLD)

Paket öncesinde zil menüsü iki API özetini (`/fatura/is-kuyrugu-ozeti`,
`/duzeltmeler/ozet`) tarayıcıda birleştirip 15 dakikada bir yeniliyordu. Kalıcı
bildirim kaydı, okundu durumu, kullanıcı tercihi ve sahiplenme yoktu; bu yüzden
kritik bir olayın kullanıcıya **teslim edildiği ve sahiplenildiği**
kanıtlanamıyordu. Bu bölüm o katmanı tanımlar.

**Durum (2026-09-06): tamamlandı.** `Bildirim` olayı, `BildirimTeslimati` ise
olayın tek bir kullanıcıdaki durumunu tutar; e-posta kanalının durumu ve deneme
sayısı aynı satırdadır, böylece yeniden başlatma bir mesajı ne kaybedebilir ne
de iki kez gönderebilir. Zil menüsü artık bu kayıtlardan beslenir
(`/panel/bildirimler`, tercihler `/panel/ayarlar/bildirimler`).

**S-01 kapı kararları (2026-09-05, kullanıcı onayı):**

1. **Görev kapsamı:** ayrı `Gorev` modeli **yok**. Sahiplenme bildirimin
   üzerinde tutulur (üstlen → aksiyon alındı / yok say + son tarih). Elle görev
   açma ve yorum akışı kapsam dışıdır; düzeltme merkezindeki mevcut atama/SLA
   deseniyle kavram çakışması bu sayede olmaz.
2. **Kanallar:** uygulama içi + e-posta. SMS kapsam dışı (Netgsm adaptörü POS
   modülünde mevcut; kritik olaylar için sonraki pakete bırakıldı).
3. **Kaynak olaylar:** dört grubun tamamı — düzeltme/e-belge, vade ve tahsilat,
   stok ve dönem, entegrasyon hataları.
4. **Teslim:** uygulama içi bildirimler **yoklama ile** tazelenir, aralık 15
   dakikadan **60 saniyeye** çekilir. SSE/WebSocket kapsam dışı — çok kiracılı
   bağlantı yönetimi ve ölçekleme maliyeti bu paketin kazancını aşıyor.

| No | İster | Öncelik |
|---|---|---|
| BLD-01 | Kritik olaylar kalıcı bildirim kaydı üretmelidir: tür, önem (bilgi/uyarı/kritik), başlık, açıklama, kaynak modül ve kayıt referansı, kaynağa götüren yol, oluşma zamanı. **Tamamlandı** — `bildirimler` tablosu tür, önem, başlık, açıklama, kaynak modül/ref ve `hedefYol` alanlarını tutar. | G |
| BLD-02 | Bildirim, rolüne göre belirlenen hedef kullanıcılara ayrı teslimat kaydı olarak düşmelidir; okundu, üstlenildi, aksiyon alındı ve yok sayıldı durumları kullanıcı bazında tutulmalıdır. **Okundu ile aksiyon alındı ayrı ölçülür.** **Tamamlandı** — `bildirim_teslimatlari` hedef kullanıcı başına bir satır; `yeni/okundu/ustlenildi/aksiyon_alindi/yoksayildi` ayrı izlenir, aksiyon notu kaydedilir. | G |
| BLD-03 | Aynı kaynak kayıt için ikinci bir bildirim üretilmemelidir (birleştirme anahtarı); olay sürüyorsa mevcut kayıt güncellenir, çözülmüşse kendiliğinden kapanır. **Tamamlandı** — `birlesimAnahtari` ile tek kayıt; olay sürerken metin tazelenir, tespit edilmeyince kayıt kendiliğinden kapanır. Son tarih yeniden tespitte **bilerek** ilerletilmez, aksi halde SLA hiç dolmazdı. | G |
| BLD-04 | Kullanıcı, olay türü bazında uygulama içi ve e-posta kanallarını kapatabilmeli; sessiz saat aralığı tanımlayabilmelidir. Sessiz saatte üretilen bildirim kaydedilir, e-postası aralık bitince gönderilir. **Tamamlandı** — tür bazında kanal kapatma ve sessiz saat `/panel/ayarlar/bildirimler` ekranında; sessiz saatte biriken e-posta aralık bitince ilk taramada gönderilir. | G |
| BLD-05 | Kritik bildirim, son tarihine kadar aksiyon almazsa yöneticiye yükseltilmelidir (escalation). **Tamamlandı** — son tarihi geçmiş, kimsenin üstlenmediği kritik bildirim yöneticilere bir kez yükseltilir (`yukseltildiAt`). | G |
| BLD-06 | E-posta teslimatı kayıt altına alınmalı (gönderildi/hata, deneme sayısı) ve hata durumunda kalıcı kuyrukta yeniden denenmelidir. **Tamamlandı** — `epostaDurumu`/`epostaDenemeSayisi`/`epostaHatasi` teslimat satırında; azami denemeye kadar sonraki taramada yeniden denenir, sonrasında `hata` olarak kalır. | G |
| BLD-07 | Zil menüsü kalıcı kayıttan beslenmeli; ayrıca filtrelenebilir bir bildirim ekranı (`/panel/bildirimler`) bulunmalıdır: önem, durum ve tür filtresi, okundu işaretleme, üstlenme, kaynağa gitme. **Tamamlandı** — zil menüsü kalıcı kayıttan beslenir ve 60 saniyede tazelenir; `/panel/bildirimler` önem, durum ve tür filtresi, okundu işaretleme, üstlenme, aksiyon ve kaynağa gitme sunar. | G |
| BLD-08 | Bildirim kaynakları: kritik düzeltme kaydı ve SLA aşımı; e-belge hata/ret ve dead-letter; geciken alacak/borç ve vadesi yaklaşan çek/senet; kritik seviye altı stok ve onaysız sayım; başarısız dönem kapatma kontrolü; pazaryeri/POS/banka entegrasyon hataları. **Tamamlandı** — sahibi olması gereken istisnalar (kritik düzeltme, e-belge hatası, kapanamayan dönem) tek tek; tarama artık tespit etmediği bildirimi kapatırken **yalnız kendi ürettiği anahtarlara** dokunur — aynı türde olay anında üretilen bildirimler (alıcı reddi, raporlanmış e-Arşiv iptali, eksik kira kuru) kullanıcı kapatana kadar açık kalır (düzeltme 2026-09-15; öncesinde ilk taramada sessizce kapanıyordu); yüksek hacimli liste olayları (geciken alacak/borç, vadesi yaklaşan çek/senet, kritik altı stok, onaysız sayım) günde bir kez özetlenir. Dış sistem kaynaklı düzeltme kayıtları `entegrasyon` türüne düşer. Geciken tutarlar RaporService'ten okunur, böylece zil ile rapor çelişemez. | G |
| BLD-09 | Bildirim ve teslimat kayıtları kiracı yalıtımına (RLS) tabidir; kullanıcı yalnız kendi teslimatlarını, yönetici firma genelini görebilir. **Tamamlandı** — dört tabloda da `FORCE ROW LEVEL SECURITY` + kiracı politikası; kullanıcı yalnız kendi teslimatlarını, yönetici firma genelini görür. | G |
| BLD-10 | Bildirim üretimi zamanlanmış tarama ile çalışmalı, tarama süresi ve üretilen kayıt sayısı metrik olarak yayımlanmalıdır. **Tamamlandı** — zamanlanmış tarama `notification_scan_duration_seconds`, `notification_scan_runs_total`, `notification_scan_tenant_total`, `notification_deliveries_total` ve `notification_emails_sent_total` metriklerini yayımlar. | G |

---

### 3.11 Nakit Akışı Tahmini (NAK)

**S-01 kapı kararları (2026-09-11, kullanıcı onayı):** Bütçe ve nakit akışı
modülünün ilk paketi nakit akışı tahminidir; bütçe (plan/gerçekleşen) ikinci
pakette ayrıca netleştirilir. Tahmin mevcut kayıtlardan üretilir: fatura,
çek/senet, masraf, kira, kredi kartı taksiti, bordro, tekrarlayan fatura ve
ödeme talimatı. Alacaklar üç senaryoda (iyimser/baz/kötümser) carinin geçmiş
tahsilat gecikmesine göre kaydırılır. Yalnız yönetici ve muhasebe görür.
**Kapsam dışı (ilk sürüm):** bütçe, elle girilen tahmin kalemleri ve KDV,
muhtasar, SGK gibi vergi/prim ödemeleri — sonuncusu tahmine girmez ve ekran
bunu açıkça belirtir; uydurma oranla tahmin üretilmez.

Önceki "AI nakit tahmini" başlangıç bakiyesini kasa/banka kaydında olmayan bir
`bakiye` alanından okuduğu için `NaN` üretiyor ve her firmaya "düşük risk"
diyordu; NAK bu ekranın yerini alır.

| No | İster | Öncelik |
|---|---|---|
| NAK-01 | Başlangıç bakiyesi aktif kasa ve banka hesaplarının hareketlerinden (TL karşılığı) hesaplanmalıdır; kayıtlı bir bakiye alanına güvenilmez. | Z |
| NAK-02 | Tahmin 7, 30 ve 90 günlük ufukta üretilmelidir; 7 ve 30 günde günlük, 90 günde haftalık dökümle her dönem için giriş, çıkış, net ve dönem sonu bakiye gösterilir. | Z |
| NAK-03 | **Faturalar:** kesin satış faturası ve alış iadesi giriş, alış faturası ve satış iadesi çıkış sayılır; tutar kayıtlı ödemeler düşülmüş kalan, tarih vadedir. | Z |
| NAK-04 | **Çek/senet:** alınanlardan portföyde ya da tahsile verilmiş olanlar vadesinde giriş sayılır; ciro edilen, teminattaki, karşılıksız ve iade edilenler sayılmaz. Verilen ve ödenmemiş olanlar vadesinde çıkıştır. | Z |
| NAK-05 | **Masraf ve kira:** onaylı ve ödenmemiş masrafın kalanı vadesinde (vade yoksa belge tarihinde) çıkıştır. Aktif kira sözleşmesi her ay ödeme gününde matrah + KDV − stopaj kadar çıkış üretir; o ayın kira masrafı zaten kayıtlıysa sözleşme ayrıca sayılmaz. | Z |
| NAK-06 | **Kredi kartı:** taksitler vade tarihinde çıkıştır. | Z |
| NAK-07 | **Bordro:** onaylı ya da kısmen ödenmiş bordroların kalanı ödeme tarihinde (yoksa dönem sonunda) çıkıştır. Ufuk içindeki sonraki aylar için son dönemin toplam ödenecek tutarı tekrar ediyor sayılır ve **tahmin** olarak işaretlenir. | Z |
| NAK-08 | **Tekrarlayan fatura ve ödeme talimatı:** aktif tekrarlayan faturalar ufuk içindeki her üretim tarihinde şablon faturanın tutarıyla (satış giriş, alış çıkış) tahmin kalemi üretir. Onaylanmış ama bankaya gönderilmemiş ödeme talimatları bugün çıkış sayılır. | Z |
| NAK-09 | **Senaryolar:** iyimser — alacaklar vadesinde tahsil edilir; baz — vade + carinin tutar ağırlıklı ortalama tahsilat gecikmesi (CARI-20; veri yetersizse 0); kötümser — gecikmenin iki katı, ayrıca kara listedeki carilerin ve vadesi 90 günden fazla geçmiş alacakların tahsilatı ufuk dışında kalır. Borçlar her senaryoda vadesinde ödenir. Vadesi geçmiş kalemler en erken bugüne düşer. | Z |
| NAK-10 | Dövizli kalemler güncel TCMB kuruyla TL'ye çevrilmeli; kullanılan kur ekranda görünmelidir. | Z |
| NAK-11 | **Açıklanabilirlik:** her tahmin kalemi kaynağını (belge türü, no, cari), gerçek tarihini, senaryoya göre kaydırılmış tarihini ve kaydırma nedenini taşımalı; ekrandan kaynak belgeye gidilebilmelidir. | Z |
| NAK-12 | Bir senaryoda bakiye eksiye düşüyorsa ilk düştüğü gün ve açık tutar gösterilmelidir; hazır "risk seviyesi" ya da kalıp tavsiye metni üretilmez. | Z |
| NAK-13 | Nakit akışı yalnız **yönetici** ve **muhasebe** rollerine açıktır; mali müşavir dahil diğer roller göremez. | Z |
| NAK-14 | `/panel/nakit-akisi` ekranı eklenir; eski AI sayfasındaki nakit tahmini kartı ve API ucu kaldırılıp yeni ekrana yönlendirilir. | Z |

### 3.12 Bütçe (BUT)

**S-01 kapı kararları (2026-09-11, kullanıcı onayı):** Bütçe satırları gelir-gider
raporunun kalemleri ve masraf/gelir kategori ağacıdır; gerçekleşen tahakkuk
esaslı ve KDV hariç sayılır; bütçe taslak → onay → revizyon akışıyla yönetilir;
nakit tahmini bu pakette bütçeyi kullanmaz. İnceleme sırasında gelir-gider
raporunun stok değerini gelire eklediği, masrafı KDV dahil saydığı, faaliyet
dışı gelir kayıtlarını okumadığı ve virman, çek/senet, POS, bordro ödemesi gibi
belgesiz kasa/banka hareketlerini gelir/gider diye (belgeyle birlikte ikinci
kez) saydığı görüldü. **Karar:** rapor ve bütçe tek ortak hesabı kullanır ve bu
hesap yalnız belgelerden oluşur — rapordaki rakamlar buna göre değişir.

| No | İster | Öncelik |
|---|---|---|
| BUT-01 | Gelir-gider raporu ve bütçenin gerçekleşeni **tek fonksiyondan** hesaplanmalıdır. Kaynaklar: kesin faturalar, onaylı masraflar, faaliyet dışı gelir kayıtları ve bordro; tutarlar KDV hariç, belge kuruyla TL; tarih belge tarihi (bordroda dönem). | Z |
| BUT-02 | **Faturalar:** satışlar gelir türüne göre (satış hasılatı, kira, varlık satışı, yansıtma, diğer), alışlar hizmet/mal olarak ayrılır; satış ve alış iadeleri ayrı kalemdir. | Z |
| BUT-03 | **Masraflar** kategori ağacına göre sayılır (ana kategori alt kategorilerin toplamını da gösterir); **gelir kayıtları** gelir kategorisine göre; **bordro** dönemine göre ve net ödenecek tutarla — reddedilen ve iptal edilen bordrolar sayılmaz. İşveren maliyeti kayıtlı olmadığı için ekranda belirtilir. | Z |
| BUT-04 | Belgesiz kasa/banka hareketleri (virman, çek/senet, POS, bordro ödemesi, gelir tahsilatı, elle girilen hareket) gelir/gider sayılmaz. Mevcut stok değeri gelir değildir; raporda ayrı bilgi olarak durur, toplam gelire ve net farka katılmaz. | Z |
| BUT-05 | Bütçe yıllıktır ve aylara dağıtılır; satırları BUT-02/BUT-03 kalemleridir, tutarlar TL'dir. | Z |
| BUT-06 | **Taslak → onaylı:** taslağı yönetici ve muhasebe düzenler, yalnız yönetici onaylar. Onaylı bütçe değiştirilemez; gerekçeyle yeni revizyon açılır, taslak olarak başlar ve onaylanınca geçerli olur. Önceki revizyonlar salt okunur saklanır; onay ve revizyon olayları kim/ne zaman/gerekçe ile tutulur. | Z |
| BUT-07 | **Karşılaştırma:** son onaylı revizyon satır ve ay bazında gerçekleşenle karşılaştırılır; fark ve oran gösterilir, gider satırında aşım, gelir satırında eksik kalma vurgulanır. İlk onaylı plan ayrı sütunda görünür. Gelecek aylarda gerçekleşen boş kalır. | Z |
| BUT-08 | ✅ **Giriş araçları:** satıra yıllık tutar yazılıp 12 aya eşit dağıtılabilir (kuruş farkı son aya); taslak geçen yılın aylık gerçekleşeninden, isteğe bağlı yüzde artışla oluşturulabilir; yeni revizyon son onaylı revizyonun tutarlarıyla başlar. | G |
| BUT-09 | Bütçe yalnız **yönetici** ve **muhasebe** rollerine açıktır. | Z |
| BUT-10 | **Kapsam dışı:** nakit tahminine bağlanma, proje bütçesi (projeler kendi hedefleriyle kalır), şube/masraf merkezi, dövizli bütçe. | — |

### 3.13 Döviz Kurları (DVZ)

**S-01 kapı kararları (2026-09-13, kullanıcı onayı):** TCMB kuru herkes için
aynıdır; kiracı başına kopyalanmaz, **ortak tabloda** tutulur ve günde bir kez
çekilir. Firmanın uyguladığı farklı kur **kiracıya özel elle kur** olarak girilir
ve o kiracıda TCMB kurunun yerine geçer — resmî kurun bulunduğu günlerde de.
İnceleme sırasında kurların yalnız ekranlar istedikçe çekildiği, kur çözümünün
geriye bakış sınırı olmadığı (Eylül dönemine sessizce Temmuz kuru düşebiliyordu)
ve kur bulunamadığı için oluşturulamayan kira döneminin yalnız loga yazıldığı
görüldü.

| No | İster | Öncelik |
|---|---|---|
| DVZ-01 | ✅ **Kaynak:** TCMB gösterge kuru; USD ve EUR için döviz alış ve satış. Önce EVDS, olmazsa TCMB günlük XML dosyası kullanılır. Her kaydın kaynağı ve alınma zamanı saklanır. TCMB kurları tüm kiracılar için ortak tabloda tutulur. | G |
| DVZ-02 | ✅ **Günlük otomatik çekim:** worker her gün TCMB yayımından sonra o günün kurunu çeker; ekranların istemesini beklemez. Çekim kiracı başına değil bir kez yapılır. | G |
| DVZ-03 | ✅ **Geçmiş aralık:** seçilen tarih aralığındaki eksik günler toplu çekilebilir; yayımlanmayan günler (hafta sonu, tatil) eksik sayılmaz. | G |
| DVZ-04 | ✅ **Kur çözümü:** belge tarihindeki kur kullanılır; kiracının o güne elle kuru varsa o, yoksa TCMB kuru. O gün kur yoksa önceki günlere en fazla **10 takvim günü** geriye gidilir. Daha eski kur sessizce kullanılmaz ve varsayılan/sabit bir kura hiçbir koşulda düşülmez: işlem kur bulunamadı diye durur ve kullanıcıyı Döviz Kurları ekranına yönlendirir. TCMB'den çekme veritabanı işleminin içinde yapılmaz; eksik kur günlük çekimle (DVZ-02), ekranların kur isteğiyle ve otomatik kira tahakkukunun işlemden önceki çekimiyle tamamlanır. | G |
| DVZ-05 | ✅ **Elle kur:** yönetici ve muhasebe bir gün ve para birimi için alış/satış kuru girebilir; resmî kurun bulunduğu günlerde de girilebilir ve o kiracıda TCMB kurunun yerine geçer. Gerekçe zorunludur; girme, değiştirme ve silme kim/ne zaman/gerekçe ile olay geçmişinde tutulur. Silinen elle kurun yerine TCMB kuru geçer. | G |
| DVZ-06 | ✅ **Ekran (Ayarlar > Döviz Kurları):** tarih aralığında USD/EUR alış ve satış, kaynak (TCMB / elle), alınma zamanı listelenir; elle kurun yanında aynı günün TCMB kuru ve farkı görünür. Aralıktaki eksik iş günleri gösterilir; "eksikleri çek" ve elle kur işlemleri buradan yapılır. | G |
| DVZ-07 | ✅ **Kur yüzünden duran iş görünür olur:** kur bulunamadığı için oluşturulamayan otomatik kira dönemi bildirim üretir (bkz. §3.10); bildirim eksik tarihi ve para birimini söyler. | G |
| DVZ-08 | **Kapsam dışı:** USD ve EUR dışındaki para birimleri, efektif kur, kaydedilmiş belgelerin kurunu geriye dönük değiştirmek (belge kendi kurunu taşır, BUT-01). | — |

### 3.14 Faaliyet Dışı ve Faturasız Gelirler (GLR)

**S-01 kapı kararları (2026-09-13, kullanıcı onayı):** gelir kaydının para birimi
tahsil edildiği hesabın para birimidir; kullanıcı ayrıca seçmez. Dövizli gelirin
TL karşılığı kaydın kendi kurundan hesaplanır (BUT-01). İnceleme sırasında gelir
formunun her kaydı TRY ve kur 1 gönderdiği, bu yüzden USD/EUR hesaba gelir
girilemediği (sunucu uyuşmazlığı reddediyor), ayrıca kategori düzenlemenin
kategorinin varsayılan KDV oranını sessizce sıfırladığı görüldü.

| No | İster | Öncelik |
|---|---|---|
| GLR-01 | ✅ **Para birimi hesaptan gelir:** gelir kaydının para birimi seçilen kasa/banka hesabının para birimidir. Hesap ile kaydın para birimi uyuşmazsa sunucu kaydı reddeder. | Z |
| GLR-02 | ✅ **Kur:** dövizli gelirde belge tarihindeki kur zorunludur ve TCMB **döviz alış** kuruyla önerilir (gelen yabancı para TL'ye çevrilir); kullanıcı değiştirebilir. Kur çözümü DVZ-04'e uyar: kur bulunamazsa kayıt durur ve kullanıcı Döviz Kurları ekranına yönlendirilir. | Z |
| GLR-03 | ✅ **Kur 1 olamaz:** dövizli gelir kaydında kur 1 sunucu tarafından reddedilir; 1 "tutar zaten TL" demektir. TRY kayıtta kur daima 1'dir. | Z |
| GLR-04 | ✅ **Kategori varsayılanları korunur:** gelir kategorisi formu varsayılan stopaj ve KDV oranını gösterir ve düzenlemede mevcut değerleri yükler; bir alanı değiştirmek diğer varsayılanı değiştirmez. | Z |

### 3.15 Satın Alma Talep ve Onay (SAT)

**S-01 kapı kararları (2026-09-15, kullanıcı onayı):** 2026-09-02 modül inceleme
raporu (§5.4) "Satın Alma" ekranının yalnız alış faturasına yönlendiren bir çalışma
alanı olduğunu, talep/onay/teklif akışı bulunmadığını tespit etti. Paket **iki
aşamalıdır**: birinci aşama talep → onay → teklif karşılaştırma → alış siparişine
dönüşüm, bütçe kontrolü ve bildirim (SAT-01…SAT-08); ikinci aşama kısmi mal kabul ve
üçlü eşleştirme (SAT-09…SAT-11) ayrı onayla başlar. Onay **tutar eşiği + rol**
iledir; bütçe aşımında **uyarı + zorunlu gerekçe**; talebi **tüm iç kullanıcılar**
açabilir. Varsayılan eşik 25.000 TL.

**S-01 ikinci aşama kararları (2026-09-16, kullanıcı onayı):** mal kabul ayrı bir
varlık değildir, mevcut **alış irsaliyesi** kısmi dönüşümle kullanılır; kısmi
dönüşüm **alış ve satış** yönlerinde birlikte gelir (satışta kısmi sevkiyat);
üçlü eşleştirmede tolerans dışı fark faturayı engellemez, **Düzeltme Merkezi'ne**
düşer; önce SAT-09/10 kodlanıp canlı denenir, SAT-11 ayrı turda gelir.

| No | İster | Öncelik |
|---|---|---|
| SAT-01 | **Talep:** otomatik numaralı talep; talep eden kullanıcı, isteğe bağlı departman (personel departmanlarından), ihtiyaç tarihi, gerekçe ve **bütçe kalemi** (mal alışı, hizmet alışı veya bir masraf kategorisi — bütçe satırı anahtarıyla aynı, BUT-05). Kalemler **stok veya hizmet kartıdır** (siparişe dönüşümde belge satırı kart ister), miktar, birim ve tahmini birim fiyat (TL) içerir. Durumlar: taslak → onay bekliyor → onaylandı / reddedildi → siparişe dönüştü; taslak veya onay bekleyen talep iptal edilebilir. | G |
| SAT-02 | **Yetki:** salt okunur, mali müşavir ve B2B bayi dışındaki tüm roller talep açar. Kullanıcı yalnız kendi taleplerini görür ve düzenler; muhasebe ve yönetici tüm talepleri görür. Onaya gönderilmiş talep düzenlenemez; talep eden onu taslağa geri çekebilir. | G |
| SAT-03 | **Onay:** tahmini toplam `satin_alma` modül ayarı `onayEsigi` (varsayılan 25.000 TL) ve altındaysa muhasebe, üstündeyse yönetici onaylar; yönetici her tutarı onaylayabilir. **Talep eden, yönetici dahil, kendi talebini onaylayamaz** (görev ayrılığı, ENT-07 ile aynı ilke). Red gerekçesi zorunludur. Oluşturma, onaya gönderme, geri çekme, onay, red, iptal ve siparişe dönüşüm olayları kullanıcı, zaman ve gerekçeyle yalnız eklenen geçmişe yazılır. | G |
| SAT-04 | **Bütçe kontrolü:** onay ekranı talebin bütçe kaleminde ihtiyaç tarihinin ayı için geçerli onaylı bütçe revizyonundaki tutarı, o ayın gerçekleşenini (gelir-gider raporuyla aynı tahakkuk, BUT) ve aynı kalemde o aya düşen **diğer onaylı, henüz faturalaşmamış** taleplerin toplamını gösterir; kalan = bütçe − gerçekleşen − diğer onaylı talepler. Talep kalanı aşıyorsa onay için **aşım gerekçesi zorunludur** ve gerekçe geçmişe yazılır. Onaylı bütçe yoksa "bütçe tanımsız" bilgisi gösterilir, gerekçe istenmez. | G |
| SAT-05 | **Teklif:** onaylı talebe muhasebe veya yönetici tedarikçi teklifleri girer: tedarikçi carisi, talep kalemlerine birim fiyat ve KDV oranı, döviz ve kur (dövizde kur 1 olamaz, DVZ), teslim süresi (gün), geçerlilik tarihi, not ve ek dosya. Karşılaştırma ekranı kalem bazında fiyatları ve TL karşılığı toplamları yan yana gösterir, en düşük toplamı vurgular. Bir teklif seçilir; **en düşükten farklı teklif seçilirse gerekçe zorunludur.** | G |
| SAT-06 | **Siparişe dönüşüm:** muhasebe veya yönetici seçilen teklifi mevcut **alış siparişi** belgesine dönüştürür (cari = tedarikçi, satırlar teklif fiyatlarıyla, depo seçilir); onaylanan alış siparişinin "yoldaki" stok ve belge zinciri (FTR-12) aynen işler. Teklif girilmemiş onaylı talep, tedarikçi ve fiyat dönüşümde girilerek doğrudan siparişe dönüştürülebilir. Talep "siparişe dönüştü" olur ve siparişe bağlantı gösterir; bir talepten tek sipariş oluşur. | G |
| SAT-07 | **Bildirim:** onay bekleyen her talep için onaylayabilecek rollere (eşiğe göre muhasebe ve/veya yönetici) `satin_alma` türünde bildirim düşer; talep karara bağlanınca veya geri çekilince bildirim kendiliğinden kapanır (BLD tarama deseni, tarayıcının kendi anahtarı). | G |
| SAT-08 | **Ekranlar:** `/panel/satin-alma/talepler` "Taleplerim", "Onay bekleyenler" ve (muhasebe/yönetici için) "Tüm talepler" sekmeleriyle çalışır; talep detayında kalemler, bütçe durumu, geçmiş, teklif karşılaştırması ve siparişe dönüşüm yer alır. Mevcut Satın Alma çalışma alanı korunur, talep kısa yolu ve "onay bekleyen talepler" kuyruğu eklenir. Onay eşiği Ayarlar > Modüller'de düzenlenir. Talepler sayfası ve menüsü SAT-02'deki rollere açılır; ekrandaki eylemler sunucunun bildirdiği yetkilere göre gösterilir. | G |
| SAT-09 | **Kısmi teslim (mekanik):** onaylı sipariş irsaliyeye dönüştürülürken satır bazında miktar girilir (varsayılan: o satırın kalanı); sipariş satırında teslim edilen miktar birikir, kalan = sipariş miktarı − teslim edilen. Teslim edilen miktar sipariş miktarını **aşamaz**. Tamamı teslim edilmemiş sipariş `kismen_kapandi` olur ve yeniden dönüştürülebilir; tamamlanınca `kapandi`. Kural **alışta mal kabul ve satışta sevkiyat** için aynı işler. Stok kuralı değişmez: düşüm faturada kalır, alıştaki "yoldaki" ve satıştaki "rezerve" miktar fatura kesinleşene dek sürer (S-01 2026-07-13). İrsaliye iptal edilirse teslim edilen miktar geri alınır ve sipariş gerekirse `kismen_kapandi`/`onaylandi` durumuna döner. | G |
| SAT-10 | **Kısmi teslim (ekranlar):** dönüşüm ekranı satır başına kalan miktarı ve girilecek miktarı gösterir, kalanı sıfır olan satır varsayılan olarak dışarıda kalır. Sipariş detayında sipariş/teslim/kalan sütunları ve teslim geçmişi (hangi irsaliye, ne zaman, ne kadar) yer alır; belge listesinde "kısmen teslim" süzgeci bulunur. Satın alma çalışma alanına "mal kabul bekleyen siparişler" kuyruğu eklenir. | G |
| SAT-11 | **Üçlü eşleştirme:** kaynağı olan kesin alış faturası sipariş ve mal kabulle karşılaştırılır — **miktar** faturayla mal kabul (irsaliye), **birim fiyat** faturayla sipariş arasında; aynı stoğun parça parça teslimleri toplanır. `satin_alma` modül ayarındaki `miktarToleransYuzde` ve `fiyatToleransYuzde` (varsayılan %1) altındaki sapma fark sayılmaz. Faturada olup siparişte/mal kabulde olmayan kalem ile teslim alınıp faturalanmamış kalem de fark sayılır. Tolerans dışı fark **faturayı engellemez**, Düzeltme Merkezi'ne `satin_alma` türü ve `UCLU_ESLESME_FARKI` neden koduyla düşer; fark ortadan kalkınca tarama kaydı kendiliğinden kapatır (DZL deseni). Kaynak belgesi olmayan (elle girilen) alış faturası eşleştirmeye girmez. | G |

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

1. Cari kartı aç → stoklu satış faturası kes → faturayı kesinleştir → **e-Fatura Oluştur** wizard'ını açıp kontrol et ve gönder → entegratörden "iletildi" durumu görülsün → stok düşsün → cari borçlansın → tahsilat gir → bakiye kapansın.
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
