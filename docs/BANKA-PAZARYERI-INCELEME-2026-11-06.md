# Banka ve Pazaryeri Entegrasyonu — İnceleme

Tarih: 6 Kasım 2026
Kapsam: altyapı (API, worker, adaptörler, şema) ve arayüz (`/panel/kasa-banka/ekstre`,
`/panel/ayarlar/banka-baglantilari`, `/panel/pazaryeri`, `/panel/pazaryeri/kesintiler`,
`/panel/ayarlar/pazaryerleri`).
Durum: **Bulgular ve ister önerisi.** Onaylanmadan kodlanmaz (S-01).

Öncelik: **P0** yanlış kayıt ya da veri riski · **P1** işletimi aksatan eksik · **P2** ölçek, bakım ve UX · **P3** genişleme

---

## Genel tablo

| | Banka | Pazaryeri |
|---|---|---|
| Olgunluk | Yüksek (KSB-06…43): eşleştirme motoru güçlü, sağlayıcı arayüzü var | **Düşük** (878 satır): MVP düzeyinde, otomasyonu yok |
| Otomatik çekim | Var (5 dk, worker) | **Yok**; yalnız düğmeyle |
| Sağlayıcı soyutlaması | `BankaSaglayicisi` + kayıt; yalnız Vomsis kayıtlı | **Yok**; `if/else` zincirleri |
| HTTP dayanıklılığı | Zaman aşımı + yeniden deneme + Retry-After | Trendyol ve N11 çıplak `fetch`; **zaman aşımı, deneme ve SSRF koruması yok** |
| Bağlantı testi | Yalnız alan biçimi | Yalnız alan biçimi |
| Arayüz | İşlevsel; ayar sayfası Vomsis'e gömülü | Tek satıra sıkıştırılmış kod, tüm cari ve stok tarayıcıya yükleniyor |

---

## A. Pazaryeri

### P0 — yanlış kayıt riski

**PZR-P0-1. KDV dahil fiyat, KDV hariç birim fiyat olarak faturaya yazılıyor (yüksek olasılık).**
- Adaptörler pazaryerinin satış fiyatını doğrudan alıyor: Trendyol `lineUnitPrice`, Hepsiburada `unitPrice`, N11 `sellerInvoiceAmount / miktar`. Bu alanlar müşterinin ödediği **KDV dahil** fiyattır.
- `faturalastir()` bu değeri `birimFiyat` olarak `FaturaService.olustur`'a veriyor. Faturada `birimFiyat` nettir; KDV üstüne eklenir (`fatura.semalar.ts:209`, `shared/para.ts`).
- Sonuç: %20 KDV'li 240 TL'lik sipariş 288 TL'lik fatura olur. Birim testi (`pazaryeri.test.ts`: 2 × 120, toplam 240) de bu varsayımla yazılmış.
- Faturalar taslak olarak üretildiği için hata kesinleştirmede fark edilebilir. Yine de pilotta kesilmiş pazaryeri faturası varsa **taranmalı**.
- **Teyit:** her pazaryerinden birer gerçek ya da sandbox sipariş yanıtıyla doğrulanmalı.

**PZR-P0-2. Satır indirimleri yok sayılıyor.** Trendyol `discount` / `tyDiscount` ve Hepsiburada kampanya alanları alınmıyor. İndirimli siparişte fatura tutarı müşterinin ödediğinden farklı çıkar.

**PZR-P0-3. KDV oranı yoksa %20 varsayılıyor** (`vatRate ?? 20`). %1 ve %10 oranlı ürünlerde sessizce yanlış KDV oluşur. Oran gelmezse stok kartındaki oran kullanılmalı, o da yoksa satır eşleme bekleyene düşmeli.

**PZR-P0-4. Komisyon giderinin iki kez yazılma riski.**
- `kesintileriGiderlestir` her kesinti için doğrudan tediye hareketi açıyor; masraf kategorisi ve KDV yok.
- Pazaryerleri komisyonu ayrıca **e-Fatura** olarak kesiyor. O fatura gelen kutusundan alış olarak işlenirse aynı gider iki kez yazılır.
- Kesinti, gelen komisyon faturasıyla eşleşmeli ya da yalnız mutabakat kaydı olmalı. Bu bir karar konusu.

### P1 — işletim eksikleri

1. **Otomatik çekim yok.** Sipariş, kesinti ve stok/fiyat yalnız düğmeyle çalışıyor; worker zamanlayıcısı yok. Bankadaki `BankaSenkronZamanlayiciService` deseni uygulanmalı.
2. **SKU eşlemesi hatırlanmıyor.** `satirEsle` yalnız o satırı güncelliyor; aynı SKU'lu sonraki sipariş yine "eşleme bekliyor"a düşüyor. Kalıcı bir `pazaryeri_urun_eslemeleri` tablosu gerekir (bağlantı × SKU/barkod → stok/varyant).
3. **Her siparişte cari elle seçiliyor.** Bireysel alıcı için e-Arşiv akışı yok. Seçenekler: TCKN/VKN ile cari bulma ya da açma, ya da "pazaryeri nihai tüketici" carisi. e-Arşiv internet satışı alanları (EBLG-105: gönderim şekli, internet satışı bilgisi) siparişten otomatik dolmalı.
4. **Sipariş yaşam döngüsü eksik.**
   - N11 yalnız `status=Created` paketleri çekiyor. Sonraki durum değişikliği ve iptal hiç gelmiyor.
   - Faturalanmış siparişin iptali ve iadesi (`claims`) işlenmiyor; iade faturası ya da e-Arşiv iptali önerisi yok.
   - Hepsiburada ve N11 imleci sona ulaşınca sıfırlanıyor; her çekimde baştan taranıyor.
5. **Faturanın pazaryerine geri bildirilmesi yok.** Trendyol fatura bağlantısı ve dosyası, Hepsiburada fatura yükleme yok. Satıcının yasal yükümlülüğü elle kalıyor.
6. **Stok/fiyat gönderimi kaba.**
   - Bütün aktif ürünler her seferinde gönderiliyor. Yalnız pazaryerinde listelenenler ya da değişenler gönderilmeli.
   - Tek fiyat (`satisFiyati`) kullanılıyor; pazaryeri başına fiyat listesi, kâr payı ve yuvarlama kuralı yok.
   - Bütün depoların toplamı gönderiliyor; depo seçimi ve güvenlik stoğu yok.
   - Toplu işlem kimlikleri (`batchRequestId`) saklanmıyor ve sonucu sorgulanmıyor. Reddedilen kalem görünmüyor.
   - Tanımsız sağlayıcı `AmazonAdapter`'a düşüyor (`pazaryeri.service.ts:159`).
7. **Hakediş ve banka mutabakatı yok.** Pazaryerinin yaptığı toplu ödeme banka ekstresinde tek satır olarak görünüyor. Bunu siparişler eksi kesintilerle eşleyen bir hakediş kaydı yok. Kesinti çekimi yalnız Amazon'da var; Trendyol ve Hepsiburada cari ve finans servisleri yok.
8. **Bağlantı testi gerçek değil.** "Kimlik biçimi doğrulandı; canlı test ilk işlem sırasında" mesajı dönüyor (`baglantilar.service.ts:385`). Yanlış anahtar ancak ilk senkronda ortaya çıkıyor.

### P2 — altyapı ve bakım

- Ortak `PazaryeriSaglayicisi` arayüzü ve kayıt yapısı (banka KSB-30 deseni). Bugün 3 ayrı `if/else` zinciri var.
- Bütün çağrılar `disFetch` üzerinden gitmeli, zaman aşımı, yeniden deneme ve Retry-After uygulanmalı. Sağlayıcı başına hız sınırı olmalı (Trendyol sıkı sınır uyguluyor).
- Para tutarları `number` olarak taşınıyor. Adaptör çıktısı metin ya da Decimal olmalı.
- Ayrıştırılamayan sipariş sessizce atlanıyor (Hepsiburada ve N11'de SKU'su boş satır varsa bütün sipariş düşüyor). Atlananlar sayılıp raporlanmalı.
- `faturalastir` tek tek ve senkron çalışıyor. Bir sipariş durumu `yeni`ye çekilip fatura oluşturulamazsa sipariş `hata`ya düşüyor; fatura oluşturulup sipariş güncellenemezse sahipsiz fatura kalıyor. İşlem bütünlüğü ya da kuyruk gerekir.
- `GET /pazaryeri/siparisler` sayfalama olmadan bütün siparişleri satırlarıyla döndürüyor (API bellek çöküşü dersi). `hamVeri` de saklanıyor.
- **KVKK:** `hamVeri` alıcının adını, adresini, telefonunu ve TCKN'sini süresiz saklıyor. Saklama süresi ve maskeleme gerekir.
- Senkron geçmişi yok; yalnız son hata saklanıyor. Bildirim Merkezi bağlantısı yok.
- `iceAktar` uç noktası (yönetici, elle JSON) kullanıcıya açık. Test aracı olarak kalacaksa platform ya da geliştirici yetkisine çekilmeli.

### Arayüz

- `pazaryeri/page.tsx` (34 satır) ve `kesintiler/page.tsx` (28 satır): bütün bileşen birkaç sıkıştırılmış satırda. Okunamıyor, gözden geçirilemiyor, test edilemiyor. Bileşenlere bölünmeli.
- Açılışta `tumSayfalariAl("/cari")` ve `tumSayfalariAl("/stok")` ile **bütün cari ve stok tarayıcıya iniyor**; ürün eşlemede ilk 100 seçenekli bir `<select>` var. Mevcut `urun-secim-modali` ve sunucu taraflı arama kullanılmalı.
- `confirm()` yerel pencereleri kullanılıyor. Tasarım sistemindeki onay penceresi kullanılmalı.
- Tek liste ekranı var. Önerilen yapı:
  - **Pazaryeri özeti:** kanal başına bugünkü sipariş ve ciro, eşleme bekleyen, hata, son senkron
  - **Siparişler:** sayfalı tablo, sekmeler (eşleme bekleyen / faturaya hazır / faturalandı / iptal-iade)
  - **Ürün eşlemeleri:** SKU ↔ stok tablosu, toplu eşleme, eşleşmeyenler
  - **Stok ve fiyat:** pazaryeri başına fiyat kuralı, son gönderim ve reddedilenler
  - **Hakediş ve kesintiler:** bütün kanallar
- Ayar sayfasında senkron aralığı, depo, fiyat listesi, varsayılan cari ve fatura serisi seçimi yok.
- Kesinti ekranı "Amazon" adını sabit yazıyor (`<small>Amazon</small>`, "Amazon kaynak özeti").

---

## B. Banka

### Güçlü yanlar (korunacak)
- `BankaSaglayicisi` arayüzü + kayıt, `bankaIstegi` (30 sn zaman aşımı, 3 deneme, Retry-After).
- İdempotent kayıt (sağlayıcı kimliği), hata sayacı, kimlik hatasında otomatik durdurma.
- Bakiye tutarlılık uyarısı (KSB-31), askıdaki firmada çekim yapılmaması (PLT-05).
- Webhook'ta sabit zamanlı anahtar karşılaştırması ve şema doğrulaması.

### P1
1. **Hesaplar arası hata yalıtımı yok.** `senkronize()` eşlemeleri sırayla çekiyor; bir hesap hata verirse kalan hesaplar çekilmiyor ve bütün bağlantı hatalı sayılıyor. Hata ve son çekim hesap bazında tutulmalı.
2. **Worker döngüsü tek sıra ve süreç içi kilitli.**
   - Bütün kiracılar `setInterval` içinde art arda dönüyor. Yavaş bir sağlayıcı (3 × 30 sn × hesap sayısı) herkesi bekletiyor.
   - `calisiyor` bayrağı yalnız aynı süreçte koruyor; iki worker çalışırsa aynı bağlantı iki kez çekiliyor. İdempotency kaydı korusa da sağlayıcı kotası harcanıyor.
   - Her turda yeni `PrismaClient` açılıyor.
   - Kiracı veya bağlantı başına BullMQ işi, ya da en azından `pg_try_advisory_lock`, gerekir.
3. **Webhook güvenliği temel düzeyde.** Yalnız sabit Bearer anahtarı var. HMAC imza, zaman damgası ve tekrar koruması, uç nokta başına hız sınırı ve anahtar yenileme yok. Webhook'tan gelen hareket bağlantının `sonSenkronTarihi` alanını güncellemiyor; "son veri ne zaman geldi" bilgisi yok.
4. **Geçmişe dönük çekim seçeneği yok.** İlk çekim sabit 7 gün geriye gidiyor. Hesap eşlendiğinde başlangıç tarihi seçilemiyor; Vomsis'in 7 gün sınırı pencerelere bölünerek aşılabilir (f07408a deseni).
5. **Eşleme silinemiyor ve değiştirilemiyor.** `banka-baglantilari/eslemeler` için silme uç noktası yok; yanlış eşlenen hesap düzeltilemiyor.
6. **Bağlantı testi gerçek değil** (pazaryeri ile aynı). Vomsis için `tokenAl` ile canlı deneme yapılabilir.

### P2
- Sağlayıcıya özel kod sızıntısı: `vomsisHesaplari()` uç noktası ve ekranın ham Vomsis alanlarına bağımlılığı. Ortak `saglayici-hesaplari` uç noktası zaten var; ekran ona taşınıp Vomsis'e özel uç nokta kaldırılmalı.
- `SaglayiciHareketi.tutar` ve `bakiye` `number`. Kuruş hassasiyeti için metin ya da Decimal olmalı.
- Senkron çalıştırma geçmişi yok (ne zaman, kaç satır, ne kadar sürdü, hata). Yalnız son durum tutuluyor. Sistem Sağlığı ve platform ekranında da görünmeli.
- Yeni sağlayıcı adayları:
  - Doğrudan banka API'leri
  - ÖHVPS (açık bankacılık) hesap bilgisi hizmeti
  - Diğer toplayıcılar
  
  Arayüz hazır, adaptör eksik. **Ticari karar gerekir.**
- Ödeme talimatı paketinin bankaya API ya da dosya (EFT toplu dosyası) ile iletilmesi. Bugünkü kapsam ayrıca doğrulanmalı.

### Arayüz
- `ayarlar/banka-baglantilari` "Vomsis" ve "Webhook" olarak iki sabit bloktan oluşuyor. Önerilen yapı: sağlayıcı kataloğundan bağlantı ekleme (kart listesi), bağlantı başına durum kartı (son çekim, sonraki çekim, ardışık hata, durdurma nedeni), hesap eşleme tablosu (ekle, kaldır, başlangıç tarihi), çalıştırma geçmişi.
- Webhook adresi ortam değişkeni yoksa `http://localhost:3001` gösteriyor. Üretimde yanlış adres kopyalanabilir.
- `kasa-banka/page.tsx` (989 satır) ve `ekstre-panel.tsx` (700 satır) büyük. İşlevsel ama bakım için bölünmeli; davranış değişikliği gerekmiyor.
- Ekstre ekranında hesap bazında "son veri geldiği an" ve "çekim hatası" rozeti yok. Kullanıcı verinin güncel olup olmadığını bilemiyor.

---

## C. Ortak altyapı (iki modül için)

**ENT-01 Entegrasyon çekirdeği:**
- Sağlayıcı kataloğu (aile, kod, ad, zorunlu alanlar, desteklenen yetenekler)
- Ortak HTTP istemcisi: `disFetch`, zaman aşımı, deneme, hız sınırı
- Canlı bağlantı testi arayüzü
- Senkron çalıştırma kaydı (`entegrasyon_calismalari`)
- Kuyruk tabanlı zamanlayıcı ve kilit

Banka, pazaryeri, POS ve SMS aynı çekirdeği kullanır.

**ENT-02 Entegrasyon Merkezi ekranı:** bütün bağlantılar tek sayfada. Durum, son çalıştırma, hata, yeniden dene, duraklat. Hatalar Bildirim Merkezi'ne düşer. Platform tarafında kiracılar arası sağlık görünümü (Sistem Sağlığı'na eklenir).

---

## Önerilen ister listesi (onay bekliyor)

Kodlar öneridir. Pazaryeri için yeni önek **PZR** önerilmiştir.

### P0
- **PZR-01** Fiyat dönüşümü: KDV dahil fiyattan iç yüzdeyle net fiyat (`icYuzdeMatrah` deseni), satır indirimleri, KDV oranı stok kartından (yoksa eşleme bekler). Gerçek yanıt örnekleriyle test edilir.
- **PZR-02** Pilotta kesilmiş pazaryeri faturalarının taranması (yalnız rapor; düzeltme ayrıca karara bağlanır).
  **2026-11-06 sayımı (pilot DB = dev DB):** pazaryeri bağlantısı, siparişi ve kesintisi **yok**. Etkilenen fatura ve çift gider kaydı yok; tarama gereksiz, düzeltme işi doğmadı.
- **PZR-03** Komisyon kesintisi ile gelen komisyon e-Faturasının çift sayım kuralı.
  **Karar (2026-11-06, kullanıcı): gider için gelen e-Fatura esas alınır.** Taslak isterler:
  1. Pazaryeri kesintisi gider ya da kasa/banka hareketi **üretmez**; mutabakat kaydı olarak kalır. "Giderleştir" işlemi kaldırılır. Durumlar `bekliyor` / `faturayla_eslesti` / `faturasiz` olur.
  2. Kesinti, aynı pazaryeri VKN'sinden gelen alış e-Faturasıyla dönem ve tutar üzerinden eşleşir (fatura satır toplamı ↔ dönem kesinti toplamı, kuruş toleransı). Eşleşmeyen fark raporda görünür: "kesildi ama faturası gelmedi" ya da "faturada var, kesintide yok".
  3. Faturası kesilmeyen kalemler ayrı türdür.
     - **Stopaj — karar (2026-11-06, kullanıcı): kasa/banka hareketi olarak kalır.** Bugünkü giderleştirme akışı stopaj türü için korunur. Hareketin türü gider değil "mahsup edilecek stopaj" (peşin ödenen vergi) olmalıdır; muhasebe aktarımında 193 hesabına gider. Bu nokta teyit bekliyor.
     - Cezalar ve diğer faturasız kalemler: açık.
  4. Daha önce giderleştirilmiş kesintiler taranır. Aynı dönemde gelen komisyon faturası da işlenmişse çift kayıt raporlanır. Düzeltme (hareketin geri alınması) **onayla** yapılır, otomatik yapılmaz.
  5. Pazaryeri hakedişi (PZR-13), banka ekstresindeki tahsilatla eşleşirken kesintiyi netleştirme için kullanır, gider olarak kullanmaz.

### P1 — pazaryeri
- **PZR-04** Sağlayıcı arayüzü + kayıt + ortak HTTP (disFetch, zaman aşımı, deneme, hız sınırı); para tutarları Decimal/metin.
- **PZR-05** Worker zamanlayıcısı: sipariş ve kesinti için bağlantı başına aralık, hata sayacı, kimlik hatasında durdurma, askıdaki firmada çalışmama.
- **PZR-06** Kalıcı ürün eşleme tablosu + eşleme ekranı + toplu eşleme.
- **PZR-07** Cari ve e-Arşiv akışı: TCKN/VKN ile cari bulma ya da açma, nihai tüketici carisi seçeneği, internet satışı alanlarının otomatik dolması, bağlantı başına fatura serisi.
- **PZR-08** Sipariş yaşam döngüsü: durum güncellemesi, iptal ve iade (faturalanmışsa iade faturası ya da iptal önerisi).
- **PZR-09** Stok/fiyat: yalnız listelenen ya da değişen ürünler, pazaryeri başına fiyat listesi ve kural, depo seçimi, güvenlik stoğu, toplu işlem sonucunun sorgulanması.
- **PZR-10** Canlı bağlantı testi.
- **PZR-11** Arayüzün yeniden yazımı: bileşenlere bölme, sunucu taraflı sayfalama ve arama, sekmeli yapı, tasarım sistemi onay penceresi.

### P1 — banka
- **KSB-47** Hesap bazında hata yalıtımı ve hesap bazında son çekim ve hata.
- **KSB-48** Kuyruk ya da advisory lock ile çekim; kiracılar arası paralellik sınırı; tek `PrismaClient`.
- **KSB-49** Eşleme kaldırma ve değiştirme; eşlemede başlangıç tarihi ile geçmişe dönük çekim (7 günlük pencerelerle).
- **KSB-50** Webhook: HMAC imza + zaman damgası (eski Bearer geçiş süresince kabul edilir), hız sınırı, anahtar yenileme, son veri zamanı.
- **KSB-51** Canlı bağlantı testi (Vomsis token).

### P2
- **ENT-01** Ortak entegrasyon çekirdeği ve çalıştırma kaydı.
- **ENT-02** Entegrasyon Merkezi ekranı + Bildirim Merkezi + Sistem Sağlığı.
- **KSB-52** Banka bağlantı ayarlarının sağlayıcı kataloğuna geçmesi; Vomsis'e özel uç noktanın kaldırılması; ekstre ekranında "veri güncel mi" rozeti.
- **PZR-12** Faturanın pazaryerine geri bildirilmesi (Trendyol ve Hepsiburada fatura bağlantısı/yükleme).
- **PZR-13** Hakediş kaydı ve banka ekstresiyle mutabakat; Trendyol ve Hepsiburada finans servisleri.
- **PZR-14** KVKK: `hamVeri` saklama süresi ve maskeleme.

### P3 / karar gerekir
- **KSB-53** Yeni banka sağlayıcıları (doğrudan banka API'si, ÖHVPS, başka toplayıcı).
- **KSB-54** Ödeme talimatı paketinin bankaya iletilmesi.
- **PZR-15** Yeni kanallar (Çiçeksepeti, Pazarama, kendi e-ticaret sitesi: WooCommerce, Shopify, ikas).

## Önerilen sıra
1. **PZR-01…03** (P0, küçük ve acil). Önce gerçek sipariş örneği gerekir.
2. **PZR-04 + KSB-47/48**: altyapı. ENT-01'in ilk dilimi olarak birlikte yapılır, iki modül aynı çekirdeğe oturur.
3. **PZR-05…08**: pazaryeri işletimi.
4. **PZR-11 + KSB-52 + ENT-02**: arayüz. Altyapı oturduktan sonra yapılır ki ekran iki kez yazılmasın.
5. **KSB-49…51, PZR-09/10/12…14.**
