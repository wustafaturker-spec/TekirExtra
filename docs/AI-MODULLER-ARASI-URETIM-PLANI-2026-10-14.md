# TekirExtra — Modüller Arası Yapay Zekâ Ayrıntılı Üretim Planı

Tarih: 14 Ekim 2026  
Sürüm: 1.0  
Durum: Planlama taslağı; uygulama ve üretime açma onayı değildir.  
Amaç: Mevcut ERP hesaplarını, belge okumayı ve insan onaylı iş akışlarını kaynaklı, ölçülebilir ve güvenli AI özellikleriyle birleştirmek.

## 1. Kapsam ve belgelerin ilişkisi

Bu belge modül fırsat incelemesini uygulanabilir iş paketlerine dönüştürür. Uygulama kodunu, gerçek verileri veya çalışan sunucuları değiştirmez. Her paketin detaylı isterleri geliştirmeye başlamadan ürün sahibiyle doğrulanmalıdır (`ISTERLER.md`, S-01).

Önceki belgeler korunur:

- [Genel AI yol haritası](YAPAY-ZEKA-PLANI.md): tarihsel vizyon ve başlangıç planı. Eski tamamlandı işaretleri bu belgenin üretim kabulü yerine geçmez.
- [AI güvenilirlik geliştirmeleri](../YAPAY-ZEKA-INCELEME-VE-URETIM-PLANI-2026-10-14.md): mevcut asistan güvenliği, idempotency, görev, telemetri ve kalite işleri.
- [Ürün ve üretim planı](URUN-URETIM-PLANI.md): ERP modüllerinin genel yaşam döngüsü.
- [Finans kaynak kartları](AI-FINANS-KAYNAKLARI.md), [model kalite testleri](AI-KALITE-TESTLERI.md).
- [Gelen fatura fiyat analizi](GELEN-FATURA-FIYAT-ANALIZI.md), [çek OCR/vade analizi](CEK-OCR-VE-VADE-ANALIZI.md), [çek hatırlatma ayarları](CEK-SENET-HATIRLATMA-AYARLARI.md).

Bu planın dayanağı mevcut kaynak kodu ve şemaların incelemesidir. 14 Ekim'de kullanıcı tarafından seçilen 1234567801 VKN'li şirketin 21 profilinde adet/doluluk/tarih taraması yapıldı; [P0-01 sonuçları](AI-P0-01-HAZIRLIK-ENVANTERI-2026-10-14.md) kayıtlıdır. Geçmiş sürekliliği, ilişki doğruluğu ve model doğruluğu henüz tam doğrulanmadı. Nihai süreler ve pilot kabulü P0 sırasında doğrulanır.

## 2. Hedeflenen ürün davranışı

Birincil uçtan uca akış:

```text
Stok/üretim ihtiyacı
  → Kullanıcıya açıklanmış ihtiyaç önerisi
  → Tedarikçi tekliflerinin okunması ve doğrulanması
  → Karşılaştırılabilir fiyat / teslim süresi değerlendirmesi
  → Mevcut bütçe ve nakit senaryosuna etkisi
  → Değişmez işlem önizlemesi
  → Yetkili kullanıcının açık onayı
  → Mevcut satın alma talebi iş akışı
```

Talep açılması, satın alma onayı veya sipariş oluşması aynı işlem değildir. Mevcut görev ayrılığı ve onay eşikleri korunur; bir öneri kendi onayını veremez.

İlk üretim paketi üç sonuç üretmelidir:

1. Yönetici mevcut fiyat, çek, nakit ve bütçe analizlerini doğal dille sorgular; kaynakları görür.
2. Kullanıcı fiyat/stok/nakit uyarılarını kendi yetkisi içindeki ayarlardan yönetir.
3. Satın alma önerisi insan onayıyla mevcut talep sürecine aktarılır; model kesin mali işlem yapmaz.

## 3. Başlangıç envanteri — ne mevcut, ne eksik?

| Alan | Kaynak kodunda mevcut | Bu planın ekleyeceği |
|---|---|---|
| Asistan ve MCP | Ortak araçlar, rol/tenant kontrolü, onaylı işlemler, idempotency | Yeni modüllerin özel okuma/öneri araçları |
| Finansal raporlar | Genel rapor aracı, yönetici yorumu, kaynak kartları | Yeni analizlere kaynak kapsamı ve sayısal anlatım denetimi |
| Gelen e-Fatura | Net fiyat, tedarikçi farkı, iki 12 aylık dönem karşılaştırması | Sohbet bağlantısı, artış eşiği, teklif/sözleşme ilişkisi |
| Çek/senet | Görsel okuma, kullanıcı kontrolü, vade tablosu, şirket hatırlatma ayarları | Ayrı tarih alanları, mükerrer adayları, sohbet bağlantısı, telafi politikası |
| Nakit akışı | 7/30/90 günlük iyimser/baz/kötümser hesaplar | Kaynaklı açıklama, geçici değişiklik senaryosu, gerçekleşen takibi |
| Satın alma | Talep, teklifler, bütçe, onay, sipariş ve üçlü eşleştirme | Teklif OCR, açıklanmış tedarikçi değerlendirmesi, birleşik öneri |
| Stok | Depo/rezervasyon/hareket/parti ve tedarik süresi bilgileri | İhtiyaç, tükenme, hareketsizlik ve üretim gereksinimi analizi |
| Banka/POS | Kurala dayalı eşleştirme, AI cari önerisi, ödeme/komisyon kayıtları | Daha açıklanabilir eşleşme ve fark analizi |
| Cari | Ödeme davranışı, risk/gecikme, tahsilat önceliği ve hatırlatma | Yapılandırılmış ödeme sözü, takip ve görüşme özeti |
| Bütçe/masraf | Tahakkuk bazlı karşılaştırma, revizyonlar, masraf OCR | Sapma katkısı, plansız gider ve mükerrer adayları |
| Üretim | Reçete, malzeme uygunluğu, kapasite, maliyet ve kalite | Açıklama, örüntü incelemesi ve geçici plan önerisi |
| CRM/e-posta | Fırsat aşamaları, görevler, e-posta okuma/ek OCR | Ticari talep çıkarımı ve takip önerisi |
| Proje/pazaryeri/B2B | İlgili iş kayıtları ve mali kırılımlar | Proje/kanal değerlendirmesi ve bayi kapsamlı yardımcı |
| Personel/mevzuat/müşavir | Bordro, izin, belge ve tarihli merkezi mevzuat verileri | Sınırlı belge çıkarımı ve kaynaklı açıklama |
| Sevkiyat | Araç/şoför kartları ve belge bağlantıları | Önce veri tamamlama; rota optimizasyonu veri hazırlığına bağlı |

“Kodda mevcut”, “testi geçmiş”, “gerçek modelle doğrulanmış” ve “üretimde etkin” ayrı durumlardır. İlk ikisi son ikisini kanıtlamaz. İlk incelemede çalışan sürüm eskiydi; 14 Ekim 21:06'da kullanıcı onayıyla yerel API/worker/web yeni derlemeye geçirildi ve sağlık/web dosyası eşleşmesi doğrulandı ([yayın kaydı](AI-P0-01-HAZIRLIK-ENVANTERI-2026-10-14.md)). Başka üretim ortamı, canlı model doğruluğu ve yöneticinin yeni onay akışı henüz doğrulanmış değildir.

## 4. Değişmez mimari ve güvenlik kuralları

1. Para, vergi, miktar, kur ve vade hesabını uygulamanın hesap motorları yapar. Model sayı icat edemez veya hesap motorunu değiştiremez.
2. Yeni araçlar `UcCagirici` üzerinden mevcut controller/iş kurallarına bağlanır. Model kaynaklı serbest SQL, ham DB bağlantısı ve genel komut çalıştırma aracı yoktur.
3. Kiracı verisi `tenantIslem` içinde okunur/yazılır. Tenant UUID'sini kullanıcı veya model parametresiyle değiştirmek mümkün değildir.
4. Rol denetimi hem aracı modele sunarken hem çalıştırırken yapılır. Sayısal raporların maliyet alanları üretim operatörü veya B2B bayisine açılmaz.
5. Yeni bir AI taslak/CRM kaydı da kalıcı yazmadır. Bu planın yeni akışlarında öneri önce yan etkisiz hazırlanır, açık kullanıcı komutu/onayı olmadan taslak oluşturulmaz.
6. Fatura kesinleştirme/iptal, sipariş onayı, fiyat listesi değişimi, tahsilat/ödeme, bordro ve dış gönderim mevcut onay/TOTP/görev ayrılığı kurallarından geçer. Model bunları gevşetemez.
7. Dosya/e-posta/görüntü içeriği güvenilmeyen veridir; ERP talimatı veya kullanıcı onayı sayılmaz.
8. Dış sağlayıcı çağrısı mevcut özellik anahtarı, veri aktarım onayı, kota ve maliyet izlemesinden geçer. Modül bazlı kontroller bu kapıları atlayamaz.
9. Kaynak verisi değişmiş veya yetki geri alınmışsa eski öneriden işlem yürütülmez. Önizleme yeniden hazırlanır.
10. AI devre dışıyken manuel form, asıl rapor ve mevcut iş akışı kullanılabilir kalır. Özellik kapatmak mali kayıtları silmez.

## 5. Ortak teknik tasarım

### 5.1 Tek hesap kaynağı ve açıklama katmanı

Her modül önce tipli bir analiz sonucu üretir; AI açıklama bu sonucu tüketir. Önerilen sözleşme:

```text
analizId / semaSurumu / hesapSurumu
alindiAt / belgeGunu veya dönem / uygulanan filtreler
olgular[]: kimlik, ad, decimal-string değer, döviz/birim, kaynakRef
uyarilar[]: eksik veri, desteklenmeyen karşılaştırma, kesilmiş sonuç
kapsam: dahil/haric kalemler, sayısal hesap mı tahmin mi
aciklama: olgu kimliklerine bağlanan kısa yorum (isteğe bağlı)
oneri: yetki ve iş kuralıyla sınırlı eylem önizlemesi (isteğe bağlı)
```

- Bu bir yeni API sözleşmesi önerisidir, mevcut tüm uçların aynı anda dönüştürülmesi istenmez.
- Mevcut kaynak kartlarına geriye uyumlu genişletme veya sürümlenmiş yeni sözleşme seçilir.
- Finansal değerler iç hesapta Decimal/mevcut kuruş motoru, aktarımda decimal-string olarak korunur. Dövizler ve farklı birimler tek toplam yapılmaz.
- Modelde görülen değer ile UI'da görülen değer aynı snapshot'a dayanır. Toplam, ilk 30 örnek satırdan yeniden hesaplanmaz.
- Açıklama üretilmezse hesap ve kaynak kartı yine gösterilir; hata yüzünden tüm ERP analizi kaybolmaz.
- Sayısal anlatım için serbest metindeki tüm rakamları kaba regex ile eşlemek yerine olgu kimlikli yapılandırılmış cümle/şablon kullanılır. Dönem, oran, sayı ve para rolleri ayrı denetlenir.

### 5.2 Araç kayıtları ve kaynak kartları

Ana temas noktaları:

- `apps/api/src/ai/ajan/araclar/uclar.ts`: ilgili controller tanımı ve yetki kaynağı.
- `okuma.ts`: salt okunur modül araçları.
- `onayli.ts` / `ai-onay.service.ts`: yeni öneriden kalıcı işleme onaylı geçiş.
- `finans-kaynaklari.ts`: modülün gerçek dönem, tutar ve kayıt bağlantısına dayanan kart.
- Modül service/hesap dosyası: tek hesap kaynağı; AI modülünde ikinci hesap yazılmaz.
- Web bileşenleri: kaynak, kapsam, belirsizlik, öneri ve onay görünümü.

### 5.3 Önerilen araç/API kataloğu

İsimler taslak sözleşmedir; yalnız “mevcut” yazan endpoint bugün vardır.

| Önerilen araç | Sınıf | Dayanak / hedef |
|---|---|---|
| `gelen_fatura_fiyat_analizi` | Okuma | Mevcut `POST /ebelge/gelen/:id/fiyat-analizi`; onaylanmış ürün/varyant eşleştirmesi |
| `cek_senet_vade_analizi` | Okuma | Mevcut `GET /kasa-banka/cek-senet-vade-analizi` |
| `nakit_akisi_senaryolari` | Okuma | Mevcut `GET /nakit-akisi?ufuk=7|30|90` |
| `nakit_senaryosu_onizle` | Okuma | Önerilen yan etkisiz senaryo endpoint'i; sınırlı değişiklik gövdesi |
| `butce_sapmalari` | Okuma | Mevcut `GET /butce/:yil/karsilastirma` |
| `satin_alma_teklif_karsilastir` | Okuma | Talep/teklif görünümü ve karşılaştırma servisi; mali alan yetkisi ayrıca kontrol edilir |
| `stok_ihtiyac_analizi` | Okuma | Önerilen stok ihtiyaç endpoint'i |
| `satin_alma_onerisi_hazirla` | Okuma | Önerilen birleşik stok/teklif/bütçe/nakit önizlemesi; kayıt açmaz |
| `satin_alma_talebi_olustur` | Onay | Mevcut talep oluşturma endpoint'i; sonraki onay aşaması ayrı |
| `uretim_sapma_analizi` | Okuma | Mevcut kapasite/maliyet/malzeme uygunluğu sonuçları |
| `duzeltme_aciklamasi` | Okuma | Rol kapsamındaki düzeltme/kapanış kontrol sonuçları |

### 5.4 Veri modeli ve migration yaklaşımı

İlk sohbet/rapor bağlantılarında yeni tablo zorunlu değildir. Veri yeterli olmadan bütün modüllere ortak büyük bir AI tablo ailesi eklenmez.

| İhtiyaç | Başlangıç tercihi | Kalıcılık gerekirse |
|---|---|---|
| Modül özellikleri, eşikler, karşılaştırma penceresi | Mevcut `ModulAyar`, sıkı Zod şeması | Şema sürümü, geriye uyumlu varsayılan |
| Kişisel hatırlatma tercihi | Mevcut bildirim tercihlerinin uygunluğu incelenir | Tenant/user kapsamlı alan veya ayrı tablo; şirket politikasını aşamaz |
| Salt okunur analiz | İstek süresi snapshot | Yalnız karşılaştırma/denetim ihtiyacı varsa içerik ve saklama amacı belirlenir |
| Teklif OCR | Kullanıcıya geçici öneri | Mevcut teklif kaydı/ekler, yalnız açık kayıt onayından sonra |
| Ödeme sözü | Yeni yapılandırılmış domain kaydı adaydır | Cari, tutar/döviz, tarih, kullanıcı, durum ve olay geçmişi |
| Tahmin performansı | P4 veri tasarımında belirlenir | Tahmin tarihi, veri kesim tarihi, model/sürüm, sonradan gerçekleşen |
| Mükerrer çek adayı | Önce bileşik arama | Normalizasyon indeksi; yanlış pozitif değerlendirilmeden zorunlu tekillik eklenmez |

Yeni kiracı tablosu gerekiyorsa tenant/user FK'leri, indeksler, `ENABLE/FORCE RLS`, uygulama rolünün minimum izinleri ve iki tenant kabul testi birlikte teslim edilir. Migration önce test/staging'de denenir; üretim verisi silinmez. Hassas içerik ve saklama süreleri ayrı ürün kararına bağlanır.

## 6. Fazlar, bağımlılıklar ve tahmini takvim

Kapasite varsayımı: 2 tam zamanlı geliştirici, yarı zamanlı QA, ürün/alan uzmanı ve operasyon desteği. Bunlar atanmış kişiler veya garantili süreler değildir. Süreler mevcut kodun yeniden kullanılacağı varsayımıyla ön tahmindir; veri hazırlığı, dış erişim ve ürün onayı bekleme süresi ayrıca değerlendirilir.

| Faz | Odak | Ön koşul | Ön tahmin | Çıkış |
|---|---|---|---|---|
| P0 | Doğruluk, veri/üretim envanteri, politika, kalite | İster gözden geçirmesi | 1–2 hafta | Güvenilir analiz sözleşmesi ve test kapısı |
| P1 | Mevcut finans/çek/fiyat analizlerini asistana bağlama | P0 | 2–3 hafta | Salt okunur pilot paket |
| P2 | Satın alma, stok ve birleşik öneri | P0 + ilgili P1 bağlantıları | 3–4 hafta | Onaylı ihtiyaç–tedarik akışı |
| P3 | Banka/POS, tahsilat, masraf ve kapanış | P0 + P1 | 3–4 hafta | Açıklanabilir operasyon paketi |
| P4 | Üretim, satış, tahminlerin doğrulanması | P0; ilgili veri yeterliliği | 3–4 hafta | İleri karar desteği |
| P5 | CRM, proje, kanal, personel ve sevkiyat | İlgili veri/yetki kapıları | 3–5 hafta | Seçimli modül genişletmeleri |
| P6 | Pilot, yayın ve takip | Her sürümün testleri | Sürüm başına ayrılmış 1–2 hafta | Kontrollü üretim kabulü |

İlk MVP: P0 + P1 + P2 + P3 + ilgili P6; seri planlamada yaklaşık 10–15 hafta. Bütün seçilmiş genişletmeler: yaklaşık 16–24 hafta. P5'in tamamı zorunlu değildir. P6 yalnız program sonunda değil her üretim sürümünde uygulanır; ek yayın döngüleri toplam süreyi uzatabilir.

Bağımlılık omurgası:

```text
P0 → P1 → P2 → birleşik satın alma pilotu
  └────→ P3 → operasyon pilotu
  └────→ P4 → veriyle doğrulanmış ileri analiz
  └────→ P5 → seçilen modüllerin kontrollü genişlemesi
Her yayın → P6 → izleme → sonraki kapsam kararı
```

## 7. Ayrıntılı iş paketleri

Bu bölümdeki bütün yeni paketlerin başlangıç durumu **planlandı**dır. 14 Ekim ilerleme kaydı: P0-01 **devam ediyor**; altyapı/katalog, salt okunur tarama aracı ve seçilmiş şirketin 21 profil taraması tamamlandı. Yerel sürüm geçişi ve yeni aktarım onayı metadata'sı doğrulandı; alan doğrulaması ve pilot kabulü açık. Ayrıntılar [P0-01 envanter raporunda](AI-P0-01-HAZIRLIK-ENVANTERI-2026-10-14.md). P0-02'nin kapsam/sayı gösterimi, olgu yanıtı ve kabul testleri geliştirildi; kullanıcı onayıyla 21:56'da yerel çalışan sürüme alındı, paket/pilot kabulü hâlâ açık. Diğer paketler planlandı durumundadır. Mevcut özellik üzerine kurulu olması paketi tamamlanmış yapmaz. “Backend”, “Frontend”, “QA”, “Ürün” ve “Operasyon” önerilen sorumluluk rolleridir; görev ataması yapılmamıştır.

### P0-01 — Veri ve üretim hazırlığı envanteri

Ön koşul: İnceleme için tenant/veri kapsamı ve erişim yetkisi belirlenir. Sorumlu: Backend + Ürün + Operasyon.

- API/web/worker sürümü, migration durumu ve etkin sağlayıcı/model türleri içeriksiz kaydedilir; anahtarlar rapora alınmaz.
- Modül başına tarih aralığı, boş alanlar, stok/varyant/birim eşleşmeleri, iptal/iade ayrımı ve kayıt hacmi ölçülür.
- Tedarik süresi, açık sipariş, teklif geçerliliği, ödeme kapanışı, gerçekleşen teslim ve üretim sarfı gibi gerekli veri boşlukları listelenir.
- Genel raporla erişilen alan ile özel araç gerektiren alan ayrılır.

Kabul: “Yeterli / kurala dayalı ilk sürüme yeterli / veri toplama gerekli” sınıflaması modül bazında vardır. Canlıya alınmamış kod açıkça işaretlidir. Veri içeriği veya hesap bilgisi loglara dökülmez. Bu paket gerçek müşterinin verisini değiştirmez.

### P0-02 — Sayısal doğruluk ve kapsam tutarlılığı

İlerleme (14 Ekim): **Devam ediyor**. Nakit/bordro kapsamı ve teminat–nakit ayrımı açıklandı; kaynaklarda güvenli sayı aralığı dışındaki number değerleri uyarıyla dışlandı. Olgu kimlikli seçim + uygulama şablonu, geçersiz/model hatasında güvenli kaynak özeti ve sohbet metadata'sı eklendi. Gelir-gider, katalog raporu ve finans özeti için ekran controller'ı/AI aracı eşitliği gerçek PostgreSQL ve RLS altında 3 senaryoda İstanbul/UTC saat dilimlerinde doğrulandı. İzole gerçek HTTP/JWT/rol + Chromium senaryosu yeni derleme üzerinde de geçti; kullanıcı onayıyla yerel API/worker/web 21:56'da yeni sürüme alındı. Sağlık ve web dosya kimliği doğrulandı. Tam uygulama/worker iş teslimi, kullanıcı pilotu, büyük tutarlı hesap motoru ve canlı model kabulü açık. Ayrıntılar [P0-02 çalışma kaydında](AI-P0-02-SAYISAL-TUTARLILIK.md).

Ön koşul: P0-01. Sorumlu: Backend + Alan uzmanı + QA.

- Nakit akışındaki SGK/muhtasar kapsam açıklaması ile bordro kalemlerinin dahil edilmesi hizalanır; eksik ödeme takibi açıkça belirtilir.
- Vade portföyü ile beklenen nakit farklı tanımlar olarak korunur: teminat/ciro evrakları sırf vade tablosunda var diye nakit girişine eklenmez.
- Tarih, kur, net/brüt, tahakkuk/nakit ve iptal/iade kuralları analiz metadatasında tanımlanır.
- Olgu kimlikli açıklama ve güvenli geri dönüş hazırlanır; desteklenmeyen tutar/oran/tarih metne geçirilmez.

Kabul: Aynı filtre/dönemle ekran ve araç tutarları aynıdır. Büyük/negatif tutar ve karma döviz testleri geçer. Kapsam açıklaması gerçek hesapla uyuşur. Model hatası kaynak kartlarını gizlemez. Bağımsız yeni bir vergi/kâr hesabı oluşmaz.

Yayın sonucu (14 Ekim 21:56): Yeni API/web derlemeleri, 85 birim testi ve 7 kabul testi başarılı. Derlenmiş bileşenler + üretim Next üzerinde izole HTTP/Chromium doğrulandı. Kullanıcı onayıyla yerel API/worker/web yeni sürüme geçirildi; sağlık ve web dosya kimliği doğrulandı, aktarım onayı korundu. [Geçiş ve geri dönüş kaydı](AI-P0-02-YAYIN-ADAYI-2026-10-14.md). Tam paket/pilot ve canlı model kabulü henüz tamamlanmadı.

### P0-03 — Modül politikası, eşikler ve maliyet koruması

Ön koşul: P0-01. Sorumlu: Backend + Frontend + Ürün.

- Global AI anahtarının altına modül bazlı aç/kapat seçenekleri önerilir; eski tenant davranışı geçişte belgelenir.
- Yönetici; fiyat artış eşiği, karşılaştırma süresi, kritik stok/nakit sınırı ve model yorumunun açık/kapalı olmasını yönetir.
- Şirket ayarı ve kişisel kanal tercihi ayrılır; kullanıcı şirket yetkisini/eşiğini aşamaz.
- Mevcut aylık bütçe izlemesi sert harcama kesintisi gibi sunulmaz. Sert kesinti gerekiyorsa eşzamanlı rezervasyon, kullanım bilinmeyince davranış ve gün/ay sınırı ayrı tasarlanır.

Kabul: Yetkisiz ayar değişimi reddedilir. Modül kapalıyken modele çağrı yapılmaz, manuel akış çalışır. Geçersiz eşik/eksik kur varsayılmaz. İçeriği olmayan çağrı maliyeti ve başarı metadata'sı izlenir.

### P0-04 — Ortak kalite, güvenlik ve kabul paketi

Ön koşul: P0-02 ve P0-03. Sorumlu: QA + Backend.

- Mevcut üç canlı kalite senaryosu fiyat, çek, teklif, bütçe, banka ve üretim senaryolarıyla genişletilir.
- Sentetik/etiketli örnekler, bozuk/bulanık belgeler, yanlış tenant, belirsiz cari/ürün, manipüle edilmiş belge talimatları ayrı değerlendirilir.
- Finansal doğru sonuç, doğru kaynak, güvenli “bilmiyorum” ve onay olmadan yazmama ayrı ölçülür.
- Canlı sağlayıcı testleri yalnız açık sağlayıcı/model seçimi, veri aktarım kararı ve maliyet onayıyla çalışır; test atlandıysa başarılı sayılmaz.

Kabul: Yeni araçlar için pozitif/negatif, rol, iki tenant ve mutasyon/idempotency senaryosu vardır. OCR alan doğruluğu modelin kendi güven skoru yerine etiketli örnekle ölçülür. Modül bazlı regresyon raporu üretilir.

### P1-01 — Gelen e-Fatura fiyat analizinin sohbet bağlantısı

Ön koşul: P0-02, P0-03, P0-04. Sorumlu: Backend + Frontend.

- Mevcut fiyat endpoint'i özel okuma aracına bağlanır; kullanıcıca doğrulanmış stok/varyant seçimi kullanılır.
- Son alış, tedarikçilerin son alışları, yıllık ağırlıklı değişim ve kaynak faturalar karta taşınır.
- Yeni yorum sayısal hesap yapmaz; kullanıcı eşiği aşıldığında açıklanmış uyarı üretir.

Kabul: Yalnız aynı döviz/birimde karşılaştırma yapılır; mevcut destek sınırları korunur. Eksik/kesilmiş geçmişte yıllık oran uydurulmaz. Fatura kendi geçmişine katılmaz. Araç fiyatı/faturayı değiştirmez; sohbet geçmişinde kapsam ve kaynak korunur.

### P1-02 — Çek/senet okuma ve vade geliştirmesi

Ön koşul: P0-02, P0-03, P0-04. Sorumlu: Backend + Frontend + QA.

- Vade analizi özel okuma aracı ve kaynak kartına bağlanır.
- OCR'de düzenleme tarihi ve vade tarihi ayrı alanlar olarak çıkarılır; hangisinin çek/senet için kullanılacağı belirsizse kullanıcı seçer.
- Alan bazlı belirsizlik ve düzeltme sayısı izlenir; aynı modelin yazı/rakam okuması bağımsız denetim sayılmaz.
- Mükerrer evrak adayı numara/banka/hesap/keşideci/tutar/döviz gibi bileşik verilerle önerilir. Aynı numara her bankada tekil sayılmaz.
- Mevcut 0–90 gün şirket ayarı ve vade günü aç/kapat korunur. Kişisel kanallar ve worker kesintisi sonrası telafi penceresi ürün kararıyla genişletilir.

Kabul: Tarih tahminiyle kayıt açılmaz, form alanı değişince onay sıfırlanır. Aynı OCR tekrarından otomatik kayıt oluşmaz. Mükerrer uyarıda adayların kaynağı vardır; kullanıcı yönlendirmeden eski kayıt silinmez. Vade, ciro/teminat ve nakit anlamı ayrıdır. Telafi açıksa aynı evrak/vade/aşama için mükerrer teslimat oluşmaz; belge vadesi hafta sonu diye değiştirilmez.

### P1-03 — Nakit senaryosu ve açıklama asistanı

Ön koşul: P0-02, P0-04; ayarlar için P0-03. Sorumlu: Backend + Frontend.

- Mevcut 7/30/90 günlük üç senaryo sonuçları, ilk eksi/en düşük bakiye ve kaynak kalemler araçla açılır.
- “Müşteri ödemesi gecikirse” veya “yeni ödeme eklenirse” gibi sınırlı geçici senaryolar için yan etkisiz endpoint tasarlanır.
- Kaynak kaydı, miktar/tarih aralığı ve senaryo adı doğrulanır; yalnız izinli değişiklikler uygulanır.
- Gerçek belge ile senaryo değişikliği farklı görselle gösterilir; senaryo fatura/çek vadesini güncellemez.

Kabul: Senaryo motoru ekranla aynıdır. Aynı yükümlülük fatura/çek/talimat nedeniyle iki kere sayılmaz. Eksik kur ve kapsam dışı veriler görünür. Yetkisiz kaynak üzerinde senaryo kurulmaz. Önizleme sonrası gerçek kayıtlar değişmeden kalır.

### P1-04 — Bütçe sapmalarının kaynaklı açıklaması

Ön koşul: P0-02, P0-04. Sorumlu: Backend + Frontend.

- Mevcut yıl/revizyon/gerçekleşen karşılaştırması özel okuma aracına bağlanır.
- En büyük sapma katkıları, plansız gider ve eksik gelir kategorileri ilgili kayıtlarla gösterilir.
- Fiyat/miktar katkısı yalnız karşılaştırılabilir veri varsa ayrıştırılır; kanıtlanmayan iş nedenleri “olası” diye etiketlenir veya verilmez.

Kabul: Bu yılın gerçekleşeni tam yıl planıyla yanlış kıyaslanmaz; mevcut dönem hesabı korunur. İlk/geçerli revizyon görünür. AI bütçe satırını veya onayını değiştirmez. Katkı toplamı asıl sapmayla uzlaşır; ayrıştırılamayan fark saklanmaz.

### P2-01 — Tedarikçi tekliflerinin OCR/e-postadan hazırlanması

Ön koşul: P0-04; eşleştirme ve kaynak için P1-01. Sorumlu: Backend + Frontend.

- Teklif PDF/görsel/e-postasından ürün, miktar, birim, birim fiyat, iskonto, döviz, teslim süresi ve geçerlilik önerisi çıkarılır.
- Talep kalemine bağlama barkod/kod/varyant temelli yapılır; belirsiz satır kullanıcı seçimine bırakılır.
- Belge veya maildeki ödeme/gönderim talimatı yürütülmez. Girdi boyut/sayfa sınırları mevcut dosya politikasına dayanır.
- Kullanıcı doğruladıktan sonra mevcut teklif giriş ucu kullanılır; mevcut şemada bulunmayan ticari şart yapılandırılmış alan eklenmeden sıralama hesabına alınmaz.

Kabul: Her talep kalemi tek eşleşir; eksik/fazla kalem uyarılır. Toplam mevcut teklif hesabıyla uzlaşır. Para/birim tahmin edilmez. Dış veri kendi onayını yaratamaz. OCR başarısı teklifin kayıtlı veya seçilmiş olduğu iddiasına dönüşmez.

### P2-02 — Karşılaştırılabilir tedarikçi değerlendirmesi

Ön koşul: P1-01 ve P2-01. Sorumlu: Backend + Alan uzmanı + Frontend.

- Geçmiş alış, geçerli teklifler, teslim süresi ve ürün/varyant şartları birlikte gösterilir.
- Kullanıcı ağırlıkları/öncelikleri varsa görünürdür; “en ucuz” ile “seçim önerisi” ayrıdır. Eşit adaylar keyfi tek adaya indirilmez.
- Tarihsel birim ve kur dönüşümü ayrı genişletme olarak uygulanır: fiyat tarihi, dönüşüm kaynağı ve miktar katsayısı kaydedilir; bugünkü katsayı geçmişe sessiz uygulanmaz.
- Teslim performansı/iade oranı için önce gerçekleşen kayıt uygunluğu doğrulanır. Veri yoksa tedarikçiye sahte performans puanı verilmez.

Kabul: Miktar/vade/navlun farkları eksikse sonuç şartlıdır. Eski alış güncel teklif sayılmaz. Süresi geçmiş teklif ayrı işaretlenir. Belirsiz dönüşüm aday sıralamasından dışlanır. Her kriterin kaynağı ve puana katkısı görülebilir.

### P2-03 — Stok ihtiyacı ve tükenme önerisi

Ön koşul: P0-01, P0-02, P0-04. Sorumlu: Backend + Frontend + Stok alan uzmanı.

- İlk sürüm satış/tüketim geçmişi, kullanılabilir stok, rezervasyon, açık alış ve tedarik süresiyle açıklanabilir ihtiyaç hesabı yapar.
- Transfer, iade, fire ve üretim sarfı talep tüketimiyle karıştırılmaz. Kaynak hareket türleri açık tanımlanır.
- Depo/varyant/ana birim düzeyi korunur; stokta olmayan günler ve eksik geçmiş işaretlenir.
- Güvenlik stoku, önerilen miktar ve nedenleri görünürdür. Öneri stok hareketi veya sipariş oluşturmaz.

Kabul: Rezerve miktar ve beklenen teslim bir kere hesaba katılır. Sıfır/seyrek talepte tükenme tarihi uydurulmaz. Eksik tedarik süresi varsayılanla gizlenmez. Dönüşüm ve negatif stok testleri geçer. Kullanıcı öneriyi değiştirebilir; asıl kayıt etkilenmez.

### P2-04 — Satın alma önerisinin bütçe/nakit etkisi ve onaylı talep

Ön koşul: P1-03, P1-04, P2-02, P2-03. Sorumlu: Backend + Frontend + QA.

- Stok ihtiyacından seçilen kalemlerin teklif tutarı, bütçeye ve nakit senaryosuna etkisi tek önizlemede hazırlanır.
- Mevcut talepler, siparişler ve planlanmış ödemeler nedeniyle aynı ihtiyaç iki kez önerilmez.
- Onay önizlemesine kaynak sürümü/özeti bağlanır; fiyat/kur/stok/rol değişirse yeniden doğrulama gerekir.
- Açık kullanıcı onayıyla yalnız talep oluşturulur. Talep gönderme/onaylama/siparişe dönüştürme sonraki bağımsız işlemlerdir.

Kabul: Talep sahibinin kendi talebini onaylaması ve bütçe gerekçesi kuralları korunur. Tekrar tıklama/worker retry/HTTP tekrarı tek talep oluşturur. Eşzamanlı veri değişimi eski önizlemeyi geçersiz kılar. Öneri otomatik banka ödemesi oluşturmaz.

### P3-01 — Banka eşleştirmesinin açıklanması ve kısmi ödeme incelemesi

Ön koşul: P0-02, P0-04. Sorumlu: Backend + Frontend.

- Mevcut IBAN/VKN/fatura no/tutar/kural/AI adaylarının kanıtları görünür hale getirilir.
- Bir ödeme–çok fatura, kısmi ödeme ve masraf/komisyon farkları mevcut domain hesabıyla sunulur.
- Kabul/red/düzeltme geri bildirimi eşleşme kalitesini ölçer; kullanıcı kararı doğrulanmadan tenant kuralı otomatik öğrenilmez.

Kabul: Belirsiz adayda seçim istenir. Kapalı/iptal fatura önerilmez. Dağıtım toplamı banka tutarıyla toleransına göre uzlaşır. Dil modeli “karşı taraf adı” üzerinden doğrudan muhasebe kaydı yazamaz. Toplu işlemin tamamı önizleme/onaya tabidir.

### P3-02 — POS ve pazaryeri kesinti/fark incelemesi

Ön koşul: P0-01, P0-02, P0-04. Sorumlu: Backend + Alan uzmanı.

- POS'tan bankaya beklenen ve geçen tutar, komisyon, iade ve settlement dönemi ilişkilendirilir.
- Pazaryeri kesinti kaydı sipariş/hakedişle eşleştirilir; sözleşmede tanımlı oran yoksa “fazla komisyon” hükmü verilmez.
- Kesinti giderleştirme veya iade/ödeme ayrı mevcut onaylı iş akışından geçer.

Kabul: Brüt/net, iade ve döviz ayrı görünür. Sağlayıcı kaydı tekrarı iki fark oluşturmaz. Eksik dönem veya ilişki “uyumsuzluk kesin” yerine inceleme adayıdır. Banka/POS ağına yeni transfer başlatılmaz.

### P3-03 — Tahsilat takibi ve ödeme sözü

Ön koşul: P0-04; nakit etkisi için P1-03. Sorumlu: Backend + Frontend + Ürün.

- Mevcut risk/öncelik hesabı korunur; açıklama ve görev önerileri ona dayanır.
- Ödeme sözü tutar/döviz/tarih/kaynak görüşme/kullanıcı/durum olarak yapılandırılır.
- Görüşme notu özeti, sözün takibi ve hatırlatma taslağı önerilir; gönderim mevcut onay/tercih kapısından geçer.
- Söz gerçekleşmeyince durum ve nakit senaryosu güncellenebilir; kesin tahsilat yapılmış sayılmaz.

Kabul: Fatura kalanı mevcut motorla aynıdır. Ödeme sözü bakiye kapatmaz. Aynı görüşme tekrarından çift görev/söz açılmaz. Onaysız e-posta gönderilmez. Veri yetersizken müşteri hakkında yüksek güvenli risk iddiası üretilmez.

### P3-04 — Masraf anomali ve mükerrer adayları

Ön koşul: P0-01, P0-04; bütçe görünümü için P1-04. Sorumlu: Backend + Frontend.

- Satıcı/numara/tarih/döviz/tutar bileşimiyle mükerrer aday ve kategori bazlı sıra dışı artış belirlenir.
- İlk sürüm eşik/benzerlik temellidir; yeni satıcı veya artan tutar sahtecilik sonucu sayılmaz.
- Kullanıcı kabul/red gerekçesi bırakır; ilişkilendirme ve düzeltme mevcut yetkilerle yapılır.

Kabul: İptal/iade ve tekrar içeri aktarma ayrılır. Kanıtlanan eşleşme ile olası benzerlik farklıdır. Otomatik masraf silme/iptal yoktur. Yanlış pozitif oranı pilotta ölçülür; yeni eşik mevcut doğru kayıtları bozmaz.

### P3-05 — Düzeltme ve dönem kapanış asistanı

Ön koşul: P0-04, ilgili P3 analizleri. Sorumlu: Backend + Frontend + Muhasebe alan uzmanı.

- Mevcut kontrol/neden kodlarından kaynaklı açıklama ve önerilen çalışma sırası üretilir.
- Rol kapsamındaki eksik kayıtlar, sorumluluk ve sonraki güvenli adım gösterilir.
- Dönem kapanışında başarısız kontrol açıklanır; kontrol sonucu AI tarafından başarılıya çevrilmez.

Kabul: Kaynak hatası çözülmeden yalnız metinle kontrol kapanmaz. Kapalı dönem/TOTP kapıları korunur. Yeni açıklama yetki alanını genişletmez. Kapanış kanıt paketi mevcut kayıtlarla uzlaşır; AI yorumu resmi hesap yerine geçmez.

### P4-01 — Satış fiyatı, marj ve teklif yardımcısı

Ön koşul: P0-02, P0-04; gelişmiş tarihsel fiyat için P2-02. Sorumlu: Backend + Satış/maliyet alan uzmanı.

- Mevcut kurala dayalı fiyat önerisine gerçekleşen maliyet/iskonto/vade etkisinin açıklaması eklenir.
- Satış anındaki maliyet ile bugünkü kart maliyeti ayrılır; düşük marjlı teklif kullanıcıya gösterilir.
- Teklif taslağı yan etkisiz hazırlanır; fiyat listesi güncellemesi ayrı açık onay gerektirir.

Kabul: Maliyet bilinmiyorsa kâr marjı iddia edilmez. Döviz/birim/varyant kıyası geçerlidir. Minimum marj kuralları model tarafından değiştirilemez. Bayiye iç maliyet veya başka bayi fiyatı sızmaz.

### P4-02 — Üretim kapasite, malzeme ve maliyet açıklaması

Ön koşul: P0-04, P2-03. Sorumlu: Backend + Frontend + Üretim alan uzmanı.

- Mevcut kapasite, malzeme uygunluğu ve maliyet sapması araçlara bağlanır.
- Tamamlanan miktara oranlanmış plan ile gerçekleşen maliyetin malzeme/operasyon/gider katkısı açıklanır.
- Sınırlı geçici plan önerisi hazırlanır; iş merkezi/vardiya/tatil/rezervasyon kısıtları hesap motoruyla doğrulanır.

Kabul: Maliyet alanları rol bazında süzülür. Bitmiş/iptal emirler yanlış kapasite yükü oluşturmaz. Açıklama katkıları asıl sapmayla uzlaşır. Model stok rezervi veya üretim emrini onaysız değiştirmez.

### P4-03 — Üretim kalite örüntüleri

Ön koşul: P0-01, P4-02. Sorumlu: Backend + Kalite alan uzmanı + QA.

- Fire, karantina, yeniden işleme ve kalite kararlarının ürün/parti/operasyon dönemleri karşılaştırılır.
- Tekrarlayan sorunlara kaynaklı inceleme önerisi verilir; kayıtların eşzamanlılığı kesin neden olarak sunulmaz.
- Kamera/sensörle kalite veya kestirimci bakım bu pakete dahil değildir; veri toplama ve ayrı ürün onayı gerektirir.

Kabul: Üretim miktarı değişimi normalize edilmeden fire oranı karşılaştırılmaz. Numune ve toplam üretim ayrıdır. Operatör performansına kanıtsız hüküm verilmez. AI kalite onayı/karantina kaldırma yetkisi kazanmaz.

### P4-04 — Talep/tahsilat tahmini ve gerçekleşen doğrulaması

Ön koşul: P0-01, P0-04; alanına göre P2-03 veya P3-03. Sorumlu: Backend/veri uzmanı + Alan uzmanı.

- Basit mevcut kural, hareketli ortalama ve uygun mevsimsel referans önce ölçülür; yeni model bunlarla karşılaştırılır.
- Tahmin tarihi/veri kesimi/sürüm/öngörü ufku ve sonradan gerçekleşen ayrı kaydedilir.
- Geçmişten geleceğe test yapılır; gelecekte öğrenilen fiyat, kapanış veya ödeme bilgisi geçmiş tahmine verilmez.
- Stokta yokluk, seyrek talep ve yeni ürün için ayrı davranış belirlenir. Tek sayı yerine veri uygunsa aralık/belirsizlik sunulur.

Kabul: Referanstan daha iyi olduğu doğrulanmayan model üretime terfi etmez. Sıfır gerçek değerlerde oran hata ölçüsü tanımsızsa gizlenmez; MAE gibi uygun ölçü kullanılır. Yetersiz veride mevcut kurala geri dönülür. Harici kredi/banka risk skoru varmış gibi gösterilmez.

### P5-01 — CRM ve e-postadan ticari talep/takip

Ön koşul: P0-04; teklif dönüşümü için P2-01. Sorumlu: Backend + Frontend + Satış alan uzmanı.

- E-posta/görüşmeden ürün, miktar, teslim isteği ve takip tarihi önerisi çıkarılır.
- Mevcut cari/fırsat adayları gösterilir; birini tahmin ederek kalıcı bağ kurulmaz.
- Kullanıcı onayıyla görev/fırsat/teklif hazırlanır. Kazanma olasılığı yalnız yeterli kazanılan/kaybedilen geçmişi ve P4-04 değerlendirmesi varsa eklenir.

Kabul: Dış metin araç talimatı sayılmaz. Aynı e-posta tekrarından çift görev doğmaz. Yanıt önerisi otomatik gönderilmez. Belirsiz teslim tarihi gerçek taahhüde dönüşmez.

### P5-02 — Proje bütçe/kârlılık değerlendirmesi

Ön koşul: P1-04 ve P0-04. Sorumlu: Backend + Proje/muhasebe alan uzmanı.

- Mevcut proje ve alt kırılım gelir/gider/bütçe özetleri kaynaklı açıklamaya bağlanır.
- Tahakkuk kârlılığı ve tahsilat/tediye farklı gösterilir; tamamlanma maliyeti yalnız gerçekleşen iş ve kalan iş verisi uygunsa tahmin edilir.

Kabul: KDV, iade ve kur esası görünür. Eksik proje bağlantısı kalan bütçeyi kesin göstermez. Maliyet verisine yalnız yetkili roller ulaşır. AI proje bütçesi/asamasını kendiliğinden güncellemez.

### P5-03 — Pazaryeri kanal analizi ve B2B yardımcı

Ön koşul: P3-02, P4-01, P0-04. Sorumlu: Backend + Frontend.

- Sipariş/iade/kesinti/maliyet bağlantıları yeterliyse ürün ve kanal katkısı analiz edilir.
- B2B yardımcısı yalnız oturumdaki bayi hesabının katalog/fiyat/sipariş/ekstre kapsamını kullanır.
- Stok alternatifi ve sipariş önerisi verilir; şirketin iç kârlılık araçları bayi kataloğuna taşınmaz.

Kabul: Kanal masrafları eksikken “net kâr” iddiası yoktur. Başka bayinin fiyatı/ekstresi ve iç maliyet alanları hem araç hem çıktı düzeyinde kapalıdır. Sipariş onayı, kredi/risk ve dönem kuralları atlanmaz.

### P5-04 — Personel, müşavir ve mevzuat için sınırlı açıklama

Ön koşul: P0-03, P0-04; hassas veri kapsamı ayrıca onaylanır. Sorumlu: Backend + İK/muhasebe alan uzmanı + Ürün.

- İzinli belge türlerinde sınıflandırma, tarih önerisi ve eksik evrak kontrolü hazırlanır.
- Mevcut bordro/izin/merkezi mevzuat hesaplarının açıklaması kaynak sürümü ve belge tarihiyle verilir.
- Sağlık verisi üzerinden çalışan puanlama, CV'den otomatik eleme ve modelin vergi/oran üretmesi kapsam dışıdır.

Kabul: Veri minimizasyonu, alan/rol filtreleri ve saklama amacı tanımlıdır. Onaysız dış aktarım yoktur. Merkezi mevzuat değerleri model tarafından değiştirilmez. Hukuki uygunluk veya bordro doğruluğu sadece model yorumu ile ilan edilmez.

### P5-05 — Sevkiyat veri tamamlama ve rota hazırlığı

Ön koşul: P0-01 ve P0-04. Sorumlu: Backend + Operasyon alan uzmanı.

- Önce mevcut araç/şoför ve irsaliye bilgilerinin eksikliği/çelişkisi açıklanır.
- Rota için koordinat, teslimat zaman aralığı, kapasite, süre ve maliyet verisinin varlığı ölçülür.
- Gerçek rota optimizasyonu ayrı kapsam kararıdır; yalnız adres metninden süre/maliyet avantajı uydurulmaz.

Kabul: Araç/şoför kişisel verileri yalnız yetkili kapsamda görünür. E-İrsaliye gönderme/onay kuralları korunur. Veri hazır değilse rota özelliği kapalı kalır; bu durum paket raporunda açıkça belirtilir.

### P6-01 — Pilot ve gölge çalışma

Ön koşul: Yayına aday paketlerin testleri ve P0-03. Sorumlu: QA + Ürün + Operasyon.

- Seçilen tenant/modüller açık ürün kararıyla etkinleştirilir; önce salt okunur/gölge değerlendirme yapılır.
- Veri giriş süresi, düzeltme oranı, yanlış öneri, desteklenmeyen yanıt, maliyet ve gecikme ölçülür.
- İnsan onaylı yazma, salt okunur sonuçlar kabul edilmeden açılmaz. Pilot örnekleri canlı sağlayıcıya gönderilecekse ayrıca izin/maliyet kararı alınır.

Kabul: Pilot kullanıcı, model, veri kapsamı, süre ve geri dönüş yolu kayıtlıdır. Üretimden bağımsız etiketli test seti vardır. Atlanan canlı test, tamamlandı raporuna dönüşmez.

### P6-02 — Yayın, canary ve geri dönüş

Ön koşul: P6-01 ve sürüm kabul kapısı. Sorumlu: Operasyon + Backend + QA.

- Onaylanan artifact/sürüm, geriye uyumlu migration, API/web/worker uyumu ve yedek geri yükleme hazırlığı kontrol edilir.
- Yeni modül bayrağı önce seçilmiş pilot tenant'lara açılır. Evrensel yüzdeyle tenant seçilmez; erişim ve veri kapsamı açık belirlenir.
- Sağlık ve sentetik smoke kontrolleri yapılır; eski sürüm/manuel akışa dönme provası tamamlanır.
- Test/deploy komutları planın parçasıdır, bu belgenin oluşturulması restart/deploy/harici gönderim yetkisi vermez.

Kabul: Kritik güvenlik/veri kaybı bulgusu yoktur. Yeni özelliği kapatınca manuel iş devam eder. İleri migration geri alınmadan önce eski sürümün yeni şemayla uyumu doğrulanmıştır. Yalnız feature kapatma ile muhasebe etkisi geri alındı iddiası yapılmaz; oluşmuş mali kayıtlar mevcut düzeltme süreçlerine tabidir.

### P6-03 — Üretim sonrası kalite ve bakım

Ön koşul: P6-02. Sorumlu: Operasyon + QA + Ürün.

- Model/modül bazında yanıt gecikmesi, hata, token, maliyet, onay/red/düzeltme, idempotency tekrarı ve worker başarısı izlenir.
- Hassas belge/prompt içerikleri genel loglara alınmaz; geri bildirim ve audit saklama süreleri mevcut politikalara bağlanır.
- Model/prompt/hesap sürümü değiştiğinde ilgili regresyon ve etiketli set yeniden çalıştırılır.
- Kullanıcı talebi doğrulanmadan yeni otomasyon/geniş erişim açılmaz.

Kabul: Nöbetçi/sorumlu, alarm eşikleri ve olay müdahale notu vardır. Aynı sorunda çoklu alarm baskılanır; düzelince kapanır. Başarısız AI yorumu temel ERP hizmetini durdurmaz. Geri dönüş kararı ve kullanıcı etkisi kayda alınır.

## 8. Test matrisi ve üretim kabul ölçütleri

### 8.1 Zorunlu test katmanları

| Katman | Zorunlu senaryolar | Başarı ölçütü |
|---|---|---|
| Hesap birimi | Kuruş, negatif/büyük tutar, sıfır baz, dönem sınırı, birim/döviz, iade/iptal | Tek hesap motoruyla tam uzlaşma; yalnız belgelenmiş domain toleransı |
| Controller/HTTP | Geçersiz şema, rol, modül kapalı, tenant dışı ID, kaynak değişimi | Geçersiz işlemden yazma/dış çağrı oluşmaz |
| PostgreSQL/RLS | İki tenant, yanlış user, FK, FORCE RLS ve uygulama rolü | Veri sızıntısı ve tenant dışı yazma: 0 |
| İdempotency/yarış | Çift tıklama, aynı istek, farklı payload, iki worker, retry | Yetkili tek onaydan birden çok mali/taslak kayıt: 0 |
| E2E | OCR düzenleme/onay, belirsiz seçim, analiz filtreleri, mobil erişim, yetkisiz görünüm | Onaysız otomatik kayıt: 0; alan değişimi onayı geçersiz kılar |
| Gerçek model | Etiketli belge/sorular, düşük kalite, belirsiz ve kötü niyetli içerik | Modülün imzalı pilot ölçütlerini sağlar; yapılandırma yoksa test atlandı |
| Performans | Sınırlı/büyük tenant hacmi, eşzamanlı okuma, uzun OCR | Veri hacmi ve SLA P0'dan sonra belirlenir; p50/p95 raporlanır |
| Operasyon | Worker kesintisi, mail/model/DB hatası, bayrak kapatma, sürüm geri dönüşü | Temel ERP çalışır; retry/tekrar/teslimat politikası tutarlıdır |

Gerçek DB testleri yalnız kendi fixture'larını kullanır ve rollback veya açık test kaydı temizliği uygular. Test amacıyla gerçek tenant'ın sohbet, evrak veya muhasebe verisi temizlenmez.

### 8.2 Ölçülebilir pilot eşikleri — öneri, henüz onaylı değil

- Finansal kaynak ve görüntülenen hesapların uyuşması: onaylı test setinde %100; yuvarlama/tolerans varsa alan bazında önceden tanımlanır.
- Tenant/rol ihlali, onaysız kalıcı işlem ve çift mali kayıt: 0; tek olay bile ilgili özelliği durdurma nedenidir.
- OCR ilk pilot seti: belge sınıfı başına en az 100 etiketli örnek önerilir; okunabilir/bulanık/eksik örnekler ayrı raporlanır. Tek bir ortalama ile kritik alan hatası saklanmaz.
- Okunabilir belgelerde tutar, döviz, çek no ve doğru tarih alanı için başlangıç adayı: her alanda en az %98 tam eşleşme. Bu hedef sağlansa da insan onayı kaldırılmaz; veri gönderme kapsamı ve eşik ürün kararıyla kesinleşir.
- Banka eşleştirmesinde kabul oranı ve yanlış pozitif ayrı ölçülür. Güven eşiği pilot etiketlerine göre belirlenmeden otomatik eşleşme açılmaz.
- Tahmin için zaman sıralı testte referans kuraldan daha iyi sonuç ve yeterli örnek gerekir; iyileşme eşiği veri audit'inden sonra seçilir.
- Veri girişi/inceleme süresi için pilot öncesi ve sonrası medyan ölçülür; önceden kanıtsız “%80 tasarruf” veya “%100 doğruluk” ilan edilmez.
- Model yorumu ve OCR için farklı gecikme/maliyet bütçeleri seçilir. Kesin SLA/rate değerleri sağlayıcı/model ve veri hacmi belirlenmeden yazılmaz.

### 8.3 Mevcut kanıt ile yeni paket kabulünün ayrılması

Son çek/OCR geliştirmesinde 89 ilgili birim, 2 gerçek PostgreSQL rollback ve 3 izole tarayıcı testi geçmiş; API derlemesi ve web tür kontrolü başarılı olmuştur. Bunlar önceki kapsamın kanıtıdır. Bu belge yazılırken testler yeniden çalıştırılmamış ve P0–P6 yeni paketleri uygulanmamıştır. Gerçek çeklerle canlı model doğruluğu henüz kanıtlanmış değildir.

### 8.4 Geliştirme sırasında kullanılacak doğrulama komutları

Komutlar ilgili uygulama klasöründe çalıştırılır; canlı kalite çağrısı için ayrıca açık yapılandırma gerekir.

```bash
# apps/api — ilgili dosyalar paket bazında seçilir
pnpm exec vitest run src/ai/cek-ocr.test.ts src/ai/cek-ocr.service.test.ts src/kasa-banka/cek-vade-analizi.test.ts
NODE_OPTIONS=--max-old-space-size=4096 pnpm build
pnpm exec vitest run --config vitest.kabul.config.ts test/cek-ocr-vade.kabul.test.ts test/gelen-fiyat-analizi.kabul.test.ts

# apps/web — çalışan üretim sunucusundan izole çek E2E sunucusu kullanılır
pnpm typecheck
pnpm exec playwright test --config playwright.cek.config.ts
```

İlgili testler dışında sürüm kapısında tam API/kabul regresyon kapsamı ayrıca seçilir ve raporlanır. Seçilmiş testlerin geçmesi bütün uygulama testlerinin geçtiği anlamına gelmez. Model testinin çevre değişkenleri/izinleri için `AI-KALITE-TESTLERI.md` kullanılır; gerçek ERP verileri kendiliğinden test sağlayıcısına gönderilmez.

## 9. Üretime geçiş kontrol listesi

- [ ] Paket isterleri, dahil/haric kapsam ve alan bazlı başarı ölçütleri ürün sahibi tarafından kabul edildi.
- [ ] Modülün veri yeterliliği ve eksik veri davranışı doğrulandı.
- [ ] Backend/Frontend sözleşmesi, yetki, maliyet alanları ve kaynak bağlantıları eşlendi.
- [ ] Hesap, HTTP, RLS, yarış/idempotency ve E2E testleri geçti; çalıştırılmayan testler işaretlendi.
- [ ] Gerçek sağlayıcı gerekiyorsa model, aktarım izni, örnek seti ve maliyet limiti açıkça seçildi.
- [ ] Varsayılan özellik davranışı ve eski tenant ayar geçişi doğrulandı.
- [ ] Gerekli migration, RLS/FK/indeks ve eski sürüm uyumu staging'de test edildi.
- [ ] Pilot kullanıcı/tenant, gözlem süresi ve destek sorumlusu belirlendi.
- [ ] API/web/worker artifact'ları aynı onaylı sürümle yayınlanmaya hazır.
- [ ] Bayrak kapatma, geri dönüş ve manuel akış provası tamamlandı.
- [ ] Kaynak metni, kapsam uyarısı, mobil görünüm ve erişilebilirlik kabul edildi.
- [ ] Gizlilik, saklama ve log minimizasyonu kontrol edildi; teknik aktarım onayı tek başına hukuki uygunluk garantisi olarak sunulmuyor.
- [ ] Üretime geçiş için ayrıca yetkili yayın kararı alındı.

## 10. Risk kaydı ve durdurma koşulları

| Risk | Önlem | Durdurma/geri dönüş |
|---|---|---|
| Yanlış cari/ürün/varyant | Aday gösterme, UUID doğrulama, açık seçim | Belirsiz hedefte yazmayı engelle |
| Yanlış fiyat/kur/birim | Tek hesap motoru, tarihli kaynak, kapsam uyarısı | Desteklenmeyen kıyası çıkar; manuel inceleme |
| Eski öneriden işlem | Kaynak sürümü, onay anında yeniden denetim | Önizlemeyi yenile; eski onayı çalıştırma |
| Dış belgede talimat | Güvenilmeyen içerik ayrımı, şema, minimum yetki | Harici içerikten yazma/gönderim doğurma |
| Model/servis maliyetinin artması | Özellik kontrolü, kota, ölçüm, onaylı tarife | Yorumu kapat; ERP raporu çalışmaya devam etsin |
| Worker kaçırma/tekrar | İdempotent aşama, retry, ürünce belirlenmiş telafi | Bildirim açığını raporla; aynı olay için yeni gönderim fırtınası yaratma |
| Veri veya rol sızıntısı | Tenant/user filtreleri, maliyet alan denetimi | İlgili özelliği hemen kapat; olay incelemesi |
| Tahmine aşırı güven | Aralık/örnek sayısı, referansla karşılaştırma | Veri yetersizliği/fallback; kesin taahhüt verme |
| Pilotun genel yayılım sanılması | Ayrı kod/test/model/yayın durumları | Gerekli kapı tamamlanmadan terfi yok |

Bir özellik bayrağı kapatmak mevcut onay taleplerinin geçerli kalıp kalmayacağını da açıkça belirlemelidir. Kapalı özellikten bekleyen mutasyonun yürütülmesi varsayılan olarak engellenir; kullanıcı bilgilendirilir. Yüksek riskli yeni yazma otomasyonları bu karara kadar açılmaz.

## 11. Açık ürün kararları

Plan ilerlemeyi yönlendirir; aşağıdaki seçimler kendiliğinden kullanıcı adına yapılmış değildir:

1. İlk pilot tenant ve gerçek veri/etiketli belge kullanımı.
2. Görsel okuyabilen sağlayıcı/model, veri aktarım kapsamı ve canlı test harcaması.
3. Modül bazlı varsayılan açık/kapalı davranışı ve yönetici yetki kapsamı.
4. Fiyat artışı eşiği, kıyas penceresi, teslim/vade/navlun kriterleri ve ağırlıkları.
5. Kişisel hatırlatma tercihleri, şirket politikası, çalışma saatleri ve kaçırılmış gün telafi penceresi.
6. Stok ihtiyaç formülü, sipariş/rezervasyon esası ve güvenlik stoku politikası.
7. Teklif/senaryo/ödeme sözü için gerekli yeni yapılandırılmış domain alanları.
8. AI onayının satın alma talebini hangi durumda açacağı; mevcut talep/onay ayrılığı korunur.
9. Canlı OCR, eşleştirme ve tahmin kabul eşikleri; örnek kapsamı ve alan uzmanı onayı.
10. P5 modüllerinden hangilerinin gerçekten kullanılacağı; personel/hassas veri sınırları.
11. Kesin ekip kapasitesi, sprint takvimi ve üretim yayın sorumluluğu.

Bu kararlar gerekli paketin başında alınır; tüm programı baştan gereksiz bekletmek için kullanılmaz. Yetki, harici veri aktarımı, yeni iş kuralı veya kapsam genişlemesi gerektiren adımda açık karar alınmadan uygulama yapılmaz.

## 12. İlk sprint başlangıç listesi

İlk uygulanacak işler P0-01 → P0-02 → P0-03 → P0-04'tür. Sonra P1-01 ve P1-02 mevcut ekranlardan salt okunur sohbet entegrasyonuyla başlar.

- [ ] P0-01: Yayın ve veri yeterliliği envanterini çıkar.
- [ ] P0-02: Nakit kapsam metni/hesabı ve kaynaklı sayısal sözleşmeyi doğrula.
- [ ] P0-03: Modül/eşik ayarlarının ürün kararını ve şemasını hazırla.
- [ ] P0-04: Yeni paketler için test/etiketli örnek matrisini kur.
- [ ] P1-01: Gelen fiyat analizi aracının girdi/çıktı ve yetki sözleşmesini gözden geçir.
- [ ] P1-02: Çek vade aracı ve ayrı tarih alanlarının kabul örneklerini belirle.

İlk sprintte amaç bütün modülleri açmak değil, sonraki geliştirmelerin aynı doğruluk/yetki/test standardıyla üretime gidebileceğini kanıtlamaktır.

## 13. Paket durumunu izleme şablonu

Her iş paketi için aşağıdaki kısa kayıt tutulur. “Geliştirildi” ile “üretimde kabul edildi” birleştirilmez.

```text
Paket:
İster/scope onayı:
Sorumlu roller / atanmış kişiler:
Bağımlılıklar:
Veri yeterliliği:
Kod/API/UI teslimi:
Migration ve geriye uyum:
Hesap / HTTP / RLS / E2E sonuçları:
Canlı model testi (geçti / başarısız / atlandı ve nedeni):
Pilot ölçümleri:
Üretim yayın kararı / sürüm:
Bayrak kapatma / geri dönüş:
Açık riskler ve sonraki adım:
```

## 14. Teknik referanslar

- [Mevcut mimari](MIMARI.md): tenant/RLS, iş akışı, audit ve worker ilkeleri.
- [Mevcut isterler](ISTERLER.md): S-01 kapsam kabulü ve ERP iş kuralları.
- [Asistan araçları](../apps/api/src/ai/ajan/araclar/uclar.ts), [kaynak kartları](../apps/api/src/ai/ajan/finans-kaynaklari.ts).
- [Satın alma hesapları](../apps/api/src/satin-alma/satin-alma.hesap.ts), [üçlü eşleştirme](../apps/api/src/satin-alma/uclu-eslestirme.ts).
- [Nakit motoru](../apps/api/src/nakit-akisi/nakit-akisi.hesap.ts), [bütçe motoru](../apps/api/src/butce/butce.hesap.ts).
- [OWASP: Prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/): çıktı doğrulama, minimum yetki, harici içerik ayrımı ve yüksek riskli işlemde insan onayı.
- [scikit-learn: Zaman sıralı değerlendirme](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html): gelecekteki verinin geçmiş değerlendirmeye sızmasını önleyen test yaklaşımı; kullanılacak veri sıklığına uygun değerlendirme tasarlanmalıdır.

Sonuç: İlk yatırım yeni bir genel model veya bütün ERP'yi otomatik yöneten ajan değil; mevcut güvenilir hesapları kaynaklı açıklama, kullanıcı ayarları ve insan onaylı iş akışıyla birleştiren kontrollü modül paketleridir.
