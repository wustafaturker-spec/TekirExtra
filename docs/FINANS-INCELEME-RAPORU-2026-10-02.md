# Finans Bölümü İnceleme Raporu

**Tarih:** 2 Ekim 2026
**İnceleme türü:** Kod okuma (API servisleri, şemalar, web ekranları) + veri modeli; kod değişikliği yapılmadı
**Kapsam:** Menüdeki "Finans" grubu — Kasa & Banka, Kredi Kartları, POS Hesapları, Çek & Senetler,
Banka Ekstresi, Ödeme Talimatları, Projeler & Analitik Yevmiye
**Dosyalar:** `apps/api/src/kasa-banka/*`, `apps/api/src/pos/*`, `apps/api/src/projeler/*`,
`apps/web/src/app/panel/kasa-banka/**`, `apps/web/src/app/panel/projeler/**`

## 1. Özet

Finans bölümünün temeli sağlam: hesap başına döviz denetimi, çek/senet durum makinesi ve
eşzamanlılık koruması, POS geri çağrılarında imza ve tekrar koruması, ödeme talimatında
dört göz + TOTP, ekstrede mükerrer satır koruması doğru kurulmuş.

Buna karşın üç alan para hesabını doğrudan etkiliyor ve öncelikle düzeltilmeli:

1. **Dövizli ödeme ve kur farkı tutarsız.** Faturanın "kalan" tutarı, ödemenin kuruyla değil
   faturanın kuruyla hesaplanıyor. TL ile tahsil edilen dövizli fatura "ödendi" görünürken
   cari bakiyesi iki ayrı dövizde açık kalıyor. Kredi kartında dövizli işlemler TL kuru 1 ile
   yazılıyor.
2. **Yanlış girilen fiş düzeltilemiyor.** Tahsilat, tediye, virman, çek/senet işlemi ve kredi
   kartı hareketinin silme, iptal ya da ters kayıt yolu yok. Tek istisna ekstreden üretilen fiş.
3. **Dönem kilidi yalnız bazı işlemlerde uygulanıyor.** Virman, POS→banka aktarımı, çek/senet
   işlemleri, POS tahsilatı ve ekstre geri alma kapalı döneme kayıt yazabiliyor ya da kayıt silebiliyor.

Ekstre eşleştirme yalnız "cari + tek fatura" biliyor. Bu yüzden banka masrafı, vergi/SGK
ödemesi, kendi hesaplar arası transfer ve önceden elle girilmiş tahsilat ekstreden
kapatılamıyor; sistemdeki banka bakiyesi gerçek bakiyeden zamanla ayrılıyor. Proje kârlılığı
KDV dahil ve dövize çevrilmeden toplanıyor.

Yerel veritabanında finans verisi çok az: 1 kasa, 3 banka, 9 hareket, 1 çek, 1 kart;
ekstre satırı, POS ve proje kaydı yok. Aşağıdaki hataların çoğu bu yüzden henüz ekranda
görülmemiş olabilir.

## 2. Öncelik sınıfları

| Sınıf | Anlamı |
|---|---|
| **P0** | Yanlış tutar, yanlış bakiye ya da kapalı dönemin bozulması — veri girildikçe büyür |
| **P1** | Günlük kullanımda eksikliği hemen hissedilen temel işlev |
| **P2** | Verimlilik, raporlama, performans |
| **P3** | Stratejik / uzun vadeli |

## 3. P0 — Doğruluk hataları

### P0-1 Dövizli faturanın kalan tutarı yanlış hesaplanıyor
`apps/api/src/fatura/fatura.service.ts` (liste ve detayda `odemeOzeti`):
`odenen = Σ hareket.tutarTry ÷ fatura.kur`. Ödeme faturanın kurundan farklı bir kurla
yapılınca kur farkı "kalan" tutara karışıyor.

Örnek: 1.000 USD fatura, kur 30. Müşteri 1.000 USD'yi kur 28 iken öder.
`odenen = 28.000 ÷ 30 = 933,33 USD` olur. Fatura sonsuza kadar **66,67 USD kalan**
gösterir; kur yükselmişse fazla ödenmiş görünür.

**Öneri:** Ödemenin fatura dövizindeki karşılığı hareket üzerinde ayrı bir alanda saklanmalı.
Örneğin `faturaDovizTutari` alanı; aynı dövizde bu tutar `tutar`a eşit olur. Kalan tutar
yalnız bu alandan hesaplanmalı. Kur farkı ayrı izlenmeli (bkz. P1-2).

### P0-2 "Faturanın kalanı" altı yerde altı farklı biçimde hesaplanıyor
| Yer | Hesap |
|---|---|
| `fatura.service.ts` | tutarTry ÷ fatura kuru + kart ödemeleri |
| `rapor.service.ts` | tutarTry toplamı + kart ödemeleri |
| `nakit-akisi.service.ts` | tutar × kur |
| `ekstre.service.ts` → `acikFaturalar` | ham `tutar` toplamı, **kart ödemeleri yok** |
| `duzeltmeler.service.ts` | ham `tutar` toplamı |
| `kredi-karti.service.ts` → `cariOdeme` | ham `tutar` toplamı |

Sonuç: aynı fatura ekstre önerisinde "açık", detayda "ödendi", düzeltme merkezinde "fazla
ödenmiş" görünebilir. Kasa fişinde (`kasa-banka.service.ts` `hareketEkle`) kalan tutar sunucuda
**hiç denetlenmiyor**; yalnız ekrandaki `window.confirm` uyarıyor.

**Öneri:** Tek bir `faturaOdemeDurumu(tx, faturaIdler)` yardımcısı yazılmalı (shared ya da
`fatura/odeme-durumu.ts`). Altı yer de onu kullanmalı. Fazla ödeme sunucuda engellenmeli ya da
açık onayla avans olarak ayrılmalı.

### P0-3 Dövizli fatura TL ile kapatılınca cari iki dövizde açık kalıyor
`hareketEkle`, fatura ile hesap dövizi farklı olsa da kayda izin veriyor (kodda "çapraz kur
desteği" yorumu var). Cari hareketi ise **hesabın dövizinde** yazılıyor. Cari bakiye döviz
bazında gruplandığı için (`cari.service.ts` `bakiyeleriGetir`) USD carinin ekranında
"+1.000 USD borç" ve "−30.000 TL alacak" yan yana görünür. İkisi asla netleşmez, oysa fatura
"ödendi" görünür.

Aynı durumda kredi kartı ve POS akışları farklı dövize **izin vermiyor**. Kural modüller
arasında tutarsız.

**Öneri:** Çapraz dövizli tahsilatta cari hareketi carinin/faturanın dövizinde yazılmalı:
tutar = TL ÷ işlem günü kuru, tutarTry = gerçek TL. Fatura kuruyla aradaki fark kur farkı
hareketi olarak ayrılmalı. Bu yapılana kadar kasa/banka akışı da kart/POS gibi farklı dövizi
reddetmeli.

### P0-4 Kredi kartında dövizli işlemlerin TL karşılığı yanlış
`kredi-karti.service.ts`:
- `cariOdeme` cari hareketini `kur: 1, tutarTry: cariTutar` ile yazıyor.
- `ekstreOdeme` banka hareketini aynı biçimde yazıyor.

USD kartla 1.000 USD ödeme TL karşılığı 1.000 TL olarak kaydedilir. Bu, cari TL bakiyesini ve
bütün TL raporları bozar.

**Öneri:** Diğer akışlardaki gibi `kurZorunlu(tx, doviz, tarih)` kullanılmalı.

### P0-5 Dönem kilidi eksik
`donemKilidi.tarihDogrula` yalnız `hareketEkle` ve üç kredi kartı işleminde çağrılıyor.
Denetimsiz kalan işlemler:

| İşlem | Dosya |
|---|---|
| Virman | `kasa-banka.service.ts` `virmanEkle` |
| POS → banka aktarımı + komisyon masrafı | `posBankayaAktar` |
| Çek/senet kaydı (cari hareketi yazar) | `cekSenetOlustur` |
| Çek tahsil/ödeme/ciro/karşılıksız (fiş + cari hareketi yazar) | `cekSenetGuncelle` |
| POS tahsilatı (geri çağrı) | `pos.service.ts` `callback`, `odemeyiKaydet` |
| Ekstre eşleşmesini geri al (fiş + cari hareketini **siler**) | `ekstre.service.ts` `geriAl` |

**Öneri:** Hepsine aynı denetim eklenmeli. Geri almada denetim fişin tarihine göre yapılmalı.
Kapalı döneme düşen POS geri çağrısı reddedilmemeli; kayıt dönemin ilk açık gününe yazılmalı
ya da düzeltme merkezine düşmeli.

### P0-6 Portföydeki çekler kasa/banka defterinde "tahsilat" olarak görünüyor
`hareketListele`, filtre verilmediğinde portföyde, tahsilde veya teminatta olan alınan çekleri
hesapsız sahte "tahsilat" satırı olarak listeye ekliyor. Etkileri:
- Ekrandaki "Bugünkü giriş" kutusu bugün alınan çeki nakit girişi sayar
  (`panel/kasa-banka/page.tsx` `ozet`).
- Bu satırlarda "Makbuz" düğmesi görünür ama 404 verir; satır kimliği çek kimliğidir.
- Hesap süzgecinde bu satırlar kaybolur, CSV dışa aktarımında hesapsız tahsilat olarak çıkar.

**Öneri:** Çekler ayrı bir "Portföy" bölümünde ya da ayrı bir türle gösterilmeli; nakit
özetine ve makbuza katılmamalı.

### P0-7 Ekstre eşleştirmesi çift fiş üretebilir
`ekstre.service.ts` `eslestir` sırasıyla şunları yapıyor:
1. Satırın durumunu okur.
2. Fişi **ayrı bir işlemde** üretir (`hareketEkle`).
3. Satırı koşulsuz günceller.

Aynı satıra iki istek gelirse, örneğin çift tıklama ya da iki kullanıcı, iki fiş ve iki cari
hareket oluşur. İkinci güncelleme ilk fişi sahipsiz bırakır.

**Öneri:** Satır `updateMany({ where: { id, durum: "beklemede" } })` ile önce kilitlenmeli
(çek/senette kullanılan desen). Fiş aynı işlem içinde üretilmeli.

### P0-8 Proje kârlılığı KDV dahil ve dövize çevrilmeden hesaplanıyor
`projeler.service.ts` `projeFinansOzeti` ve `analitikYevmiyeKirilimlari`:
- Fatura satırının `toplamTutar` alanını topluyor; bu alan **matrah + KDV** demek.
- Masrafın `toplam` alanını topluyor; bu da KDV dahil.
- USD/EUR faturalar TL'ye çevrilmeden TL ile toplanıyor.
- İade faturaları (`satis_iade`, `alis_iade`) hesaba hiç girmiyor.

Gelir kayıtları ise `netTutarTry` ile alınıyor; aynı tabloda farklı esaslar karışıyor.

**Öneri:** Hesap matrah × fatura kuru (masrafta matrah × kur) ile yapılmalı. İadeler ters
yönde düşülmeli.

## 4. P1 — Eksik temel işlevler

### P1-1 Fiş düzeltme ve iptal (ters kayıt)
Manuel tahsilat, tediye, virman, çek/senet işlemi ve kredi kartı hareketi için düzeltme yolu
yok. Kasa-banka denetleyicisinde hareket için `DELETE` ya da `PATCH` ucu bulunmuyor. Yanlış
tutarla girilen bir tahsilat kalıcı olarak kalıyor.

Önerilen kural:
- Açık dönemde ve başka kayda bağlı değilse fiş **silinebilir**; cari hareketi de birlikte silinir.
- Aksi hâlde **ters kayıt** atılır: aynı tutar ters yönde, iki kayıt birbirine bağlı.
- Virmanda iki bacak birlikte işlem görür.
- Çek/senette son durum geri alınabilir; olay geçmişine "geri alındı" yazılır.
- İşlem denetim izine ve belge durum geçmişine düşer.

### P1-2 Kur farkı ve döviz alım-satımı
- Farklı dövizler arasında virman yapılamıyor (`virmanKurallariniDenetle`). "USD hesaptan
  TL hesaba bozdurma" işlemi şu an iki ayrı, cari'siz tahsilat/tediye olarak girilmek zorunda.
  Kur da kâr da kaybolur.
- Dövizli fatura ve çekte tahsil kuru ile kayıt kuru arasındaki fark hiçbir yerde
  hesaplanmıyor. Çek tahsilinde `CS.kur` (alış günü kuru) kullanılıyor.
- Döviz bakiyelerinin dönem sonu değerlemesi yok.

**Öneri:** (a) iki kurlu "döviz alım/satım virmanı", (b) kapama anında kur farkı hareketi ve
"kur farkı faturası kesilecek" listesi, (c) isteğe bağlı ay sonu değerleme raporu.

### P1-3 Ekstre eşleştirmesini genişletmek
Şu an bir ekstre satırı yalnız **bir cariye ve en fazla bir faturaya** bağlanabiliyor; geri
kalan her satır "yoksay" ile geçiliyor. Yoksayılan satırlar sistemdeki banka bakiyesine
**hiç yansımıyor**. Bu yüzden ilk banka masrafından itibaren sistem bakiyesi bankadan ayrılıyor.

Eklenmesi gereken eşleme türleri:

| Tür | Sonuç |
|---|---|
| Mevcut fişle eşle | Önceden elle girilmiş tahsilat/tediye ile bağ kurar, yeni fiş üretmez. Şu an tek seçenek yeni fiş üretmek; bu da çift kayıt demek |
| Masraf olarak işle | Kategori seçilir; banka masrafı, BSMV, faiz ve kredi taksiti masraf kaydına + tediyeye döner |
| Gelir olarak işle | Faiz geliri vb. faaliyet dışı gelir kaydına döner |
| Kendi hesabıma virman | Diğer hesabın ekstresindeki karşı satırla birlikte tek virman olur |
| Çek tahsili / ödemesi | Tahsildeki ya da verilen çeki kapatır |
| Kredi kartı ekstre ödemesi | Kart borcunu düşer |
| Çoklu fatura | Bir ödeme birden çok faturaya dağıtılır (FIFO önerisi) |

Ayrıca:
- **Bakiye mutabakatı:** Ekstredeki `bakiye` sütunu saklanıyor ama hiç kullanılmıyor. Ekranda
  "bankaya göre bakiye / sistemdeki bakiye / fark" gösterilmeli.
- **Excel ekstresi:** Bankaların çoğu ekstreyi `.xlsx` veriyor; şu an yalnız CSV okunuyor
  (`ekstre-oku.ts`).
- **Kural öğrenme:** "Açıklamada 'EFT MASRAFI' geçen satırlar → Banka Masrafları kategorisi"
  gibi kayıtlı kurallar.

### P1-4 Tahsilat makbuzu numarası
Makbuz PDF'i sıra numarası yerine kayıt kimliğinin ilk 8 karakterini kullanıyor
(`makbuz-pdf.ts`, `kasa-banka.service.ts` `makbuzPdf`). Kasa tahsilat/tediye makbuzu için seri
ve sıra numarası (ör. `TM2026-000123`) gerekli. Fatura serileriyle aynı sayaç altyapısı
kullanılabilir.

### P1-5 Kredi kartı
- **Dönem ekstresi yok.** `hesapKesimGunu` ve `sonOdemeGunu` kaydediliyor ama kullanılmıyor.
  "Bu dönem ödenecek", taksitlerin hangi ekstreye düştüğü ve son ödeme günü uyarısı gerekli.
  Bugün ekstre ödemesi yalnız toplam borçla karşılaştırılıyor.
- **Gider yazılmıyor.** Kart ekranından girilen doğrudan "harcama", "faiz" ve "aidat" masraf
  kaydı üretmiyor; gelir-gider raporuna ve bütçeye girmiyor. Masraf ekranından kartla ödeme ise
  doğru çalışıyor.
- **Vade farkı gider yazılmıyor.** Kartla cari ödemesindeki komisyon/vade farkı da gider yazılmıyor.
- **Limit denetimi yok.** Harcama sırasında kart limiti denetlenmiyor.
- **Liste sınırsız.** Liste her kartın **bütün** hareketlerini ve taksitlerini tek seferde
  yüklüyor (`listele`).

### P1-6 POS
- **Fiziksel POS yok.** Fiziksel banka POS cihazı desteklenmiyor; POS hesabı yalnız
  `iyzico | paytr` olabiliyor. KOBİ'lerin çoğu banka POS'u kullanıyor. Gereken: sağlayıcısız
  "banka POS'u" türü, valör/bloke günü (ör. T+1, 30 gün bloke) ve bloke çözüm tarihine göre
  bankaya aktarım listesi.
- **Süresi dolan bağlantı kapanmıyor.** Bağlantılar 7 gün geçerli
  (`sonKullanimTarihi`) ama `suresi_doldu` durumunu yazan bir iş **yok**; süresi dolan talepler
  sonsuza kadar "başlatıldı" kalıyor. Elle iptal ucu da yok.
- **Mükerrer bağlantı serbest.** Aynı fatura için birden çok açık ödeme bağlantısı
  oluşturulabiliyor, tutar kalan tutarla denetlenmiyor. Müşteri iki bağlantıyı da öderse çift
  tahsilat olur.
- **İade yok.** POS iadesi/iptali (sağlayıcıda refund) desteklenmiyor.

### P1-7 Çek / senet
- **Ciro sonrası karşılıksız çıkış yok.** Ciro edilen çek karşılıksız çıkarsa yapılacak bir
  işlem yok; `ciro_edildi` son durum. Gerçekte çek geri gelir: ciro edilen cariye tekrar
  borçlanırız, keşideciden yeniden alacaklı oluruz.
- **Bordro yok.** Birden çok çeki tek seferde giriş/çıkış/ciro/bankaya verme işlemi ve bordro
  çıktısı yok.
- **Hesap bağı yok.** Tahsile ya da teminata verilen çekin **hangi bankada** olduğu kayıt
  altında değil; yalnız serbest metin olan `fizikselKonum` var.
- **Kısmi tahsil ve protesto yok.** Senette kısmi tahsil yok; protesto ve icra durumu yok.
- **Çek ödemesinde kur farkı yok** (bkz. P1-2).

### P1-8 Ödeme talimatı (ENT-07)
Onaylanan talimat hiçbir şey üretmiyor: bankaya gönderilmiyor, tediye fişi yazılmıyor,
cari/fatura ile bağı yok. Sağlayıcı adaptörü beklenirken iki ara adım işe yarar:
- Talimatı cari ve faturalara bağlamak; onayda "bekleyen tediye" üretmek, ekstreden eşleşince
  kesinleştirmek.
- Onaylanan talimatları bankaların **toplu EFT dosyası** biçiminde indirmek. İnternet
  bankacılığına yüklenebilir.

### P1-9 Kasa/banka hesap ekstresi ve açılış bakiyesi
- **Hesap ekstresi yok.** Seçili hesabın dönem başı devir, yürüyen bakiye ve dönem sonu
  bakiyesini gösteren bir ekstre (PDF/Excel) yok. Hareket listesi tarih süzgeciyle daraltılınca
  devir kayboluyor.
- **Açılış fişi yok.** Hesap açılış bakiyesi için ayrı bir açılış/devir fişi yok. Cari'siz
  tahsilat olarak girilince raporlarda gerçek tahsilat gibi sayılıyor.
- **Eksi bakiye denetimi yok.** Kasa eksi bakiyeye düşebiliyor (fiziksel olarak mümkün değil);
  tediye ve virmanda bakiye denetimi ya da en azından uyarı yok.

## 5. P2 — Verimlilik, raporlama, performans

1. **Hareket listesinde sayfalama yok.** `GET /kasa-banka/hareketler` bütün hareketleri döndürüyor;
   süzgeçler tarayıcıda uygulanıyor. Birkaç bin hareketten sonra ekran yavaşlar. Sunucu tarafı
   tarih/hesap/tür süzgeci ve imleçli sayfalama gerekli (faturada var).
2. **Ekstre kutusunda N+1 sorgu.** `satirListele` her bekleyen satır için `oneriHesapla`
   çağırıyor. Bu da her seferinde **bütün aktif carileri** çekip metin karşılaştırıyor; işlem
   sayısı satır × cari sayısıyla büyür. Cariler bir kez çekilmeli, öneri sayfalı listeye
   uygulanmalı.
3. **Proje listesinde N+1 sorgu.** Her proje için 5 toplama sorgusu atılıyor; alt kırılımlarda
   da kırılım başına 4. `groupBy` ile tek seferde hesaplanmalı.
4. **Kasa/Banka raporlar ekranı yok.** RPR-08 matrisindeki "Kasa/Banka → Raporlar" ekranı yok:
   hesap hareketi, tahsilat/ödeme özeti, mutabakat, POS/banka komisyonu, hesap bazlı nakit.
5. **Banka senkronu elle.** Vomsis senkronu yalnız düğmeyle çalışıyor; worker'da zamanlanmış iş
   yok. Gelen e-Belge taramasındaki kursörlü düzen burada da kullanılabilir.
6. **Kur türü tutarsız.** Ekstre eşleşmesi ve POS "satış" kuru, elle fiş varsayılan kuru
   kullanıyor. Hangi işlemde hangi kur kullanılacağı tek kurala bağlanmalı (bkz. masraf kuru
   notu: `kur-coz.ts`).
7. **Döviz listesi dar.** Yalnız TRY/USD/EUR var; GBP/CHF gibi dövizlerle çalışan firmalar
   hesap açamıyor.
8. **Kod biçimi sıkıştırılmış.** Kasa-banka ana sayfası, kredi kartı/POS sayfaları ve
   `kredi-karti.service.ts` tek satıra sıkıştırılmış durumda (2.000+ karakterlik satırlar).
   Bakım ve inceleme çok zor; ilk dokunuşta açık biçime getirilmeli.
9. **Testler eksik.** Testler büyük ölçüde mock'lu birim testi. Yukarıdaki P0 kalemleri için
   gerçek veritabanında senaryo testi yok: dövizli kapama, çift eşleştirme, dönem kilidi.

## 6. P3 — Stratejik

- **Muhasebe fişi katmanı yok.** Ekranın adı "Projeler & Analitik Yevmiye" ama üründe hesap
  planı ve yevmiye yok; kayıtlar modül tablolarında tutuluyor. Mali müşavir aktarımının doğru
  olması için her kasa/banka/çek/kart hareketinin karşı hesabının belli olması gerekir.
  Önerilen yol tam çift taraflı muhasebe değil: hareket türünden **muhasebe hesap kodu
  eşlemesi** (100 Kasa, 102 Bankalar, 101/103 Çekler, 108 POS, 300 Banka kredileri vb.) ve
  dönemlik fiş dışa aktarımı.
- **Banka kredileri yok.** Kredi kullanımı, taksit planı, faiz/BSMV ayrımı ve nakit akışına
  yansıması modellenmemiş.
- **Nakit pozisyonu ekranı yok.** Kasa + banka + POS bekleyen + portföy çekleri + kart borcu
  tek ekranda, döviz bazında görünmüyor.

## 7. Önerilen sıra

| Sıra | İş | Kapsam |
|---|---|---|
| 1 | P0-2 tek ödeme durumu kaynağı + P0-1 fatura dövizindeki ödeme tutarı | Göç + 6 servis |
| 2 | P0-3/P0-4 çapraz döviz ve kart kuru | 2 servis |
| 3 | P0-5 dönem kilidi + P0-7 ekstre kilidi | Küçük, düşük risk |
| 4 | P0-6 portföy çeklerini defterden ayır | Servis + ekran |
| 5 | P1-1 fiş düzeltme/ters kayıt | Yeni uçlar + ekran |
| 6 | P1-3 ekstre eşleme türleri + bakiye mutabakatı | En büyük kullanıcı kazancı |
| 7 | P0-8 proje kârlılığı | Küçük |
| 8 | P1-2 kur farkı + döviz alım/satım | İş kuralı kararı gerekir |
| 9 | P1-5…P1-9 | Modül modül |

P1-2 (kur farkının nasıl işleneceği) ve P1-3 (yoksayılan satırların nereye yazılacağı) iş
kuralı kararı gerektiriyor; kodlamadan önce S-01 onay kapısından geçmeli.
