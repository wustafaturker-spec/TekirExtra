# Stok Modülü İnceleme Raporu

**Tarih:** 8 Ekim 2026
**İnceleme türü:** Kod okuma + yerel API'de canlı deneme. Denemeler, demo kiracının fatura serilerine ve
e-Belge bağlantısına dokunmamak için yeni açılan **"Stok İnceleme Test A.Ş."** kiracısında yapıldı
(giriş `stok.inceleme@tekirextra.local` / `StokTest2026x`). Demo kiracıda yalnız salt okuma tutarlılık
sorgusu çalıştırıldı. Kod değişikliği yapılmadı.
**Kapsam:** Stok kartı, hareket çekirdeği (`hareketEkle`), ağırlıklı ortalama maliyet (AVCO), çoklu depo
ve varyant bakiyeleri, lot/seri, eksi stok politikası, fatura kesinleştirme/iptal/taslağa geri almanın
stok etkisi, sayım, transfer, birim çevrimi, stok raporları.
**Dosyalar:** `apps/api/src/stok/*`, `apps/api/src/fatura/fatura.service.ts` (kesinleştirme, iptal, taslağa
geri alma), `apps/api/src/uretim/uretim.service.ts` (hareket çağrıları), `apps/api/src/stok/stok.raporlar.ts`

## 1. Özet

Modülün kapsamı geniş: çoklu depo, varyant, lot/seri + FEFO, ek birimler, barkod, tedarikçi, fiyat
listeleri, eksi stok politikası, onaylı sayım, transfer fişi, iptal çifti gizleme ve on rapor. Bütün stok
hareketleri tek bir fonksiyondan (`StokService.hareketEkle`) geçiyor; bu iyi bir temel.

Ancak **stok değerini ve stok miktarını bozan** sorunlar var. Ağırlıklı ortalama maliyet envanter değeri,
kârlılık, üretim maliyeti ve muhasebe aktarımına girdiği için etkisi modül dışına taşıyor:

1. **Eşzamanlı hareketlerde kayıp güncelleme.** Stok kartındaki toplam miktar ve ortalama maliyet okunup
   mutlak değerle yazılıyor, satır kilitlenmiyor. 4 paralel istekle 21 giriş yapıldı: depo 21, kart **9**
   gösterdi. Demo kiracıda da iz var: `HM-001` kartı −12.974, depo ve hareket toplamı −12.874.
2. **Alış maliyetine iskonto ve kur uygulanmıyor.** Stoğa fatura satırının brüt birim fiyatı yazılıyor:
   %20 satır iskontosu ve genel iskonto maliyetten düşmüyor, **dövizli alışta döviz tutarı TL sayılıyor**
   (10 USD × kur 40 → maliyet 10 TL; beklenen ortalama 240, çıkan 55).
3. **Satış iadesi stoğa satış fiyatıyla giriyor.** 70 TL ortalamalı ürüne 1.000 TL'den 5 adet iade
   girince ortalama maliyet **225 TL**'ye fırladı.

Bunların yanında sayım onayı sayımdan sonraki hareketleri yok sayıyor (satılan mal stoğa geri dönüyor),
alış iptali ortalama maliyeti geri almıyor, varyantlı kartta sayım ve varyantsız hareket varyant
bakiyesini kart toplamından koparıyor (demo `SF0101`: kart −57.153, varyant toplamı −500), lotlu üründe
sayım fazlası onayı durduruyor, ürün kârlılık raporu birim çevirmeden ve bugünkü maliyetle hesaplıyor,
hizmet kartlarına stok hareketi yazılıyor.

## Durum

| Madde | Durum |
|---|---|
| P0-1 | ✅ 2026-10-08 — STK-24 (`hareketEkle` kart satırını `SELECT … FOR UPDATE` ile kilitler, depo/varyant bakiyesi ve eksi stok denetimi kilitten sonra; fatura kesinleştirme/iptal/taslağa geri alma, sayım onayı, transfer ve üretim bildirimi kartlarını döngüden önce id sırasıyla toplu kilitler (`kartlariKilitle`). Canlıda: 4 paralel 21 giriş → kart = depo = 21; "engelle" politikasında stok 10 iken 12 eşzamanlı satıştan tam 10'u geçti. Yönetici ekranı `/panel/stok/tutarlilik` (`GET /stok/tutarlilik`, `POST /stok/tutarlilik/onar`): kart/depo/varyant/varyant-depo bakiyesi ↔ hareket toplamı, onarım yalnız farkları eşitler, `stok_tutarlilik_onarim` denetim kaydı; varyantlı kartta varyantsız hareket ayrı listelenir. Demo kiracıda onarım çalıştırılmadı — HM-001 (+100) ve SF0101 (varyantsız −56.653) bekliyor) |
| P0-2, P0-3, P1-2, P2-3 | ✅ 2026-10-08 — STK-25…28 (`stok/maliyet.ts` ortak çekirdek). Alış ve alış iadesinde maliyet = satır matrahı × kur ÷ ana birim miktarı; satış iadesi bağlı satışın çıkış maliyetiyle, bağ yoksa (iade referansı bugün yalnız alış iadesinde girilebiliyor) anlık ortalamayla; alış iadesi ve girişlerin iptal/geri alma tersi maliyetiyle çıkıp ortalamadan düşer (`maliyetliCikis`). Canlıda: %20 iskontolu alış 80, USD alış sonrası ortalama 240, genel iskonto düşüldü, satış iadesi ortalamayı değiştirmedi, alış iptali ortalamayı 176,67'ye geri aldı. **Maliyeti yeniden hesapla** `/panel/stok/maliyet` (yönetici; `GET`/`POST /stok/maliyet/yeniden-hesapla`): önizleme + uygulama, kart başına ayrı işlem ve kilit, son kapalı ayın sonuna kadarki hareketler sabit. Karar 2026-10-08: hareketler değişmez kayıt kalır (NFR-08) — göç `20261008120000_stok_maliyet_duzeltmeleri` uygulama rolüne yalnız `maliyet` sütununda UPDATE verir, her değişiklik `stok_maliyet_duzeltmeleri` (yalnız ekleme, `calisma_id`) tablosuna eski/yeni değerle yazılır. Sayım düzeltmesi canlı kuralla (stok pozitifse ortalama, değilse kayıtlı); kartta tanımsız birimle yazılmış eski fatura satırı katsayı 1 sayılıp önizlemede gösterilir. Test kiracısında uygulandı (TST-1 204,55 → 160,61, TST-IPT 20 → 10), ikinci önizleme boş. Demo kiracıda yalnız önizleme: 3 kart / 23 hareket — uygulama kullanıcıda |
| P1-1, P1-3, P1-4 | ✅ 2026-10-08 — STK-29…31 (`stok/sayim.service.ts`; göç `20261008140000_sayim_varyant_parti`). Sistem miktarı sayım tarihinin gün sonuna kadarki hareketlerden (taslakta ve onayda), fark sayım tarihli düzeltme; ileri tarihli sayım reddedilir. Sayım kalemi varyant ve parti bazında; varyantlı kartta varyantsız sayım ve **her yoldan varyantsız hareket** reddedilir (`hareketEkle`). Lotlu üründe fazlalar tek giriş (parti açılır/artar), eksikler belirtilen partilerden tek çıkış (`partiSecimi: "belirtilen"`); listede olmayan sistem partisi bulunamadı sayılır. `GET /stok/sayimlar/sistem?depoId&tarih` sayım formunu besler. Canlıda: 6 Eki giriş 30 → 7 Eki sayım 28 → 8 Eki 5 satış → onay → 23 (düzeltme 7 Eki, satış korunur); L1 10/L2 5 → sayım L1 8 + yeni L3 4 → L1 8, L2 0, L3 4; varyant 10 → 8, diğer varyant ve kart tutarlı. Not: aynı günün satışı "gün sonu" kuralıyla sayımdan önce sayılır |
| P1-5, P1-6, P1-7 | ✅ 2026-10-08 — STK-32…34. Ortak kaynak `stok/satis-ozeti.ts`: ciro satır matrahı × kur, miktar ana birim, maliyet faturanın stok hareketlerinden (taslağa geri alma tersleri sıfırlanır), satış iadesi eksi, iptal dışarıda; ürün kârlılık, en çok satanlar, devir hızı ve sipariş önerisi buna geçti. SMM & Karlılık (`/rapor/smm`) baştan yazıldı: tarih aralığı, ağırlıklı ortalama hareket maliyetinden, FIFO ürünün bütün hareketlerinden kuyrukla; FIFO'da iade dönemin FIFO birim maliyetiyle geri alınır; sayfa tasarım sistemine taşındı (eski satır içi renkler kalktı). Hizmet kartına stok hareketi yazılmaz (çekirdek reddeder, fatura atlar, iptal/geri alma eski hizmet hareketini çevirmez); eksi stok, kritik stok, envanter ve tutarlılık hizmeti süzer — envanter artık sarf malzemeyi de sayar (önce yalnız `urun`). Elle hareket ucu yalnız giriş/çıkış/açılış/fire/zayi/numune/promosyon; girişte maliyet > 0. Canlıda: 2 koli satışında maliyet 200 (önce 20), TST-1 iade düşülmüş ciro 5.000, hizmet satışı hareket üretmedi |
| P2-1 | ✅ 2026-10-10 — STK-35. Kök neden havuz boyutu değil bağlantı açlığıydı: `hareketEkle` işlem içindeyken `DonemKilidiService.tarihDogrula` havuzdan ikinci bağlantı istiyordu; 5 bağlantılık havuzda 5 işlem birbirini bekliyordu (40 paralelde 33 × 503/500). `tarihDogrula` artık isteğe bağlı `tx` alır; işlem içindeki 10 çağrı (stok, POS, döviz, kredi, kredi kartı, kasa-banka) açık işlemi kullanır. Kiracı işlemi havuzdan 10 sn bekler (`maxWait`); P2024/P2028 hataları 500 yerine **503 + `Retry-After: 3`** (`db_pool_busy` uyarısı). Havuz boyutu `DATABASE_URL`'de `connection_limit` (üretim kontrol listesinde). Canlıda: 40 paralel → 40 × 201, 100 paralel → 100 × 201 (2,5 sn), kart bakiyesi hareket toplamına eşit. |
| P2-2 | ✅ 2026-10-10 — STK-36. `GET /stok/:id/hareketler` imleçli sayfa (`adet` 100, en çok 500, yeniden eskiye) + `baslangic`/`bitis`/`depoId`/`iptaller`; iptal çiftleri sorguda süzülür (sayfa eksik dolmaz). İlk sayfada `ozet`: devir (başlangıç öncesi), giriş, çıkış, son bakiye, kayıt sayısı. Ürün kartı Hareketler sekmesi: tarih/depo süzgeci, özet kutuları, satır bazında yürüyen bakiye, "Daha fazla yükle". |
| P2-4 | ✅ 2026-10-10 — STK-37. Envanter Değeri raporunda "Tarih itibarıyla" süzgeci (`stok/tarihli-envanter.ts`): miktar o gün sonuna kadarki hareketlerden (depo seçiliyse o deponun), ortalama maliyet kayıtlı hareket maliyetleriyle maliyet çekirdeğinin yeniden oynatılmasıyla (alış iadesi ve fatura iptal tersi ortalamadan düşer); rezerve/yoldaki boş; bugün pasif ama o gün stoklu kart da listelenir. Canlıda bugünün tarihiyle test kiracısında 17, demo kiracıda 27 kartın hepsi anlık raporla aynı. |
| P2-5 | ✅ 2026-10-10 — STK-38. Karar: iptalin stok ve cari ters hareketi **fatura tarihiyle** (taslağa geri almayla tutarlı); faturanın dönemi kapalıysa iptal reddedilir ("… dönemi kapalı; fatura iptali yapılamaz; iade faturası düzenleyin"). Canlıda 15.09 tarihli alış faturası 10.10'da iptal edildi, stok ve cari ters kaydı 15.09'a yazıldı. |
| P3-3 | ✅ 2026-10-10 — STK-39. Tutarlılık hesabı `stokTutarlilikHesapla(tx)` olarak dışarı açıldı ve lot/seri kalanı (parti `kalanMiktar` = parti hareketleri toplamı) eklendi; onarım partiyi de eşitler. Düzeltme Merkezi taraması (worker, 15 dk) kart başına `STOK_BAKIYE_FARKI` (kritik) ve `VARYANTSIZ_HAREKET` (uyarı) açar, fark kapanınca otomatik çözer; kaynak bağlantısı `/panel/stok/tutarlilik`. Canlıda test kiracısında yapay parti farkı yakalandı, onarım + yeniden tarama kaydı çözdü. Demo kiracıda fark yok; SF0101 varyantsız hareketi uyarı olarak düşecek. |
| P3-2 | ✅ 2026-10-10 — STK-40 Maliyet dağıtımı (`/panel/stok/maliyet-dagitimi`, `stok/maliyet-dagitimi*.ts`; göç `20261010220000_maliyet_dagitimi`, RLS + kaynak başına tek aktif dağıtım kısmi tekil dizini). Kaynak: onaylı masraf ya da kesin alış faturasının hizmet satırı (KDV hariç TL); hedef: açık dönemdeki kesin alış faturalarının stoklu satırları; ölçü tutar (TL matrah) ya da ana birim miktarı, kuruş farkı en büyük paya. Pay `maliyet_dagitim_paylari`'na yazılır, STK-28 çekirdeğinde alış maliyetine eklenir ve etkilenen kartlar aynı işlemde yeniden hesaplanır (`StokMaliyetService.kartiUygula`). Geri alma durumu `iptal` yapar ve yeniden hesaplar. Kaynağı/hedefi olan fatura iptal edilemez, taslağa geri alınamaz; masraf iptal edilemez. Muhasebe aktarımında dağıtılmış masraf ve hizmet satırı 770 yerine 153'e borç. Sınır: alış iadesi kendi matrahıyla çıkar (dağıtılan pay iadeye taşınmaz). Canlıda: 60 TL nakliye tutara göre 40/20 dağıtıldı, TST-2 ort. 21,7333 → 24,40, TST-3 10 → 10,6452; iptal/taslak engeli, fiş 153 = 360; geri almada hepsi eski değerine döndü. |
| P3-1 | Ertelendi (2026-10-10, kullanıcı kararı) — S-01'deki firma geneli kart başına ortalama maliyet korunur; varyant/depo bazlı maliyet ihtiyaç doğarsa ele alınır. |

## 2. Öncelik sınıfları

- **P0** — Miktar ya da maliyet yanlış üretiyor; veriyi kalıcı bozuyor. Önce bunlar.
- **P1** — Günlük kullanımda yanlış sonuç veya akışı durduran hata; raporlar yanıltıcı.
- **P2** — Verimlilik, ölçek, eksik ama beklenen yetenek.
- **P3** — Stratejik / tasarım kararı gerektiren genişleme.

## 3. P0 — Doğruluk

### P0-1 Eşzamanlı stok hareketinde kayıp güncelleme

`hareketEkle` stok kartını `findUnique` ile okuyor (yorumda "kilitleyerek" yazıyor ama sorgu kilit
almıyor), yeni miktar ve ortalamayı bellekte hesaplıyor, `stokKart.update` ile **mutlak değer** yazıyor.
Depo ve varyant bakiyeleri ise `increment` ile yazılıyor. Read Committed altında iki eşzamanlı hareket
aynı eski değeri okur, biri ötekini ezer; kart toplamı depo toplamından kopar ve ortalama maliyet yanlış
miktarla hesaplanır. Eksi stok denetimi de aynı nedenle iki eşzamanlı satışı birlikte geçirebilir.

- **Kanıt (test kiracısı, `TST-3`):** 4 paralel istekle 21 giriş → 21 hareket, depo bakiyesi 21,
  **kart 9**.
- **Kanıt (demo kiracı):** `HM-001` kart −12.974, depo ve hareket toplamı −12.874 (100 birim fark).
- **Öneri:** hareket başında `SELECT … FOR UPDATE` ile kart satırını kilitle (aynı işlemde depo/varyant
  bakiyesi de); eksi stok denetimi kilitten sonra yapılsın. Mevcut veriyi düzeltmek için kart, depo ve
  varyant bakiyelerini hareket toplamından yeniden kuran bir **tutarlılık denetimi ve onarım** ucu
  (yalnız yönetici, önce rapor sonra onay); ortalama maliyet hareketlerden yeniden hesaplanır (P2-3 ile
  birlikte).

### P0-2 Alış maliyetinde iskonto ve kur yok

Kesinleştirmede her satır için `birimMaliyet = birimFiyat / birimKatsayısı` (`fatura.service.ts`
kesinleştir). Satır iskontosu, genel iskonto payı ve **belge kuru** uygulanmıyor. Doğru maliyet satırın
TL matrahından gelir: `matrah × kur / (miktar × katsayı)` (matrah satır ve genel iskonto düşülmüş net).

- **Kanıt (`TST-1`):** 10 × 100 TL, %20 iskonto → maliyet 100 (beklenen 80). 10 × 10 USD kur 40 →
  ortalama 55 (beklenen 240). 10 × 100 TL, 500 TL genel iskonto → iskonto yok sayıldı.
- **Etki:** envanter değeri, ürün kârlılığı, üretim emri maliyeti (malzeme ortalama maliyetle sarf
  edilir), fire/zayi tutarı, muhasebe aktarımındaki stok değeri.
- **Öneri:** maliyeti satırın TL matrahından hesapla; tevkifat ve KDV maliyete girmez. Geçmiş alış
  hareketlerinin maliyeti bir göçle yeniden yazılıp ortalama maliyet yeniden hesaplanmalı (P2-3).

### P0-3 Satış iadesi stoğa satış fiyatıyla giriyor

Aynı satır satış iadesinde de kullanılıyor: iade edilen mal stoğa **müşteriye kesilen fiyatla** giriyor
ve ortalamayı şişiriyor.

- **Kanıt (`TST-1`):** ortalama 70 TL, 5 adet 1.000 TL'den iade → ortalama **225 TL**.
- **Öneri:** satış iadesi maliyeti, iade edilen satışın çıkış maliyeti (bağlı satış faturası varsa onun
  hareketi), yoksa iade anındaki ortalama maliyet. Alış iadesi ise (P1-2) alış maliyetiyle düşmeli.

## 4. P1 — Günlük kullanım ve rapor doğruluğu

### P1-1 Sayım onayı sayımdan sonraki hareketleri yok sayıyor

Onayda fark `fiili − onay anındaki sistem miktarı` olarak hesaplanıyor (STK-20 notu bunu "güncel sistem
miktarı" diye tanımlamış). Sayım ile onay arasında satılan ya da alınan mal, fiili sayımın üzerine
yazılıyor.

- **Kanıt (`TST-1`):** sayım fiili 30 (fark yok) → 5 adet satış (depo 25) → onay → depo **30**.
- **Öneri:** fark = `fiili − sayım tarihindeki sistem miktarı` (sayım anı anlık görüntüsü ya da sayım
  tarihine kadarki hareket toplamı); onayda yalnız bu fark işlenir. STK-20 notu buna göre düzeltilmeli.

### P1-2 Alış iptali ve alış iadesi ortalama maliyeti geri almıyor

Çıkış türleri ortalamayı hiç değiştirmiyor; alış faturası iptal edilince (ya da alış iadesinde) mal
ortalama maliyetle çıkıyor, yüksek/düşük fiyatlı alımın ortalamaya etkisi kalıcı oluyor.

- **Kanıt (`TST-IPT`):** 10 adet @10 + 10 adet @30 alış → ortalama 20; alış iptali → 10 adet, ortalama
  **20** (beklenen 10).
- **Öneri:** alış iptali/iadesi çıkışı alış maliyetiyle yapılsın ve ortalama `(değer − çıkan değer) /
  kalan miktar` ile yeniden hesaplansın (kalan ≤ 0 ise ortalama korunur).

### P1-3 Varyant bakiyesi kart toplamından kopuyor

Sayım kaleminde varyant alanı yok; varyantlı kartın sayımı kart ve depo bakiyesini düzeltiyor, varyant
bakiyesini bırakıyor. `hareketEkle` varyantlı kartta varyantsız hareketi de kabul ediyor (elle hareket,
sayım; fatura satırında varyant zorunlu).

- **Kanıt (`TST-VAR`):** varyant 10 → sayım 8 → kart **8**, varyant **10**.
- **Kanıt (demo `SF0101`):** kart −57.153, varyantların toplamı −500.
- **Öneri:** sayım kalemine varyant (varyantlı kartta zorunlu); `hareketEkle` varyantlı kartta varyantsız
  hareketi reddetsin. Eski varyantsız hareketler için onarım ucu (P0-1) "dağıtılmamış" kalemi
  raporlasın.

### P1-4 Lot/seri takipli üründe sayım fazlası onayı durduruyor

Sayım onayındaki artış hareketi parti bilgisi taşımıyor; `partiTahsisEt` "Parti miktarları hareket
miktarına eşit olmalıdır" diye reddediyor ve **sayımın tamamı** onaylanamıyor.

- **Kanıt (`TST-LOT`):** 10 adet L1 → sayım 12 → onay 400.
- **Öneri:** sayım kaleminde lot/seri girişi (lotlu ürünlerde fazlanın lotu sorulur, eksik FEFO ile
  düşer); en azından hatanın hangi ürün olduğu söylenmeli.

### P1-5 Ürün kârlılık raporu yanlış maliyetle

`stok.urun-karlilik` maliyeti `kartın bugünkü ortalama maliyeti × satır miktarı` ile hesaplıyor:
(a) satır miktarı ek birimdeyse ana birime çevrilmiyor, (b) satış anındaki maliyet değil bugünkü maliyet,
(c) satış iadeleri ciro ve maliyetten düşülmüyor (`en-cok-satanlar` da aynı yardımcıyı kullanıyor).

- **Kanıt:** 2 koli (20 adet, maliyet 10) satışında maliyet **20 TL** (beklenen 200); `TST-1`'de 5 adet
  iade ciroda duruyor.
- **Öneri:** maliyet ve miktar faturanın stok hareketlerinden (`kaynakTur=fatura`, hareket maliyeti ×
  ana birim miktarı) okunsun; satış iadeleri eksi olarak dahil edilsin, iptal çiftleri hariç (STK-22).

### P1-6 Hizmet kartlarına stok hareketi yazılıyor

Kesinleştirme kart türüne bakmadan her satır için hareket yazıyor; hizmetin "stoğu" eksiye düşüyor ve
eksi stok raporunda görünüyor.

- **Kanıt (`TST-HIZ`):** 3 adet hizmet satışı → kart −3, eksi stok raporunda listelendi.
- **Öneri:** `tip = hizmet` (ve gerekiyorsa sarf dışı stoksuz türler) için hareket yazılmasın; mevcut
  hizmet hareketleri raporlardan süzülsün.

### P1-7 Elle hareket ucu sayım onayını atlıyor

`POST /stok/:id/hareketler` tip listesinde `sayim_duzeltme` var: muhasebe rolü sayım ve onay olmadan
düzeltme yazabiliyor (yalnız artış, şema miktarı pozitif istiyor; maliyet 0 girilirse ortalamayı
düşürür). STK-20 "sayım farkları onaya bağlı işlenir" diyor.

- **Kanıt:** elle `sayim_duzeltme` 3 adet kabul edildi (`transfer_giris` doğru şekilde reddedildi).
- **Öneri:** elle uçta yalnız giriş/çıkış/fire/zayi/numune/promosyon/açılış; girişte maliyet zorunlu
  (> 0) ya da boşsa ortalama maliyet.

## 5. P2 — Ölçek, verimlilik, eksik yetenek

- **P2-1 Bağlantı havuzu:** 20 paralel stok hareketinde 35/40 istek "Unable to start a transaction in
  the given time" ile 500 döndü. Havuz boyutu / işlem bekleme süresi (`connection_limit`,
  `transactionOptions.maxWait`) yük altında ayarlanmalı; 500 yerine "yeniden deneyin" yanıtı.
- **P2-2 Hareket listesi sayfasız:** `GET /stok/:id/hareketler` ürünün bütün hareketlerini döndürüyor
  (yoğun üründe binlerce satır); imleçli sayfalama + tarih süzgeci.
- **P2-3 Maliyet yeniden hesaplama yok:** AVCO giriş sırasıyla güncelleniyor; geçmiş tarihli alış sonradan
  girilince arada yapılan satışların maliyeti düzelmiyor, P0-2/P0-3 düzeltmesinden sonra eski veriyi
  onaracak araç da yok. Ürün (ya da tümü) için hareketleri tarih sırasıyla yeniden oynatıp hareket
  maliyetlerini ve kart ortalamasını yeniden yazan, kapalı dönemi koruyan bir "maliyeti yeniden hesapla".
- **P2-4 Geçmiş tarihli envanter yok:** envanter raporu yalnız anlık; dönem sonu (ör. 31.12) miktar ve
  değeri alınamıyor. Hareketlerden tarih itibarıyla envanter.
- **P2-5 Fatura iptalinin stok tersi bugünün tarihiyle:** `iptal` ters hareketi `new Date()` ile,
  taslağa geri alma faturanın tarihiyle yazıyor; dönem raporlarında iptal edilen geçmiş ay faturası bu
  aya eksi hareket bırakıyor. Karar gerekli (iptal tarihi mi, fatura tarihi mi); en azından tutarlı olmalı.

## 6. P3 — Stratejik

- **P3-1 Depo/varyant bazlı maliyet:** S-01 kararıyla ortalama maliyet firma genelinde ve kart başına
  tek; bedene/renge göre farklı maliyetli varyantlar ortak ortalamaya giriyor.
- **P3-2 Yansıtılan maliyetler (landed cost):** nakliye, gümrük, sigorta giderleri stok maliyetine
  dağıtılamıyor (masraf faturası → stok maliyeti).
- **P3-3 Periyodik tutarlılık denetimi:** kart / depo / varyant / parti bakiyelerinin hareket toplamıyla
  uyumunu gece kontrol edip Düzeltme Merkezi'ne düşüren iş (P0-1 onarım ucunun otomatik hâli).

## 7. Önerilen sıra

1. **P0-1** kilit + tutarlılık denetimi/onarım ucu (önce rapor modu; demo kiracıdaki iki kart burada
   görünür).
2. **P0-2 + P0-3** maliyetin TL matrahtan ve iadede çıkış maliyetinden gelmesi.
3. **P2-3** maliyeti yeniden hesaplama (P0-2/P0-3 öncesi yazılmış hareketleri onarmak için gerekli;
   P1-2 ile aynı hesap çekirdeği).
4. **P1-1, P1-3, P1-4** sayım (anlık görüntü, varyant, lot) — aynı ekran ve şema değişikliği.
5. **P1-5, P1-6, P1-7** rapor ve uç düzeltmeleri.
6. P2 kalanları, P3 kararları.

Her madde için önce isterler kullanıcıyla onaylanır (S-01).

## 8. Deneme verisi

Kiracı **Stok İnceleme Test A.Ş.** (VKN 1111111111), yönetici `stok.inceleme@tekirextra.local` /
`StokTest2026x`. Cari `T001 Tedarikçi Test`, `M001 Müşteri Test`. Ürünler: `TST-1` (maliyet senaryoları,
sayım), `TST-2` / `TST-3` (eşzamanlılık), `TST-LOT`, `TST-VAR`, `TST-KOLI` (koli = 10 adet),
`TST-IPT` (alış iptali), `TST-HIZ` (hizmet). Betikler oturuma özeldi (scratchpad), senaryolar yukarıdaki
kanıt satırlarında.
