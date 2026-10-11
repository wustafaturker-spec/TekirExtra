# Raporlar Modülü İnceleme Raporu

**Tarih:** 11 Ekim 2026
**İnceleme türü:** Kod okuma + yerel API'de canlı deneme + başsız tarayıcıda ekran gezintisi. Demo kiracıda
(TEKİR EKTRA ÖN MUHASEBE) yalnız okuma yapıldı; yetki denemesi demo'daki `depo@tekirextra.local`
(rol `depo`) kullanıcısıyla, yalnız okuma uçlarıyla yapıldı. Kod değişikliği yapılmadı.
**Kapsam:** Ortak rapor araç seti (`core/raporlar`: kayıt, servis, controller, Excel, PDF), 33 katalog
raporu (fatura 6, cari 6, stok 10, ürün hareket 3, kasa-banka 5, vergi 2, genel 1), `rapor` servisi
(panel özeti, günlük özet, vadesi geçenler, SMM, Gelir-Gider), ekranlar (`/panel/raporlar` ve alt
sayfaları, modül rapor sekmeleri, `/panel/stok/smm`, `/panel/fatura/pivot`, panel özeti), yetkiler.
**Dosyalar:** `apps/api/src/core/raporlar/*`, `apps/api/src/{fatura,cari,stok,kasa-banka}/*.raporlar.ts`,
`apps/api/src/fatura/vergi.raporlar.ts`, `apps/api/src/rapor/*`, `apps/api/src/stok/satis-ozeti.ts`,
`apps/web/src/components/rapor-paneli.tsx`, `apps/web/src/app/panel/{raporlar,fatura/pivot,stok/smm}/*`.

## 1. Özet

Altyapı sağlam: 33 rapor tek bir bildirimsel kayıt defterinden geliyor; filtre doğrulaması, sıralama,
Excel, PDF ve kayıtlı görünümler ortak. Bugün yenilenen ekran (RPR-10) katalog, dönem, toplam satırı
ve paylaşılabilir bağlantıyla kullanım tarafını büyük ölçüde toparladı. Bütün raporlar demo verisinde
hatasız çalıştı (en yavaşı 0,13 sn).

Asıl sorunlar **yetki** ve **rakamların doğruluğu/tutarlılığı**:

1. **Rapor uçlarında rol denetimi yok.** Menüde Raporlar'ı göremeyen `depo` rolündeki kullanıcı,
   API'den cari bakiyelerini, kâr marjını, kasa bakiyelerini ve şirketin net varlık özetini alabiliyor
   (dört uçta da 200/201).
2. **Kâr/Zarar Özeti alışı iki kez düşüyor.** Formül "satış − alış − bütün tediyeler"; tediyelerin
   içinde tedarikçi fatura ödemeleri de var. 1–11 Ekim'de **−795.214 TL** zarar gösteriyor; aynı
   dönemde Gelir-Gider **+417.736 TL**, SMM brüt kârı **+18.043 TL** diyor. Farkın 841.049 TL'si
   carilere yapılan 21 ödeme.
3. **Aynı soruya farklı cevaplar.** Üç ayrı "kâr" tanımı (alış bazlı Gelir-Gider, hatalı Kâr/Zarar
   Özeti, SMM bazlı brüt kâr), iki ayrı KDV hesabı (KDV Dökümü ile KDV ön analizi tevkifatlı alışta
   farklı) ve satış ile alışı tek sütunda toplayan Dönemsel Özet, kullanıcının rakamlara güvenini
   sarsıyor.

## 2. Durum

| Öncelik | Madde | Durum |
|---|---|---|
| P0-1 | Rapor ve panel özeti uçlarında rol denetimi | ✅ RPR-11 (2026-10-11) |
| P0-2 | Kâr/Zarar Özeti çift sayım | ✅ RPR-12 (2026-10-11) |
| P1-1 | Kâr tanımlarının birleştirilmesi (Gelir-Gider / Kâr-Zarar / SMM) | ✅ RPR-12 (2026-10-11) |
| P1-2 | Dönemsel Satış/Alış Özeti satış ve alışı karıştırıyor | ✅ RPR-13 (2026-10-11) |
| P1-3 | KDV Dökümü ile KDV ön analizinin tutarsızlığı | ✅ RPR-13 (2026-10-11) |
| P1-4 | Pivot: iptal/taslak, döviz ve yeniden hesap | ✅ RPR-14 (2026-10-11): `/rapor/fatura-pivot` SQL'de kayıtlı TL tutarlardan, varsayılan kesin, iptal hiç, iade eksi, dönem zorunlu, 5.000 hücre / 500 kalem sınırı; sayfa tasarım sisteminde |
| P1-5 | Panel özeti: bütün cari hareketlerini belleğe alıyor, eksi stok | ✅ RPR-15 (2026-10-11): `rapor/varlik-ozeti.ts` — cari bakiyesi veritabanında gruplanır, pasifler dahil, dövizli bakiye cari kartı gibi güncel kurla; eksi stok değerlenmez, sayısı uyarı olarak döner (panel + Gelir-Gider). Demo: stok −51,86 M → 126.245 TL, net varlık −35,1 M → +17,0 M |
| P1-6 | Maliyeti bilinmeyen satış %100 kâr görünüyor; Kâr Marjı eski yöntem | ✅ RPR-13 (2026-10-11); Ürün Satışları ve Alıcı Bazlı Satışlar da eski yöntemdeydi, taşındı |
| P2-1 … P2-8 | Dışa aktarım, sınırlar, devir hızı, kaynak sütunu, SMM ekranı, ayrı ekranlar, envanter, testler | Açık |
| P3 | Ek geliştirmeler (zamanlanmış rapor, karşılaştırma, grafik, drill-down…) | Öneri |

## 3. Bulgular

### P0-1 — Rapor uçlarında rol denetimi yok

`RaporlarController` (`/raporlar/*`) ve `RaporController` (`/rapor/*`: panel özeti, günlük özet,
vadesi geçenler, SMM, Gelir-Gider) `@Roller` taşımıyor. `RollerGuard` kuralı gereği `@Roller`'sız uç
"çalışan" dışındaki **bütün rollere** açık: satış, depo, üretim, kalite, salt okunur ve
(muhtemelen) B2B bayi. Web menüsü bu rollere Raporlar'ı göstermiyor, ama API'yi doğrudan çağırmak yeterli.

**Kanıt (demo, `depo@tekirextra.local`, rol `depo`):**

| Uç | Yanıt |
|---|---|
| `POST /raporlar/cari.en-yuksek-bakiyeliler/calistir` | 201, 15 cari ve bakiyeleri |
| `POST /raporlar/fatura.kar-marji/calistir` | 201, 15 ürünün ciro/maliyet/kârı |
| `POST /raporlar/kasa_banka.bakiyeler/calistir` | 201, kasa ve banka bakiyeleri |
| `GET /rapor/ozet` | 200, nakit, alacak, borç, net varlık |

RPR-09'da eklenen `RaporTanimi.roller` alanı bu rapor dışında kullanılmıyor.

**Öneri:** Modül → rol haritası (fatura/kâr/kasa/cari/vergi: yönetici, muhasebe, mali müşavir; stok:
+ depo, maliyet muhasebesi; ürün hareket: + depo, satış), rapor tanımında belirtilmeyen raporlara
modülünden varsayılan rol; `/rapor/*` uçlarına `@Roller`. Panel özetinde finansal kartlar yalnız bu
rollere dönsün. B2B bayi rolünün bu uçlara erişimi ayrıca denenmeli (deneme yapılmadı).

### P0-2 — Kâr/Zarar Özeti (RPR-05) alışı iki kez düşüyor

`genel.kar-zarar-ozeti` = satış matrahı − alış matrahı − **bütün `tediye` hareketleri**. Tediye; tedarikçi
fatura ödemesi, masraf ödemesi, maaş, banka masrafı, pazaryeri kesintisi, POS hareketi gibi her nakit
çıkışıdır. Alış faturası hem faturayken hem ödenirken düşülüyor. Buna karşılık masraflar ve bordro
tahakkuk olarak hiç girmiyor, yalnız ödendikleri gün nakit olarak düşüyor (nakit ve tahakkuk karışık).

**Kanıt (1–11 Ekim, gruplama "Genel Toplam"):** satış 494.618,49 − alış 59.850,00 − tediye 1.229.982,09 =
**−795.213,60**. Tediyelerin 841.049,17 TL'si (21 kayıt) cari bağlı ödeme. Aynı dönem Gelir-Gider
(+417.735,80) ve SMM brüt kârı (+18.043,24) çok farklı.

**Öneri:** Raporu kaldırmak ya da Gelir-Gider'in tahakkuk kaynağına (`tahakkuk.ts`) bağlamak; nakit
çıkışlarını kâr hesabına hiç katmamak.

### P1-1 — Üç farklı "kâr"

| Ekran | Yöntem | 1–11 Ekim |
|---|---|---|
| Gelir-Gider ("Dönem Net Kâr/Zarar") | Tahakkuk; **mal alışı gider** (SMM değil), masraf, bordro | +417.735,80 |
| Kâr/Zarar Özeti | Satış − alış − tediyeler (P0-2) | −795.213,60 |
| SMM ve kârlılık ("Brüt kâr") | Satış − satılan malın maliyeti (hareketlerden) | +18.043,24 |

Gelir-Gider, alışı dönem gideri saydığı için stok alan bir ayda zarar, stoktan satan bir ayda kâr gösterir;
kartın adı "Net Kâr" olduğu için kâr sanılır.

**Öneri:** Tek bir kâr tanımı: **Net satış − SMM − giderler (masraf, bordro, finansman)**; Gelir-Gider'e
"maliyet yöntemi: alış / SMM" seçimi ya da kart adının "Gelir − gider farkı (alış bazlı)" olması.
Kâr/Zarar Özeti bu tanıma bağlanmalı ya da kaldırılmalı.

### P1-2 — Dönemsel Satış/Alış Özeti satış ve alışı aynı satırda topluyor

Belge tipi filtresi boşken (varsayılan) satış, alış, satış iadesi ve alış iadesi aynı kırılım satırında
**toplanıyor**; iadeler eksi sayılmıyor. Eylül satırındaki "Matrah 16.194.647,02" satış ile alışın
toplamı; bu sayının bir anlamı yok. Yeni toplam satırı bu karışık sütunu da topluyor.

**Öneri:** Sütunları yöne göre ayırmak (satış, satış iadesi, alış, alış iadesi, net satış) ya da filtre
boşken kırılıma "yön" eklemek.

### P1-3 — KDV Dökümü ile KDV ön analizi tutarsız

KDV Dökümü (`fatura.kdv-dokumu`) her iki yönde satırın **net** KDV'sini (tevkifat düşülmüş) alıyor.
Bugün düzeltilen KDV ön analizi ise beyannamedeki gibi tevkifatlı alışın KDV'sinin **tamamını** indirilecek
sayıyor; kestiğimiz tevkifatı KDV-2 olarak ayrı gösteriyor. Tevkifatlı alışı olan bir dönemde iki ekran
farklı indirilecek KDV verir. İhraç kayıtlı satışın tecil edilen KDV'si de dökümde görünmüyor.

**Öneri:** Tek hesap fonksiyonu (`kdvOzetRaporu` mantığı) ve dökümün oran kırılımı + "tevkifat",
"ihraç kayıtlı" satırlarıyla bu fonksiyondan üretilmesi.

### P1-4 — Pivot tablo yanlış toplam veriyor

`/panel/fatura/pivot`:
- Varsayılan durum filtresi "tümü": demo'daki **35 iptal ve 5 taslak** fatura toplamlara giriyor.
- Tutarlar tarayıcıda satırdan yeniden hesaplanıyor (miktar × fiyat − satır iskontosu + KDV); genel
  iskonto, tevkifat, KDV dışı vergiler ve özel matrah yok sayılıyor.
- **Kur uygulanmıyor:** 9 USD ve 2 EUR faturanın döviz tutarı TL tutarlarla toplanıyor.
- `/fatura?adet=300` ile en çok 300 fatura çekiliyor; fazlası sessizce dışarıda kalıyor.
- Görünüm tasarım sisteminin dışında (mor tema), sütun başlığında ham değer (`alis_iade`).

**Öneri:** Sunucuda, kayıtlı TL tutarlardan çalışan bir pivot ucu (ya da kataloğa "Fatura satır analizi"
raporu + panelde pivot görünümü); varsayılan durum "kesin".

### P1-5 — Panel özeti: bellek ve eksi stok

`finansalOzet` aktif carileri **bütün hareketleriyle** belleğe alıp bakiyeyi JavaScript'te topluyor
(2026-09-29'daki "API bellek çöküşü" kalıbı); büyüyen kiracıda yavaşlama ve bellek riski. Pasif carilerin
açık bakiyeleri alacak/borca girmiyor. Envanter değeri eksi stokları da çarpıyor: demo'da stok değeri
**−51.876.492 TL**, net varlık **−35.110.425 TL** görünüyor (Gelir-Gider'deki "Aktif stok değeri" de aynı).

**Öneri:** Bakiye SQL'de gruplanarak (cari kartındaki kaynakla aynı fonksiyon); eksi stok değerlemeden
çıkarılıp "eksi stoklu N ürün" uyarısı.

### P1-6 — Maliyeti bilinmeyen satış %100 kâr görünüyor

Maliyeti olmayan ürün (demo `SF0101`: 62.256 adet, 1.640.582,61 TL ciro, maliyet 0) Kâr Marjı, Ürün Kârlılık,
Ürün Satışları ve SMM ekranlarında **%100 marjla** görünüyor; kâr şişiyor, uyarı yok. Ayrıca
`fatura.kar-marji` hâlâ eski yöntemi kullanıyor (kartın **bugünkü** ortalama maliyeti × satır miktarı;
ek birim çevrilmiyor, iade düşülmüyor). Diğer üç rapor STK-32 ile `satis-ozeti.ts`'e geçmişti.

**Öneri:** Kâr Marjı'nı `satis-ozeti.ts`'e bağlamak; maliyeti sıfır satırları "maliyet bilinmiyor"
olarak işaretleyip kârdan ayrı göstermek.

### P2-1 — Dışa aktarım RPR-08'i karşılamıyor

- Excel ve PDF'te **dönem ve filtreler yazmıyor**; yalnız "Rapor tarihi" var.
- Toplam satırı ekranda var, dışa aktarımda yok.
- Dövizli para sütunlarında (`dovizAlani`) para birimi basılmıyor; EUR ile TL aynı sütunda birimsiz.
- Excel başlığı firma adı yerine sabit "TEKİREXTRA — …"; renkler sabit mor (uygulama ve belge teması
  turuncu); tarih `yyyy-mm-dd`.
- 26'dan fazla sütunda başlık birleştirme harfi bozulur (bugün en geniş rapor 11 sütun).

### P2-2 — Sunucuda satır sınırı yok

Hareketler, Tahsilat Performansı (bütün cari hareketleri), tarihli envanter (bütün stok hareketleri)
ve SMM/FIFO (ürün başına ayrı sorgu) bütün veriyi yükleyip döndürüyor. Ekran 500 satır gösteriyor ama
API tamamını gönderiyor. **Vadesi geçenler** ilk 200 faturayı alıp sonra ödenmişleri eliyor: 200'den fazla
vadesi geçmiş fatura olduğunda toplam eksik kalır; bildirimler de bu kaynağı kullanıyor (demo'da 85).

### P2-3 — Stok devir hızı formülü

Devir hızı = dönem satış miktarı ÷ **bugünkü** stok. Olması gereken dönem SMM ÷ ortalama stok (dönem
başı + sonu / 2). Yalnız satılan ürünler listeleniyor; asıl bakılması gereken hiç dönmeyen ürünler
listede yok.

### P2-4 — Ürün hareket raporunda kaynak ham kimlik

"Kaynak" sütunu `fatura · 0d9b07a4-…` gibi ham UUID gösteriyor; belge numarası ve belgeye bağlantı
yok (`baglantiAlani` altyapısı hazır). Bazı çıkışlarda birim maliyet 0,0000.

### P2-5 — SMM ekranı

Kesin ama e-Belge'ye gönderilmemiş (numarasız) faturalar "Taslak" yazıyor; tarihler ISO (`2026-10-01`).

### P2-6 — Ayrı ekranlar ortak panelin dışında

Gelir-Gider, SMM ve Pivot ayrı sayfalar; kayıtlı görünüm, adreste durum, ortak Excel/PDF biçimi yok.
Gelir-Gider'in kendi Excel/yazdır düğmeleri var; SMM'de dışa aktarım yok. "Ürün Hareket Raporu" menü
öğesi katalogdaki aynı raporlara ikinci bir yoldan gidiyor.

### P2-7 — Envanter

Varyant kırılımı yok (varyantlı ürün tek satır); eksi stok değerlemeye eksi giriyor (P1-5 ile aynı kök).

### P2-8 — Test kapsamı

33 raporun yalnız vergi (6 test) ve stok (2 test) tanımları birim testli; fatura, cari, kasa-banka,
ürün hareket ve genel raporların hesap testi yok. P0-2 ve P1-2 gibi hatalar test olsaydı yakalanırdı.

## 4. Ek geliştirme önerileri (P3)

| Öneri | Not |
|---|---|
| Zamanlanmış rapor e-postası | Kayıtlı görünüm + haftalık/aylık gönderim (mevcut SMTP ve bildirim zamanlayıcısı) |
| Karşılaştırmalı dönem | Önceki dönem / geçen yıl aynı dönem sütunları, % değişim |
| Grafik | Dönemsel özet, kâr trendi, yaşlandırma için tablo üstünde grafik |
| Satırdan kayda gitme | Cari, fatura, ürün sütunlarına bağlantı (`baglantiAlani` hazır) |
| Favori ve son kullanılan raporlar | Katalogda üstte |
| Satış kırılımları (RPR-03) | Satış temsilcisi, ürün kategorisi, il/bölge |
| Bütçe-gerçekleşen ve nakit akışı | Kataloğa "ayrı ekran" bağlantısı olarak |
| Metabase (RPR-07) | `docker-compose.yml`'de `metabase:latest` etiketiyle, entegrasyonsuz duruyor; sürüm sabitlenip entegre edilmeli ya da kaldırılmalı |
| Sonuç önbelleği | Ağır raporlar (FIFO, tarihli envanter) için kısa süreli önbellek |

## 5. Önerilen sıra

1. **P0-1** rol haritası + `/rapor/*` rolleri (küçük, güvenlik).
2. **P0-2 + P1-1** tek kâr tanımı; Kâr/Zarar Özeti'nin düzeltilmesi ya da kaldırılması (karar gerekiyor).
3. **P1-2, P1-3, P1-6** rapor hesaplarının düzeltilmesi + bu raporlara birim testi (P2-8).
4. **P1-4** pivotun sunucuya taşınması; **P1-5** panel özetinin SQL'e taşınması.
5. **P2** dışa aktarım başlığı/filtreleri/toplamı, satır sınırları, devir hızı, kaynak sütunu, SMM ekranı.
6. **P3** kullanıcının seçtiği ek geliştirmeler.

## 6. Deneme ortamı notları

- Demo verisinde ciddi eksi stoklar var (`0473` −1.552 adet, `SF0101` −58.154) ve bazı ürünlerin ortalama
  maliyeti gerçekçi değil (`0474` için 3.001 adet satışın maliyeti 10,6 M TL); kârlılık raporlarındaki uç
  değerler bu veriden. Raporlar arasında maliyet yöntemi tutarlı (Ürün Kârlılık, Ürün Satışları ve SMM aynı
  rakamı veriyor).
- Bazı cari kodları UUID biçiminde (içe aktarılmış cariler); raporlarda kod sütununda UUID görünmesi veri
  kaynaklı.
- Bu incelemede veri değiştirilmedi.
