# TekirExtra — Uygulama İncelemesi ve Modül Önerileri

**Tarih:** 2026-11-10 · **Kapsam:** `main` = `b28dc0d`, yerel pilot veritabanı

**Yöntem ve sınır:** Bu inceleme kod ölçümleri, veritabanı istatistikleri, şema, CI yapılandırması ve önceki inceleme notları üzerinden yapıldı. Satır satır denetim değildir. Her bulgunun yanında dayanağı yazılıdır; "bulamadım" denen yerler arama sonucudur, kesin yokluk kanıtı değildir. Modül önerileri iş değeri tahminidir, müşteri görüşmesiyle doğrulanmadı.

---

## 1. Genel durum

| Ölçü | Değer |
|---|---|
| API kaynak dosyası (test hariç) | 701 dosya, ~101.600 satır |
| API birim test dosyası | 374 dosya, 3.430 test (1 tanesi kırık) |
| Web sayfası | 185 `page.tsx`, ~67.700 satır |
| Veritabanı | 292 model, 376 göç, 1,33 GB (15 firma, 15 kullanıcı) |
| Modül | 42 API modülü: cari, fatura, e-Belge, stok, üretim, personel, kasa-banka, POS, pazaryeri, CRM, B2B, satın alma, bütçe, nakit akışı, demirbaş, araç, proje, mevzuat, AI asistan, platform yönetimi |

Güçlü yanlar: test yoğunluğu yüksek, kiracı yalıtımı RLS ile veritabanında zorlanıyor, güvenlik taraması (SEC-01…21) tamamlanmış, isterler tek belgede izleniyor, CI gerçek servislerle kabul ve e2e testlerini koşuyor.

İşlev kapsamı bir ön muhasebe ürünü için geniş. Bundan sonraki en büyük risk yeni işlev eksikliği değil, **işletim ve ölçek** tarafı: tek makine, elle yayın, tek worker, büyüyen tablolar.

---

## 2. Geliştirilmesi ve optimize edilmesi gerekenler

Öncelik: **P0** canlıya çıkmadan, **P1** ilk 50–100 firmadan önce, **P2** fırsat oldukça.

### 2.1 İşletim ve yayın

| # | Bulgu | Dayanak | Öneri | Öncelik |
|---|---|---|---|---|
| O-1 | **Yayın elle yapılıyor.** Derlenen dosyalar tek tek karşılaştırılıp pakete kopyalanıyor, compose dosyası `sed` ile türetiliyor. Bugünkü yayında kopyalanan betikte `web` servisi eksikti, ikinci tur gerekti. | `.release-candidates/` altında 222 paket klasörü; bugünkü yayın | Sürümlü imaj üreten tek komutluk yayın: derle → imaj → göç → sağlık denetimi → otomatik geri dönüş. Eski paket klasörlerini temizleyen kural. **2026-11-10:** `scripts/pilot-yayin.py` yazıldı; paket hazırlama denendi, yayın ve geri dönüş adımı ilk gerçek yayında izlenecek. Sürümlü imaj ve eski paket temizliği açık. | P0, kısmen |
| O-2 | **Yedek tek makinede.** Dış kopya ertelenmiş durumda. Disk %84 dolu ve her yedek ~725 MB. | PLT-109…117 notu; `df` | Dış depoya (S3 uyumlu) şifreli kopya ve aylık geri yükleme provası. Yerel yedeklere saklama süresi. | P0 |
| O-3 | **Sistem e-postası pilotta çalışmıyor.** SMTP'si olmayan firmaların e-postası ve tüm platform iletileri `ESOCKET` ile düşüyor. | `eposta_gonderimleri` son 3 gün: 34 başarısız, hepsi platform göndericisi | Platform SMTP ve Netgsm hesabı girilmeli, ardından gerçek gönderim denemesi. Kod hazır. | P0 |
| O-4 | **Tek worker sınırı.** 27 serviste `setInterval` zamanlayıcısı var, yalnız iki tarama BullMQ'da. Süreçler arası kilit olmadığı için ikinci worker açılamıyor. Worker belleği 490/768 MiB. | `setInterval(` araması; `docker stats`; BLD-12…17 notu | Kalan zamanlayıcıları BLD-17'deki kuyruk kalıbına taşımak ya da Redis kilidiyle sarmak. Hedef: iki worker'ın çift iş üretmeden çalışması. **2026-11-10:** BLD-18 ile zamanlayıcılar Redis kilidiyle tek çalışıyor; ikinci worker açılabilir, pilotta henüz açılmadı. | P1, kod bitti |
| O-5 | **Ödeme sözü süreci tek firmaya bağlı.** Ayrı süreç, firma kimliğini ortam değişkeninden alıyor. | `ODEME_SOZU_HATIRLATMA_TENANT_ID` | Tüm firmaları dolaşan tarama kuyruğuna taşımak. Çok firmalı kullanımda bu haliyle çalışmaz. **2026-11-10:** kod düzeltildi; tahsilat modu açık tüm firmaları tarıyor. | P1, kod bitti |
| O-6 | **Hata izleme servisi yok.** Prometheus ve alarm kuralları var, ama istisna toplayan bir araç (Sentry benzeri) bağımlılıklarda yok. | `package.json` araması | Hata toplama ve sürüm bazlı izleme. Tarayıcı tarafı hataları şu an hiç görünmüyor. **2026-11-11/13:** kendi veritabanımızda gruplu hata kaydı, platform kartı ve alarm (PLT-118…122); worker, Telegram, ödeme sözü ve yakalanmamış hatalar da (PLT-123…125). | P1, bitti |

### 2.2 Veritabanı ve performans

| # | Bulgu | Dayanak | Öneri | Öncelik |
|---|---|---|---|---|
| V-1 | **Gelen e-Belge XML'i veritabanında.** `gelen_ebelgeler` 10.656 satırla 1,13 GB; veritabanının %85'i. Satır başına ~105 KB. | `pg_total_relation_size`; `xml_icerik` sütunu | XML ve PDF'i nesne deposuna (MinIO) taşıyıp tabloda özet ve anahtar bırakmak. 1.000 firmada bu tablo tek başına 100 GB'ı aşar; yedek süresi ve maliyeti de buna bağlı. Liste sorguları zaten XML okumuyor, geçiş düşük riskli. **2026-11-10:** kod ve taşıma betiği hazır, pilot yayını ve veritabanı kopyasının silinmesi bekliyor. | P1, kısmen |
| V-2 | **Sınırsız liste sorguları.** 892 `findMany` çağrısının yalnız 88'inde aynı satırda `take` var. Hepsi sorun değil, ama büyük firmada bellek taşması daha önce iki kez yaşandı. | Arama; API bellek çöküşü ve worker OOM notları | Rapor, dışa aktarım ve tarama yollarını tek tek gözden geçirip sayfalama ya da akış kullanmak. CI'da "sınırsız findMany" denetimi. **2026-11-10:** büyüyen tablolarda geniş koşullu sınırsız okuma 142 adet (çoğu tek kayda bağlı, zararsız). Ana sayfa özetleri SQL toplamına çevrildi; dosya başı tavanlı denetim testi eklendi. Açık: sayfalamasız listeler — gelen kutusu (demo firmada 7.308 belge, arama tarayıcıda), pazaryeri sipariş/kesinti (satırlarla birlikte), masraf, çek-senet, üretim emirleri; banka mutabakatı hesabın tüm geçmişini okur. | P1, kısmen |
| V-3 | **Kullanılmayan dizinler.** 434 dizin hiç okunmamış. Büyük kısmı veri azlığından, ama her biri yazma maliyeti. | `pg_stat_user_indexes` | Gerçek yük altında (ilk aylar) yeniden ölçüp ölü dizinleri kaldırmak. Şimdi dokunmak erken. | P2 |
| V-4 | **Süresi dolmuş kayıtlar birikiyor.** 1.503 oturumun 935'i süresi dolmuş. Gönderim kayıtları için ILT-06'daki 12 ay kuralını uygulayan temizlik işi bulamadım. | Sayım; kod araması | Gecelik bakım işi: süresi dolmuş oturum, eski gönderim kaydı, eski bildirim. | P2 |
| V-5 | **Ham SQL yaygın.** 220 `queryRaw` kullanımı. Parametreli, ama şema değişikliğinde derleyici uyarmıyor. | Arama | Yeni raporlarda Prisma TypedSQL ya da görünüm; mevcutlar için kabul testi kapsamını korumak. | P2 |

### 2.3 Kod sağlığı

| # | Bulgu | Dayanak | Öneri | Öncelik |
|---|---|---|---|---|
| K-1 | **Çok büyük dosyalar.** `fatura/page.tsx` 3.873 satır; `ebelge.service.ts` 2.943; `belgeler.service.ts` 2.380; `fatura.service.ts` 2.134. | `wc -l` | Dokunulan her işte bir parçayı ayırmak (form, liste, sihirbaz; gönderim, durum, gelen). Toplu yeniden yazım önermiyorum. | P2 |
| K-2 | **Tek satıra sıkıştırılmış kod.** 300 karakteri aşan 1.228 satır var. İnceleme ve fark okuma zorlaşıyor, birleştirme çakışması artıyor. | `awk` ölçümü | Biçimlendirici (Prettier) ve satır uzunluğu kuralı. Tek seferlik biçimlendirme commit'i, `git blame` için yok sayma listesiyle. | P2 |
| K-3 | **Lint bilinçli olarak dar.** Yalnız 19 hata kuralı açık, tip bilgili kural yok. 151 `any` kullanımı var. | `eslint.config.mjs` | En azından `no-floating-promises` ve `no-misused-promises`. Para ve gönderim kodunda beklenmeyen söz, sessiz veri kaybının en sık nedeni. **2026-11-11:** iki kural ayrı tip bilgili lint olarak açıldı (`eslint.soz.config.mjs`, `pnpm lint:soz`, CI'da; 0d86d6a). 2026-11-13 tam koşu temiz. `any` kullanımı (testler hariç 184) açık, ayrı karar. | P1, bitti |
| K-4 | **Kırık test ana dalda.** `yetki-modulu-kapsami` 64f5688'den beri kırık: `duyurular` denetleyicisi yetki modülüne bağlı değil. | Test çıktısı | **Düzeltildi (2026-11-10).** Uçlar platform duyurularını okuma ve kullanıcının kendi okundu kaydı; bildirimler gibi bilinçli olarak modülsüz. Açık değil, yalnız testin listesi eksikti. | Bitti |
| K-5 | **Web testi az.** API'de 374 test dosyasına karşılık web'de 15 birim testi var; koruma e2e'ye dayanıyor. | Dosya sayımı | Para hesabı yapan istemci kodu (fatura formu toplamları, kur) için birim testi. | P2 |

### 2.4 Arayüz

| # | Bulgu | Dayanak | Öneri | Öncelik |
|---|---|---|---|---|
| A-1 | **Hemen her sayfa istemci bileşeni ve veri önbelleği yok.** 185 sayfanın 178'i `"use client"`; SWR ya da benzeri kütüphane yok, her sayfa `useEffect` ile kendi çekiyor. | Arama; `package.json` | Ortak veri katmanı (önbellek, yeniden doğrulama, istek tekilleştirme). Sayfa geçişleri hızlanır, tekrar eden yükleme kodu azalır. | P2 |
| A-2 | **Modül Ayarları yavaş açılıyor.** ~20 modülü birden yüklüyor, ilk görüntü boş. | Tarayıcı turu notu | Sekme açıldığında yükleme. | P2 |
| A-3 | **Çok dillilik altyapısı yok.** Arayüz metinleri kodda Türkçe. Yalnız belge çıktılarında dil seçimi var. | `package.json` | Yurt dışı ya da yabancı ortaklı firma hedefi yoksa gerekmez. Karar verilmeli; sonradan eklemek pahalı. | Karar |

### 2.5 Açık kalan işler (önceki incelemelerden)

- Vergi takviminin ilk yayını: KDV-2 ve SGK ödeme günü teyidi bekliyor.
- Borç hatırlatma SMS'i için hukuki teyit (ilk gerçek gönderimden önce).
- İyzico/PayTR canlı denemesi sandbox anahtarı bekliyor; KSB-43 iade denemesi de.
- e-Belge'de canlıda yalnız NES var. İsterlerdeki dört entegratör kararı (A-01) uygulanmadı; tek sağlayıcıya bağımlılık sürüyor.
- Fiyatlandırma modeli (A-04) hâlâ ertelenmiş. Paket kataloğu ve abonelik altyapısı hazır, karar eksik.
- Ertelenenler: PZR-14 otomatik çekim, KSB-42, Findeks, VKN ile vergi dairesi sorgusu, DVZ-09 alış kuru teyidi.

---

## 3. Katma değer sağlayacak modüller

Aşağıdakiler kodda ve şemada bulunmayan ya da yalnız kısmen bulunan alanlar. Sıralama, tahmini müşteri değeri ve mevcut altyapıyla uyuma göre.

### 3.1 Birinci öncelik

**M-1 · Genel onay akışları.** Bugün onay yalnız satın almada ve AI asistanın işlemlerinde var. Fatura kesinleştirme, ödeme talimatı, iskonto sınırı, masraf ve cari limit aşımı için tutar ve role dayalı ortak onay motoru yok (kodda `onay akışı` karşılığı bulunamadı). Satın almadaki eşik mantığı ve AI onay talebi ekranı genelleştirilebilir. KOBİ'de patronun en çok istediği denetim budur; rakip planında da (KiviERP FAZ 4) yer alıyor. **Efor: orta.**

**M-2 · E-ticaret sitesi entegrasyonu.** Dört pazaryeri (Trendyol, Hepsiburada, n11, Amazon) bağlı, ama firmanın kendi sitesi (Shopify, WooCommerce, Ticimax, İdeasoft) için adaptör yok. Pazaryeri altyapısı (sipariş çekme, stok ve fiyat gönderme, eşleştirme) aynen kullanılır; iş yalnız adaptör yazmaktır. Pazaryerinde satan firmaların çoğunun sitesi de vardır. **Efor: adaptör başına düşük-orta.**

**M-3 · Veri aktarım sihirbazı.** Başka programdan geçen firmanın cari, stok, açılış bakiyesi ve açık faturalarını Excel'den eşleştirerek alması. Parça parça içe aktarım var, ama uçtan uca yönlendiren ve geri alınabilen bir sihirbaz göremedim. Satışta en büyük engel geçiş zahmetidir; bu modül doğrudan müşteri kazanımını etkiler. **Efor: orta.**

**M-4 · Mobil saha ekranları (PWA).** `manifest.json` var, ama çevrimdışı çalışma ve servis işçisi yok. Üç dar ekran yeterli olur: barkodla sayım ve mal kabul (Sayım modeli hazır), sahada tahsilat ve ödeme bağlantısı gönderme, masraf fişi fotoğrafı (OCR altyapısı var). Ayrı yerel uygulama önermiyorum. **Efor: orta.**

### 3.2 İkinci öncelik

**M-5 · Servis, garanti ve iade takibi.** Şemada servis kaydı ve garanti modeli yok. Seri numarası bazında garanti süresi, servis kaydı, yedek parça tüketimi ve iade nedeni analizi. Üretim ve stok modülü olan müşteriler için doğal devam (planlarda F10). **Efor: orta-yüksek.**

**M-6 · Sözleşme ve yenileme.** Yalnız kira sözleşmesi modeli var. Müşteri ve tedarikçi sözleşmeleri, yenileme tarihi, otomatik fiyat artışı ve tekrarlayan faturaya bağ. Tekrarlayan fatura ve bildirim merkezi hazır olduğu için eklemesi ucuz (planlarda F09). **Efor: düşük-orta.**

**M-7 · Şube ve masraf merkezi.** Şema araması şube ya da masraf merkezi modeli vermedi. Gelir ve giderin şube, departman ve proje kırılımında raporlanması. Birden fazla işyeri olan firmada kârlılık raporları bu olmadan eksik kalır (planlarda F12). Fatura ve masraf satırına alan eklemek gerektiği için **efor: orta, etki alanı geniş**; erken karar verilmeli.

**M-8 · e-SMM ve e-Müstahsil.** e-Fatura, e-Arşiv ve e-İrsaliye var; serbest meslek makbuzu ve müstahsil makbuzu kodda görünmüyor. NES bu belgeleri destekliyorsa UBL üretim ve kuyruk altyapısı hazır. Serbest meslek sahipleri ve tarım ürünü alan firmalar için giriş şartı. **Efor: belge başına orta.**

**M-9 · Dış API ve webhook.** MCP bağlantısı ve `tkx_` anahtarı var, ama müşterinin kendi yazılımını bağlayacağı belgelenmiş REST API ve olay bildirimi (fatura kesildi, tahsilat geldi) yok. Büyük müşteri ve çözüm ortağı kanalı için gerekli. Yetki ve anahtar altyapısı MCP'den alınır. **Efor: orta.**

### 3.3 Değerlendirilecek

**M-10 · Kargo entegrasyonu.** Sevkiyat modülü var; kargo firması (Yurtiçi, Aras, MNG) ile gönderi oluşturma ve takip bağlantısının olup olmadığını doğrulamadım. Yoksa e-ticaret entegrasyonuyla birlikte anlamlı.

**M-11 · Çoklu firma konsolidasyonu.** Aynı kullanıcının birden fazla firmasını tek ekranda özetleyen görünüm (kodda karşılığı yok). Mali müşavir modülü bunun bir kısmını karşılıyor; grup şirketleri için ayrı değer.

**M-12 · e-Defter.** Tam muhasebe gerektirir. Ürün "ön muhasebe" konumunda ve Tekdüzen fiş aktarımı (MUH) zaten var. Önerim e-Defter yazmak yerine yaygın muhasebe programlarına (Luca, Zirve, Logo) aktarımı güçlendirmek.

### 3.4 Önerilen sıra

1. Önce bölüm 2'deki P0 maddeleri (yayın, dış yedek, SMTP). Bunlar bitmeden yeni müşteri almak riskli.
2. M-3 veri aktarımı ve M-1 onay akışları: satışı ve ilk izlenimi doğrudan etkiler.
3. V-1 gelen e-Belge deposu ve O-4 worker ölçeği: 50 firmadan önce.
4. M-2 e-ticaret ve M-4 mobil ekranlar: mevcut müşteride kullanım derinliği.
5. M-7 şube ve masraf merkezi için karar: geç kalınırsa veri geçişi pahalılaşır.
