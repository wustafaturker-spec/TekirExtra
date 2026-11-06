# KiviERP Planı — Boşluk Analizi

Tarih: 6 Kasım 2026
Kaynak: `TEKIREXTRA-KIVIERP-GELISTIRME-VE-URETIM-PLANI-2026-11-06.md` (6 faz)
Yöntem: Her faz, depodaki kodla (şema, servis, uç nokta, ekran) karşılaştırıldı.
Durum: **Öneri.** Aşağıdaki ister maddeleri onaylanmadan kodlanmaz (S-01).

Gösterim: ✅ var · 🟡 kısmen var · ❌ yok · ⛔ bilerek yapılmadı

---

## Özet

| Faz | Plan | Sonuç | Gerçek boşluk |
|---|---|---|---|
| 1 | Linkle tahsilat | ✅ büyük ölçüde var | Faturadan/cariden tek tıkla link, WhatsApp paylaşımı, cari bakiyesine link |
| 2 | Banka–fatura eşleştirme | ✅ plandan ileri | Yok denecek kadar az; otomatik kapama bilerek yok |
| 3 | Tekrarlayan + toplu gönderim | 🟡 | **Zamanlayıcı yok**, dönem değişkenleri yok, toplu e-Fatura/e-Arşiv gönderimi yok |
| 4 | Onay hiyerarşisi | 🟡 modül bazında | **Genel kademeli onay matrisi** ve tek onay kutusu yok; masrafta eşik yok |
| 5 | Veri aktarım sihirbazı | 🟡 şablonlu | Sütun eşleme, açılış bakiyesi aktarımı, rakip ERP profilleri, stok önizlemesi yok |
| 6 | Barkodlu sayım | 🟡 sayım var, okutma yok | **Okutma modu** (tabanca/kamera, ses, titreşim) yok |

Plandaki 6 fazdan geriye **4 gerçek iş paketi** kalıyor (3, 4, 5, 6). Faz 1 ve 2 küçük
UX eklemelerine iner.

---

## Faz 1 — Linkle tahsilat · ✅

**Var olan** (KSB-35…43, `apps/api/src/pos/`, `/panel/kasa-banka/pos`):
- `PosTahsilat`: faturaya bağlı ya da serbest tutar, son kullanım tarihi, deneme sayısı, geç ödeme bayrağı.
- iyzico ve PayTR adaptörleri, callback uçları (`/pos/iyzico/callback`, `/pos/paytr/callback`), sorgulama, iptal, iade ve iade geri alma.
- Bağlantının e-posta ve SMS (Netgsm) ile gönderilmesi, yeniden gönderim, makbuz.
- Taksit, komisyon tahmini ve sağlayıcının bildirdiği komisyon, net tutar, bankaya geçecekler.
- Fatura kalanını aşan tutar için uyarı. Banka POS slibi elle girilebiliyor.
- Kart bilgisi olarak yalnız marka, aile ve tür tutuluyor. Plandaki `kartIlkAlti` alanı **gereksiz ve PCI açısından istenmez**.

**Planın önerdiği ama gereksiz olanlar:** `TahsilatLinki` tablosu (`PosTahsilat` var), kendi 3D Secure sayfamız (sağlayıcının barındırdığı sayfa kullanılıyor; kart verisi bize hiç gelmiyor, bu daha güvenli).

**Kalan boşluklar (küçük):**
- Ödeme bağlantısı yalnız `/panel/kasa-banka/pos` ekranından açılıyor. Fatura ve cari detayında "Ödeme bağlantısı gönder" kısayolu yok.
- WhatsApp paylaşımı ve "bağlantıyı kopyala" yok.
- Tek faturaya değil, carinin **toplam açık bakiyesine** bağlantı açılamıyor (dağıtım ödeme sonrası yapılabilir).
- Bağlantının açılıp açılmadığı izlenmiyor (isteğe bağlı).

## Faz 2 — Banka–fatura eşleştirme · ✅

**Var olan** (KSB-06/15/17/34, `kasa-banka/ekstre-*`):
- Vomsis ve banka API'leri ile 5 dakikada bir otomatik çekim, banka webhook'u, CSV/Excel ve PDF ekstre okuma, kredi kartı ekstresi.
- Cari bulma sırası: kural → IBAN → açıklamadaki VKN/TCKN → tam unvan → fatura numarası → tutar → yapay zekâ önerisi. Ad benzerliği puanlanıyor.
- `EkstreKurali`: cari, masraf, gelir ve virman kuralları, kullanım sayısı, eşleştirmeden öğrenilen kurallar.
- Ödeme talimatı numarası, çek ve POS mutabakatı, birden çok faturaya dağıtım, geri alma.
- "Kesin öneri" ve toplu onay: kesin kaynakla bulunmuş cari ve kalanı birebir tutan **tek** açık fatura.

Plandaki +40/+30/+20/+10 puanlama mevcut motordan daha zayıf.

**⛔ Bilerek yok:** "≥90 puanda fatura kendiliğinden kapanır" kuralı. Kesin öneriler de kullanıcı onayıyla (tek tek ya da toplu) işleniyor. Bu, kesinleştirmenin düğme onayıyla yapılması kararıyla uyumlu. **Değiştirilmemeli.**

**Kalan boşluklar (isteğe bağlı):**
- Firma ayarıyla "kesin önerileri gece kendiliğinden işle" seçeneği. Varsayılanı kapalı olur ve ayrıca karar gerekir.
- Açıklamada ETTN aranması. Fatura numarası aranıyor, ETTN aranmıyor.

## Faz 3 — Tekrarlayan fatura ve toplu gönderim · 🟡

**Var olan** (`TekrarlayanFatura`, `/panel/fatura/tekrarlayan`):
- Şablon faturadan haftalık, aylık ve yıllık plan; `aralik` ile 3 ve 6 aylık da kurulabiliyor. Bitiş tarihi, duraklatma.
- Kaçırılan dönemleri geriye dönük üretme (en çok 120), aynı dönemi iki kez üretmeme (`tekrarlayanPlanId + planlananTarih`), advisory lock.
- Üretim geçmişi ve raporlar. Vade, şablondaki gün farkıyla kaydırılıyor.
- e-İrsaliyede toplu gönderim var (en çok 50).

**Boşluklar:**
1. **Zamanlayıcı yok.** `vadesiGelenleriUret()` yalnızca "Vadesi gelenleri üret" düğmesiyle çağrılıyor. Kod yorumu zamanlanmış görevden söz ediyor, ancak worker'da karşılığı yok (öteki modüllerin `*-zamanlayici.service.ts` dosyası var, bunun yok). **En somut eksik.**
2. **Dönem değişkenleri yok.** Açıklama ve satır açıklaması olduğu gibi kopyalanıyor; `{{AY}} {{YIL}} dönemi` gibi ifadeler desteklenmiyor.
3. **Fiyat şablondan donmuş geliyor.** Döviz kuru ve fiyat listesi güncellenmiyor; satırlar şablondaki tutarla kopyalanıyor. Dövizli ya da fiyatı değişen planlarda yanlış tutar riski var.
4. **Üretim yalnız taslak.** "Kesinleştir ve e-Belge olarak gönder" seçeneği yok. Bilerek böyle olabilir; karar gerekir.
5. **Toplu e-Fatura / e-Arşiv gönderimi yok.** Taslakları seçip tek seferde kesinleştirip entegratöre kuyrukla gönderecek uç nokta ve ekran yok. Entegratör çağrı disiplinine uygun hız sınırı gerekir.
6. Plan üretildiğinde bildirim yok (Bildirim Merkezi'ne bağlanabilir).

## Faz 4 — Onay hiyerarşisi · 🟡

**Var olan (modül bazında):**
- **Satın alma (SAT-03/09):** firma ayarındaki tek eşik (varsayılan 25.000 TL). Eşiğe kadar muhasebe ya da yönetici, eşiğin üstünde yalnız yönetici onaylar. Kendi talebini onaylayamama ve yeniden onay kuralları var.
- **Ödeme talimatı:** ikinci kullanıcı TOTP ile onaylar; görev ayrılığı var.
- **Bütçe, izin, sayım, üretim (dört göz), AI onay talepleri:** her biri kendi onayıyla.
- **Masraf:** tek adımlı `onayla` (muhasebe rolü). **Eşik yok, görev ayrılığı yok.**
- Özel roller (KLN-20) ve personel departmanları var. Satın alma talebinin `departmanId` alanı var.

**Boşluklar:**
1. **Genel onay matrisi yok.** Belge türü × tutar aralığı × departman → sıralı onaylayanlar (rol ya da kişi) tanımlanamıyor. Çok kademeli onay (müdür + genel müdür) hiçbir modülde yok; satın almada eşik tek ve rol tabanlı.
2. **Tek onay kutusu yok.** Onay bekleyenler her modülün kendi ekranında; İş Kutusu bunları toplamıyor. Mobil uyumlu "Onayla / Gerekçeyle reddet" ekranı yok.
3. **Masraf onayında eşik ve görev ayrılığı yok.**
4. Onaylayana anlık bildirim modülden modüle değişiyor; ortak kural yok.
5. Vekâlet (izindeki onaylayanın yerine bakan) yok.

## Faz 5 — Veri aktarım sihirbazı · 🟡

**Var olan:**
- **Cari (CARI-31):** şablon indir → yükle → önizleme (yeni / güncellenecek / hatalı) → içe aktar.
- **Stok:** `POST /stok/excel-aktar` tek işlemde yazıyor; **önizleme yok.**
- Cari açılış ve düzeltme hareketi tek tek girilebiliyor. Pazaryeri sipariş ve kesinti aktarımı, banka ekstresi, muhasebe fiş okuyucu (dosya profili) var.

**Boşluklar:**
1. **Sütun eşleme yok.** Kullanıcı bizim şablonumuza uymak zorunda. Kendi dosyasının sütunlarını alanlarla eşleyemiyor; sezgisel ya da AI eşleme de yok.
2. **Toplu açılış aktarımı yok:** cari açılış bakiyeleri (döviz ve vade dahil), stok açılış miktarı ve maliyeti (depo, lot), kasa/banka açılışları.
3. **Rakip ERP profilleri yok.** Logo, Mikro, Zirve ve Paraşüt dışa aktarım biçimleri için hazır eşleme yok.
4. **Stok aktarımında önizleme ve hatalı satır raporu yok.** Cari ile aynı akışa getirilmeli.
5. Önizlemede hücreyi düzeltme yok (isteğe bağlı; "düzelt ve yeniden yükle" de yeterli olabilir).
6. Büyük dosya (5.000+ satır) için akışla okuma ve arka plan işi yok. API bellek çöküşü dersini burada da uygulamak gerekir.
7. Personel, demirbaş ve fiyat listesi aktarımı yok (öncelik düşük).

## Faz 6 — Barkodlu sayım · 🟡

**Var olan** (STK-07/29…31, `/panel/stok/sayim`):
- Depo bazında sayım, sayım tarihindeki sistem miktarı, varyant ve lot/seri satırları, yeni lot.
- Onayda fark, sayım tarihli düzeltme hareketi olarak işleniyor; sonraki hareketler korunuyor.
- `StokBarkod` (firma içinde tekil) ve `GET /stok/barkod/:barkod` araması (STK-15). Fatura ürün seçiminde ve gelen irsaliyede barkod kullanılıyor.

**Boşluklar:**
1. **Sayım ekranında okutma modu yok.** Satırlar elle dolduruluyor. Tabanca (keyboard wedge) için sürekli odakta kalan girdi, okutunca +1, miktar çarpanı yok.
2. Kamera ile okuma yok (BarcodeDetector ya da kitaplık).
3. Sesli ve titreşimli geri bildirim, tanımsız barkod uyarısı ve "karta barkod ekle" kısayolu yok.
4. **Kör sayım yok.** Sayan kişi sistem miktarını görüyor.
5. Aynı sayıma birden çok kişinin aynı anda okutması (bölge/raf) yok.
6. Sayımın kısmi kaydedilip sonra sürdürülmesi ayrıca doğrulanmalı.

---

## Önerilen ister maddeleri (onay bekliyor)

Kodlar öneridir; mevcut numaralandırmanın devamı alınmıştır.

### P1 — gerçek eksik, değeri yüksek
- **FTR-43** Tekrarlayan fatura zamanlayıcısı: worker'da günlük çalışır, kiracı bazında `vadesiGelenleriUret`; hata ve üretim sonucu Bildirim Merkezi'ne düşer.
- **FTR-44** Dönem değişkenleri: `{{AY}}`, `{{AY_ADI}}`, `{{YIL}}`, `{{DONEM_BAS}}`, `{{DONEM_BIT}}` (açıklama, not, satır açıklaması).
- **FTR-45** Plan seçeneği "fiyatı yeniden hesapla": kur günün kuruyla, fiyat fiyat listesinden; varsayılanı şablon fiyatı.
- **EBLG-151** Toplu kesinleştir ve gönder: seçilen taslak satış faturaları kuyrukla kesinleştirilir ve entegratöre gönderilir. Tek seferde sınır, hız sınırı ve satır bazında sonuç raporu.
- **ONY-01…05** Genel onay matrisi: belge türü (satın alma, masraf, ödeme talimatı, alış faturası) × tutar aralığı × departman → sıralı adımlar (rol ya da kişi). Görev ayrılığı ortak kural olur. Mevcut SAT eşiği matrisin ilk kuralına taşınır.
- **ONY-06** Tek onay kutusu: `/panel/onaylar`, mobil uyumlu, gerekçeli ret, bildirim.
- **STK-41** Sayım okutma modu: tabanca odak girdisi, +1 / çarpan, ses ve titreşim, tanımsız barkod uyarısı.

### P2
- **AKT-01…04** Aktarım sihirbazı: sütun eşleme (sezgisel + isteğe bağlı AI önerisi), kaydedilen eşleme profilleri, stok aktarımında önizleme, arka plan işi.
- **AKT-05** Toplu açılış aktarımı: cari, stok ve kasa/banka açılışları.
- **STK-42** Kör sayım ve çok kişili sayım.
- **STK-43** Kamera ile barkod okuma (mobil).
- **KSB-44** Fatura ve cari detayında "Ödeme bağlantısı gönder" kısayolu, bağlantı kopyalama, WhatsApp paylaşımı.
- **ONY-07** Masraf onayına eşik ve görev ayrılığı (ONY-01 gelmezse tek başına).

### P3 / karar gerekir
- **AKT-06** Logo, Mikro, Zirve ve Paraşüt profilleri. Gerçek örnek dışa aktarım dosyası olmadan yazılmamalı.
- **KSB-45** Cari açık bakiyesine ödeme bağlantısı.
- **KSB-46** Kesin önerileri kendiliğinden işleme (firma ayarı, varsayılan kapalı). AI yetki kararıyla birlikte değerlendirilmeli.
- **FTR-46** Tekrarlayan planda "kesinleştir ve gönder" seçeneği. Yanlış faturanın GİB'e gitmesi riski nedeniyle ayrı karar gerekir.

## Plandan çıkarılması önerilenler
- `TahsilatLinki` ve `BankaEslestirmeKurali` tabloları (karşılıkları var).
- Kendi ödeme sayfası ve 3D Secure akışı (sağlayıcının barındırdığı sayfa kullanılmaya devam etmeli).
- `kartIlkAlti` alanı.
- ≥90 puanda otomatik kapama.
- 40 günlük efor tablosu. Kalan iş paketleri için ister onayından sonra yeniden tahmin yapılmalı.
- "Tersine mühendislik" ifadesi ve rakibin iç rota adları. Karşılaştırma kamuya açık bilgiyle yapılmalı.
