# TekirExtra UI Kullanici Tatmini ve Benimsenme Raporu

**Tarih:** 2026-08-06
**Kapsam:** TekirExtra web arayuzu; satis, satin alma, belge/fatura yonetimi,
cari ve stok secimi, gunluk operasyon akislari
**Amac:** Muhasebe bilgisi farkli seviyelerde olan KOBI kullanicilarinin
uygulamayi daha hizli ogrenmesini, daha az hata yapmasini ve gunluk islerinde
TekirExtra'yi duzenli olarak benimsemesini saglamak

---

## 1. Yonetici Ozeti

TekirExtra'nin mevcut arayuzu genis bir fonksiyonel kapsama sahiptir. Cari,
stok, fatura, genel belgeler, kasa/banka, cek-senet, banka ekstresi, e-belge,
raporlama ve ayarlar icin ekranlar bulunmaktadir. Buna karsin ana navigasyon ve
bazi ekranlar, kullanicinin gunluk is dilinden cok teknik domain ve veri modeli
sinirlarini yansitmaktadir.

Kullanici genellikle "belge kaydi", "cari hareket" veya "e-belge kaydi"
dusunmez. Asagidaki amaclarla hareket eder:

- Musteriye satis yapmak ve fatura kesmek
- Gelen faturayi kontrol edip kaydetmek
- Tahsilat almak veya tedarikciye odeme yapmak
- Bir urunun stok ve fiyat bilgisini bulmak
- Geciken alacaklari takip etmek
- Banka hareketlerini kayitlarla eslestirmek

Bu nedenle teknik olarak ortak belge ve fatura motoru korunurken arayuzun
**Satis** ve **Satin Alma** merkezli iki ayri calisma alanina ayrilmasi onerilir.
En buyuk ikinci kazanc, cari ve urun secimlerinin gelismis arama/combobox
bilesenlerine donusturulmesi; ucuncu kazanc ise fatura kalem girisinin klavye,
barkod ve seri veri girisine uygun hale getirilmesidir.

Oncelikli sonuc:

> Backend'de ortak domain motoru korunmali; kullaniciya ise amaci acik, gorev
> odakli ve satis/satin alma baglamlari birbirinden ayrilmis deneyimler
> sunulmalidir.

---

## 2. Temel UX Ilkeleri

### 2.1 Kullanici diliyle bilgi mimarisi

Menu ve komutlar teknik tablo veya servis adlarina gore degil, kullanicinin
tamamlamak istedigi ise gore adlandirilmalidir.

| Teknik ifade | Onerilen kullanici ifadesi |
|---|---|
| Cari hareket ekle | Tahsilat al / Odeme yap / Borclandir / Alacaklandir |
| Gelen belgeyi isle | Alis faturasi olustur |
| E-belge kaydi | e-Fatura durumu |
| Belge kesinlestir | Faturayi kesinlestir |
| Kasa/banka hareketi | Tahsilat, odeme veya virman |

### 2.2 Gorev odakli ekranlar

Her ekran su sorulardan en az birine hizla cevap vermelidir:

- Sirada hangi isi yapmaliyim?
- Bu kaydin mevcut durumu nedir?
- Bu islem stok, cari ve nakdi nasil etkileyecek?
- Hatayi duzeltmek icin hangi eylemi yapabilirim?

### 2.3 Asamali ayrinti

Sik kullanilan alanlar dogrudan gorunmeli; tevkifat, istisna kodu, doviz kuru,
ozel matrah ve entegrator ayrintilari yalniz ilgili senaryo secildiginde
acilmalidir. Bu yaklasim basit faturayi basit tutarken ileri muhasebe
senaryolarini kaybetmez.

### 2.4 Sonucu gorunur kilma

Finansal veya geri alinmasi zor islemlerde genel bir "Emin misiniz?" mesaji
yerine islemin etkisi acikca yazilmalidir:

> Bu fatura kesinlesecek, stoktan 12 adet dusecek ve musteri hesabina
> 18.240 TL borc yazilacak.

---

## 3. Onerilen Ana Navigasyon

Mevcut moduller korunarak ana navigasyon asagidaki is alanlarina ayrilmalidir:

1. **Ana Sayfa**
2. **Satis**
3. **Satin Alma**
4. **Cari Hesaplar**
5. **Urun ve Stok**
6. **Kasa ve Banka**
7. **Raporlar**
8. **Ayarlar**

### 3.1 Satis calisma alani

- Satis faturalari
- Teklifler
- Satis siparisleri
- Sevk irsaliyeleri
- Satis iadeleri
- Tahsilatlar
- Musteriler

### 3.2 Satin alma calisma alani

- Alis faturalari
- Satin alma siparisleri
- Gelen irsaliyeler
- Alis iadeleri
- Odemeler
- Tedarikciler
- Gelen e-Belgeler

### 3.3 Belgeler ekraninin konumu

"Belgeler" gunluk kullanimin ana giris noktasi olmamalidir. Satis ve satin alma
altindaki amaca yonelik ekranlar varsayilan olmali; mevcut genel belge ekrani
ise ileri arama ve denetim icin **Tum Belgeler** gorunumu olarak korunmalidir.

Bu ayrim yalniz sunum katmaninda yapilmalidir. Backend'de satis ve satin alma
icin birbirinden kopuk iki fatura motoru olusturulmamalidir.

---

## 4. Belge ve Fatura Yonetimi

### 4.1 Durumlari ayri eksenlerde gosterme

Bir faturanin tek bir "durum" alani kullanici icin yeterli degildir. Liste ve
detay ekranlarinda en az uc bagimsiz durum gosterilmelidir:

| Eksen | Ornekler |
|---|---|
| Belge durumu | Taslak, kesinlesti, iptal edildi |
| e-Belge durumu | Gonderilmedi, kuyrukta, iletildi, kabul, ret, hata |
| Odeme durumu | Odenmedi, kismi odendi, odendi, vadesi gecti |

Bu durumlar tek etikette birlestirilmemelidir. Kullanici "kesinlesmis ama henuz
gonderilmemis ve kismi odenmis" bir faturayi tek bakista anlayabilmelidir.

### 4.2 Onerilen liste kolonlari

| Belge | Cari | Tarih/Vade | Tutar | Belge durumu | e-Belge | Odeme |
|---|---|---|---:|---|---|---|
| SF2026000123 | ABC Ltd. | 06.08 / 05.09 | 12.450 TL | Kesinlesti | Kabul | Kismi |

Listelerde su yetenekler standart hale getirilmelidir:

- Hizli arama
- Tarih ve vade araligi
- Durum filtreleri
- Kaydedilmis gorunumler
- Kolon secimi ve siralama
- Toplu eylemler
- Excel disa aktarma
- Sayfalama
- Aciklayici bos, yukleniyor ve hata durumlari

### 4.3 Hazir is gorunumleri

**Satis icin:**

- Taslaklar
- Gonderilecek faturalar
- e-Belge hatalari
- Vadesi gecenler
- Kismi odenenler
- Bugun kesilenler

**Satin alma icin:**

- Gelen e-Belgeler
- Eslesme bekleyenler
- Onay bekleyenler
- Odeme bekleyenler
- Vadesi gecen borclar

Bu gorunumler yalniz filtre kolayligi degil, kullaniciya hazir bir is kuyrugu
saglar.

### 4.4 Belge zinciri

Belge detayinda asagidaki surec bir zaman cizgisi olarak gosterilmelidir:

`Teklif -> Siparis -> Irsaliye -> Fatura -> e-Fatura -> Tahsilat/Odeme`

Her adim tiklanabilir olmali; mevcut kayit gorulebilmeli veya eksik adimdan yeni
belge olusturulabilmelidir. Donusumlerde kalemlerin, carinin ve referanslarin
aktarildigi acikca belirtilmelidir.

---

## 5. Fatura Olusturma Deneyimi

### 5.1 Onerilen islem sirasi

1. Musteri veya tedarikci secimi
2. Fatura tarihi, seri ve vade
3. Urun/hizmet kalemleri
4. Iskonto, vergi ve toplamlar
5. Odeme ve teslimat bilgileri
6. Kontrol ve kesinlestirme

Formun gorsel sirasi da bu zihinsel modeli izlemelidir. Nadir kullanilan alanlar
"Vergi ve diger bilgiler" bolumunde kosullu acilmalidir.

### 5.2 Komutlar

Temel eylemler acikca ayrilmalidir:

- **Taslak Kaydet**
- **Kontrol Et**
- **Kesinlestir**
- Kesinlesme sonrasinda **e-Belge Gonder**

Geri donusu zor sonuclari olan "Kaydet ve gonder" benzeri birlesik komutlar
varsayilan ana eylem olmamalidir.

### 5.3 Kontrol asamasi

Kesinlestirme oncesinde kullaniciya kisa bir ozet verilmelidir:

- Cari ve vergi kimligi
- Fatura tipi ve senaryosu
- Matrah, vergi ve genel toplam
- Stok etkisi
- Cari bakiye/risk etkisi
- e-Fatura veya e-Arsiv secimi
- Eksik ya da supheli alanlar

---

## 6. Cari Hesap Secimi ve Hizli Olusturma

### 6.1 Cari secici

Cari secimi standart bir select olmamalidir. Tek bir aranabilir combobox icinde
asagidaki alanlarla arama yapilabilmelidir:

- Unvan
- Cari kodu
- VKN/TCKN
- Telefon
- E-posta
- Vergi dairesi

Ornek sonuc:

```text
ABC MAKINA LTD.                                      Musteri
CR-00124 | 1234567890 | Istanbul
Bakiye: 84.200 TL borc | Risk kullanimi: %62
```

Arama; Turkce karakter, buyuk/kucuk harf ve bosluk farklarina toleransli
olmalidir. Son kullanilan ve sik kullanilan cariler bos arama durumunda
gosterilebilir.

### 6.2 Cari secildikten sonra

Fatura formunda kompakt bir cari ozeti gosterilmelidir:

- Guncel bakiye
- Risk limiti ve kullanilabilir limit
- Gecikmis borc
- Varsayilan vade
- Fiyat listesi
- Varsayilan iskonto
- e-Fatura mukellefligi
- Son satis/alis tarihi

Risk asimi veya gecikmis borc kritik seviyedeyse uyari, kullanicinin karar
verdigi noktada gorunmelidir; kesinlestirme sonrasina birakilmamalidir.

### 6.3 Hizli cari olusturma

Cari bulunamazsa kullanici fatura formundan ayrilmadan **Yeni cari olustur**
eylemini kullanabilmelidir. Hizli form yalniz su alanlari istemelidir:

- Unvan/ad soyad
- Musteri/tedarikci tipi
- VKN/TCKN
- Telefon veya e-posta

Yeni cari kaydedildiginde otomatik olarak secilmeli; adres, banka ve kisi
ayrintilari daha sonra tamamlanabilmelidir.

---

## 7. Fatura Kalemleri ve Urun Secimi

### 7.1 Urun arama

Urun secici asagidaki alanlari birlikte aramalidir:

- Urun kodu
- Barkod
- Urun adi
- Tedarikci urun kodu
- Kategori

Ornek sonuc:

```text
PRD-0042  A4 Fotokopi Kagidi 80 gr
Stok: 124 paket | Satis: 185,00 TL | KDV: %20
```

### 7.2 Otomatik doldurma

Urun secildiginde su alanlar mevcut kurallardan otomatik getirilmelidir:

- Birim
- Cari fiyat listesine gore birim fiyat
- Cari varsayilan iskontosu
- KDV orani
- Depo ve mevcut stok
- Doviz cinsi

Otomatik deger degistirildiginde bunun kullanici tarafindan ezildigi belli
olmali; gerekli yetki ve maksimum iskonto sinirlari aninda kontrol edilmelidir.

### 7.3 Klavye ve barkod akisi

Yogun veri girisi icin hedef akis:

1. Urun alaninda yazmaya basla veya barkod okut
2. `Enter` ile urunu sec
3. Miktari gir
4. `Tab` ile fiyat ve iskontoya ilerle
5. Son alanda `Enter` ile yeni satir ac

Ek beklentiler:

- Barkod tekrar okutulursa ayara gore miktar artirmali veya yeni satir acmali
- Satir ekleme/silme sayfanin boyutunu beklenmedik bicimde oynatmamalidir
- Toplamlar giris sirasinda anlik hesaplanmalidir
- Stok yetersizligi satir seviyesinde gosterilmelidir
- Kalem kopyalama ve satirlar arasi klavye gezintisi desteklenmelidir

### 7.4 Seyrek kullanilan satir alanlari

Istisna kodu, tevkifat, depo, aciklama ve ozel muhasebe alanlari ana tabloyu
yatay olarak genisletmemelidir. Satirin acilabilir ayrinti bolumunde
gosterilmelidir.

Mobilde masaustu tablosu kucultulmemeli; her kalem kompakt, duzenlenebilir bir
satir/blok olarak sunulmalidir.

---

## 8. Ana Sayfa ve Rol Bazli Benimsenme

Ana sayfa yalniz finansal ozet kartlarindan olusmamalidir. Kullanicinin bugun
tamamlamasi gereken isleri gostermelidir:

- Gonderilmemis faturalar
- Hatali e-Belgeler
- Onay bekleyen alis faturalari
- Vadesi gelen tahsilatlar
- Vadesi gelen odemeler
- Kritik stoklar
- Eslestirilmemis banka hareketleri

### Rol bazli icerik

| Rol | Varsayilan odak |
|---|---|
| Satis | Gunluk satis, teklif/siparisler, musteri riski ve tahsilatlar |
| Muhasebe | e-Belge, alis faturasi, odeme, banka eslestirme ve vergi |
| Yonetici | Nakit akisi, karlilik, geciken alacaklar ve kritik uyarilar |
| Salt okunur | Ozetler, listeler ve raporlar; mutasyon komutlari gizli |

Kullanici ana sayfadaki bir sayidan ilgili filtrelenmis listeye tek tikla
gidebilmelidir.

---

## 9. Bildirim, Hata ve Guven Davranislari

### 9.1 Hata mesajlari

Hata mesaji yalniz teknik nedeni degil, duzeltme yolunu da belirtmelidir.

Zayif:

> Islem basarisiz.

Onerilen:

> Fatura gonderilemedi: cari vergi kimlik numarasi eksik. Cari kartini
> duzenleyip yeniden deneyin.

### 9.2 Uzun sureli islemler

e-Belge gonderimi, Excel aktarimi ve PDF olusturma gibi islemlerde:

- Islem baslatildigi hemen bildirilmelidir
- Kullanici sayfadan ayrilabilmelidir
- Durum daha sonra bildirim merkezinden izlenebilmelidir
- Basarisiz islemde **Duzelt ve yeniden dene** eylemi sunulmalidir

### 9.3 Kaydedilmemis degisiklik

Uzun formlardan ayrilirken kaydedilmemis degisiklik uyarisi verilmeli; otomatik
taslak kaydi dusunulmelidir. Ancak otomatik kaydin kesinlestirme anlamina
gelmedigi net olmalidir.

---

## 10. Erisilebilirlik ve Cihaz Uyumu

- Tum islemler klavyeyle tamamlanabilmelidir
- Odak gostergeleri belirgin olmalidir
- Durumlar yalniz renkle anlatilmamalidir
- Form alanlarinda kalici etiket bulunmalidir
- Hata, ilgili alanin yaninda ve ekran okuyucuya uygun verilmelidir
- Para ve tarih degerleri tutarli Turkce bicimde gosterilmelidir
- Dokunmatik hedefler mobilde yeterli boyutta olmalidir
- Fatura kalemleri, filtreler ve komut cubuklari dar ekranda birbirini
  ortmemelidir

---

## 11. Uygulama Yol Haritasi

### Paket 1 - Bilgi mimarisi ve listeler

**Hedef:** Kullaniciya satis ve satin alma baglamlarini ayirmak.

- Ana menuyu Satis ve Satin Alma olarak yeniden duzenle
- Mevcut fatura/belge ekranlarini baglama gore filtrelenmis giris noktalarina ayir
- Belge, e-belge ve odeme durumlarini ayri kolonlarda goster
- Hazir is gorunumlerini ekle
- Tum Belgeler ekranini ileri arama icin koru

### Paket 2 - Cari ve urun seciciler

**Hedef:** Kayit bulma suresini ve yanlis secimi azaltmak.

- Ortak cari combobox bileseni
- Ortak urun/barkod combobox bileseni
- Son ve sik kullanilan kayitlar
- Cari seciminde bakiye/risk ozeti
- Formdan ayrilmadan hizli cari ve urun olusturma

### Paket 3 - Fatura kalem girisi

**Hedef:** Yogun fatura girisini hizlandirmak.

- Klavye ile kesintisiz satir girisi
- Barkod destegi
- Otomatik fiyat, iskonto ve vergi onerileri
- Satir ayrinti bolumu
- Anlik toplam ve stok/risk uyarilari
- Mobil kalem duzenleme deneyimi

### Paket 4 - Belge yasam dongusu

**Hedef:** Kaydin nereden gelip nereye gittigini gorunur kilmak.

- Belge zinciri zaman cizgisi
- Belgeden belgeye donusum komutlari
- Kesinlestirme etki ozeti
- e-Belge ve odeme durumu gecmisi
- Duzelt ve yeniden dene akislari

### Paket 5 - Rol bazli ana sayfa ve benimsenme

**Hedef:** Uygulamayi gunluk calisma merkezi haline getirmek.

- Rol bazli yapilacaklar
- Kritik uyari ve is kuyruklari
- Bildirim merkezi
- Kaydedilmis gorunumler
- Kullanim metrikleri ve geri bildirim dongusu

### 11.1 Uygulama durumu - 6 Agustos 2026

| Paket | Durum | Tamamlananlar | Siradaki is |
|---|---|---|---|
| Paket 1 | Tamamlandi | Satis/satin alma calisma alanlari, baglama gore filtrelenen fatura ve belge girisleri, Tum Belgeler ve Tum Faturalar erisimi, belge/odeme durum eksenleri ve fatura, belge ve cari listelerinde kullaniciya ait kaydedilmis gorunumler | Kullanici testi ve metrik takibi |
| Paket 2 | Tamamlandi | Ortak aranabilir cari ve urun secici, kod/VKN/barkod aramasi, son/sik kullanilan siralamasi, cari bakiye/risk ozeti, fatura icinden hizli cari ve urun olusturma | Kullanici testi ve metrik takibi |
| Paket 3 | Tamamlandi | Kompakt masaustu tablosu ve mobil kalem bloklari, otomatik fiyat/vergi altyapisi, anlik toplamlar, Enter ile yeni satir, odak aktarimi, satir kopyalama, satir ayrintisi, barkod tekrar okutma ve stok yeterlilik uyarisi | Kullanici testi ve metrik takibi |
| Paket 4 | Tamamlandi | Tiklanabilir belge zinciri, donusum komutlari, onay/kesinlestirme etki ozetleri, e-Belge durum ayrintisi ve hatali gonderimi yeniden deneme, odeme ozeti ve hareket gecmisi, faturadan baglamli tahsilat/odeme eslestirmesi | Kullanici testi ve metrik takibi |
| Paket 5 | Buyuk olcude tamamlandi | Rol bazli hizli islemler ve gercek sayili is kuyruklari, filtreli liste gecisleri, role gore finansal gorunurluk, bildirim merkezi, fatura, belge ve cari listelerinde kaydedilmis gorunumler, fatura tamamlama/hata/terk ve gorunum benimsenme olaylari ile firma kapsamli 30 gunluk yonetici metrik ekrani ve rol bazli benimsenme kirilimi | Kullanici geri bildirimi |

Tamamlanan UI calismalari `2f7641c` ve `bfc93ad` commitlerinde izlenebilir.
Bu durum tablosu her uygulama paketinden sonra guncellenmelidir.

---

## 12. Basari Metrikleri

Degisikliklerin kullanici tatmini ve benimsenmeye etkisi olculmelidir.

| Metrik | Olcum amaci | Ilk hedef |
|---|---|---:|
| Ilk faturayi tamamlama suresi | Ogrenilebilirlik | Medyan 5 dakikanin alti |
| Tekrar eden fatura giris suresi | Operasyon hizi | Medyan 2 dakikanin alti |
| Cari/urun arama suresi | Bulunabilirlik | Medyan 5 saniyenin alti |
| Form terk orani | Karmasiklik | %15'in alti |
| Dogrulama hatasi / fatura | Veri kalitesi | Surumden surume azalis |
| e-Belge hata cozum suresi | Kurtarilabilirlik | Medyan 10 dakikanin alti |
| Haftalik aktif firma orani | Benimsenme | Kohort bazinda artan egilim |
| Kaydedilmis gorunum kullanimi | Is akisi benimsenmesi | Aktif kullanicilarin %30'u+ |

Olcumler rol, firma buyuklugu ve yeni/deneyimli kullanici kiriliminda
incelenmelidir. Yalniz sayfa goruntuleme degil, gorev tamamlama ve hata
duzeltme olaylari izlenmelidir.

---

## 13. Kullanici Testi Senaryolari

UI paketleri tamamlanmadan once ve sonra ayni senaryolarla kullanilabilirlik
testi yapilmalidir:

1. Yeni bir musteri olusturup uc kalemli satis faturasi kesme
2. Barkodla hizli satis faturasi girme
3. Gelen e-Faturayi kontrol edip alis faturasina donusturme
4. Vadesi gecen faturayi bulup tahsilat kaydetme
5. Tedarikciye odeme yapma ve ilgili faturayla eslestirme
6. Hatali e-Belgeyi bulup nedeni duzeltme ve yeniden gonderme
7. Banka ekstresindeki hareketi cari ve faturayla eslestirme
8. Bir faturanin teklif/siparis/irsaliye zincirini bulma

Her senaryoda sure, tiklama/klavye adimi, hata, yardim ihtiyaci ve kullanicinin
algiladigi zorluk kaydedilmelidir.

---

## 14. Kabul Olcutleri

Bu rapor kapsamindaki UI yenilemesi asagidaki kosullar saglandiginda amacina
ulasmis kabul edilebilir:

- Kullanici ana menuden satis ve satin alma islemlerini ayirt edebiliyor
- Satis faturasi ve alis faturasi yanlis belge tipi secmeden baslatilabiliyor
- Cari; unvan, kod, VKN/TCKN veya telefonla ayni alandan bulunabiliyor
- Urun; kod, ad, barkod veya tedarikci koduyla ayni alandan bulunabiliyor
- Fatura kalemleri yalniz klavye kullanilarak kesintisiz girilebiliyor
- Belge, e-belge ve odeme durumlari birbirinden bagimsiz gorulebiliyor
- Kesinlestirme oncesinde stok, cari ve vergi etkisi acikca gosteriliyor
- Hata mesajlari kullaniciya duzeltme eylemi sunuyor
- Ana sayfa role uygun bekleyen isleri listeliyor
- Temel satis ve satin alma senaryolari mobil ve masaustunde cakisma olmadan
  tamamlanabiliyor
- Yukaridaki kullanici testi senaryolarinda kritik kullanilabilirlik engeli
  kalmiyor

---

## 15. UI Alanlarinin Optimum Yerlesimi

### 15.1 Yerlesim hedefi

Optimum yerlesim yalniz gorsel sadelik anlamina gelmez. Yerlesim kararlari
gozun ve imlecin katettigi mesafeyi, karar verme suresini ve hata ihtimalini
azaltmalidir. Iliskili alanlar birlikte, farkli amacli alanlar ayri
gosterilmeli; kullanicinin karar sirasi yukaridan asagiya ve soldan saga
izlenmelidir.

TekirExtra operasyonel bir uygulamadir. Sayfa bolumleri dekoratif kart
koleksiyonlari olarak degil; hizali, kompakt ve taranabilir calisma alanlari
olarak tasarlanmalidir. Sik kullanilan alanlar ilk gorunumde tutulmali, seyrek
kullanilan teknik ayrintilar gerektiginde acilmalidir.

### 15.2 Standart sayfa iskeleti

Liste ve yonetim ekranlari ortak bir iskelet izlemelidir:

```text
┌──────────────────────────────────────────────────────────────┐
│ Sayfa basligi / baglam              Ikincil     Ana eylem    │
├──────────────────────────────────────────────────────────────┤
│ Hazir gorunumler / sekmeler                                  │
├──────────────────────────────────────────────────────────────┤
│ Arama │ Tarih │ Durum │ Filtreler │ Gorunum secenekleri      │
├──────────────────────────────────────────────────────────────┤
│ Liste, form veya ana calisma alani                           │
├──────────────────────────────────────────────────────────────┤
│ Secim ozeti / toplamlar / sayfalama                          │
└──────────────────────────────────────────────────────────────┘
```

Standart davranislar:

- Sayfa basligi solda, birincil eylem sagda bulunmalidir.
- Bir ekranda yalniz bir eylem gorsel olarak baskin olmalidir.
- Ikincil eylemler hayalet dugme veya menu olarak sunulmalidir.
- Filtreler baslik satirina sikistirilmamali, ayri arac cubugunda olmalidir.
- Sik kullanilan filtreler gorunur, ileri filtreler acilir panelde olmalidir.
- Ayni komut farkli ekranlarda ayni konumu ve simgeyi kullanmalidir.
- Yukleme sirasinda ana bloklarin boyutu korunarak yerlesim kaymasi
  engellenmelidir.

### 15.3 Olcu ve bosluk sistemi

Asagidaki degerler tasarim sisteminde token olarak tanimlanabilir:

| Oge | Onerilen olcu |
|---|---:|
| Masaustu sayfa yatay boslugu | 24 px |
| Tablet sayfa yatay boslugu | 16 px |
| Mobil sayfa yatay boslugu | 12-16 px |
| Ana bolumler arasi bosluk | 24 px |
| Form alan gruplari arasi bosluk | 16 px |
| Iliskili alanlar arasi bosluk | 8 px |
| Standart form alani yuksekligi | 36-40 px |
| Birincil dugme yuksekligi | 40 px |
| Standart tablo satiri | 44 px |
| Yogun tablo satiri | 36 px |
| Ikon dugmesi | 36-40 px kare |
| Sag ayrinti paneli | 360-420 px |
| Form icerik ust siniri | 1100-1280 px |
| Sayisal alan genisligi | 120-160 px |
| Tarih alani genisligi | 150-180 px |
| Para birimi secimi | 90-110 px |

Kart kullanimi gerekiyorsa koseler en fazla 8 px olmali; sayfa bolumleri kart
gibi havada durmamalidir. Tekrarlanan kayitlar, ozet kutulari ve modallar kart
sinirina sahip olabilir. Kart icinde ikinci bir kart kullanilmamalidir.

### 15.4 Form grid sistemi

Formlar serbest genislikli alan yigini yerine on iki kolonlu veya anlamsal
grid sablonlari kullanmalidir:

- Uzun ad, unvan ve aciklama: 12 kolon
- Cari veya urun secici: 6-8 kolon
- Tarih ve vade: 2-3'er kolon
- Kod, seri ve numara: 2-3 kolon
- Sayisal degerler: 2-3 kolon
- Adres satiri: 12 kolon
- Il, ilce ve posta kodu: 4/4/4 kolon

Alan etiketi her zaman alanin ustunde bulunmali; placeholder etiket yerine
kullanilmamalidir. Hata mesaji ilgili alanin hemen altinda gorunmeli ve komsu
alanlarla cakismamalidir. DOM sirasi, gorsel sira ve klavye sirasiyla ayni
olmalidir.

### 15.5 Liste ekranlarinin yerlesimi

Liste ekraninda dikey alanin buyuk bolumu veri tablosuna ayrilmalidir:

1. Baslik ve yeni kayit eylemi
2. Hazir gorunum sekmeleri
3. Arama ve filtre cubugu
4. Aktif filtre ozeti
5. Veri tablosu
6. Toplamlar ve sayfalama

```text
Satis Faturalari                                [+ Yeni Fatura]

[Tumu] [Taslak 4] [Gonderilecek 3] [Hatali 1] [Vadesi Gecen 8]

[Belge, cari veya VKN ara..............] [Tarih] [Durum] [Filtreler]
Aktif filtreler: Bu ay ×  |  Odenmedi ×

Belge No    Cari              Tarih      Tutar       e-Belge    Odeme
SF000123    ABC Makina        06.08      12.450 TL   Kabul       Kismi
```

Kolon kurallari:

- Arama alani arac cubugunun en genis kontrolu olmalidir.
- Para ve miktar degerleri saga hizalanmalidir.
- Tarih, durum ve eylem kolonlari sabit genislikte olmalidir.
- Cari unvani ve aciklama kalan genisligi kullanmalidir.
- Ilk tanimlayici kolon yatay kaydirmada sabit kalabilmelidir.
- Satir eylemleri en sagda uc nokta menusunde toplanmalidir.
- Toplu islem cubugu yalniz satir secildiginde acilmalidir.
- Yatay kaydirma son care olmali, dusuk oncelikli kolonlar gizlenebilmelidir.
- Kolon ve filtre gorunumleri kullanici bazinda kaydedilebilmelidir.

### 15.6 Fatura ekraninin ana yerlesimi

Fatura olusturma ekrani uc ana bolgeye ayrilmalidir:

```text
┌──────────────────────────────────────────────────────────────┐
│ Cari ve belge baslik bilgileri                               │
├──────────────────────────────────────────────────────────────┤
│ Fatura kalemleri                                             │
│                                                              │
├──────────────────────────────────────────┬───────────────────┤
│ Notlar, odeme ve vergi bilgileri         │ Toplam ozeti      │
└──────────────────────────────────────────┴───────────────────┘
│ [Vazgec] [Taslak Kaydet]          [Kontrol Et] [Kesinlestir]│
└──────────────────────────────────────────────────────────────┘
```

#### Baslik bolumu

Birinci satirda cari secici toplam genisligin yaklasik %50-60'ini kullanmali;
fatura tarihi, vade tarihi ve seri/numara ayni satirin kalaninda bulunmalidir.
Ikinci satir fatura tipi, senaryo, para birimi, doviz kuru ve depo alanlarini
icermelidir.

Cari secildikten sonra buyuk bir kart yerine secicinin altinda kompakt baglam
satiri gosterilmelidir:

```text
Bakiye: 84.200 TL borc · Risk: %62 · Vade: 30 gun · e-Fatura mukellefi
```

Gecikmis borc veya risk asimi varsa bu satir uyariya donusmeli ve sorun cari
secildigi anda gosterilmelidir.

#### Kalem tablosu

| Kolon | Onerilen genislik |
|---|---:|
| Urun/hizmet | Esnek, kalan alan |
| Miktar | 100 px |
| Birim | 90 px |
| Birim fiyat | 130 px |
| Iskonto | 100 px |
| KDV | 80 px |
| Tutar | 140 px |
| Satir eylemi | 40 px |

Tevkifat, istisna kodu, depo, aciklama ve ozel muhasebe alanlari yeni kolonlar
olarak tabloyu genisletmemeli; satirin acilabilir ayrinti bolumunde
gosterilmelidir.

Yeni satir komutu tablonun hemen altinda bulunmali, son alanda `Enter` tusuna
basmak ayni davranisi tetiklemelidir. Kalem secimi, miktar ve fiyat arasindaki
klavye sirasi gorsel sirayla ayni olmalidir.

#### Toplam alani

```text
Ara toplam                    10.000,00 TL
Satir iskontolari               -500,00 TL
Genel iskonto                   -250,00 TL
KDV                            1.850,00 TL
Tevkifat                        -370,00 TL
──────────────────────────────────────────
Odenecek                      10.730,00 TL
```

Toplamlar ekranin sag altinda, etiketler solda ve sayilar saga hizali
gosterilmelidir. Panel yalniz yeterli ekran yuksekliginde sabit kalmali, kucuk
dizustu veya mobil ekranda kalemlerin uzerini kapatmamalidir.

#### Sabit eylem cubugu

```text
Son taslak kaydi: 14:32        [Vazgec] [Taslak Kaydet] [Kesinlestir]
```

Cubuk icerigi kapatmamalidir. Dogrulama hatasinda kullanici ilk hatali alana
goturulmeli ve kisa hata ozeti cubukta gosterilmelidir.

### 15.7 Cari hesap ekranlari

Cari olusturma ve duzenleme formu asagidaki sekmelere ayrilabilir:

```text
[Genel Bilgiler] [Adresler] [Kisiler] [Banka] [Finansal Ayarlar]
```

Genel bilgiler yerlesimi:

```text
Cari tipi           Cari kodu
Unvan / Ad soyad                                  (tam genislik)
VKN/TCKN            Vergi dairesi
Telefon             E-posta
Fiyat listesi       Varsayilan vade
Risk limiti         Varsayilan iskonto
```

Adres, kisi ve banka hesabi tekrarlanan alt kayitlardir. Ana formda suresiz
acik tutulmamali; kendi sekmelerinde tablo ve ekleme paneli olarak
sunulmalidir.

Cari detay ekrani duzenleme formunun salt-okunur kopyasi olmamalidir:

- Ustte kimlik, bakiye, risk ve gecikmis alacak ozeti
- Ana alanda cari hareketleri ve faturalar
- Sag ozet panelinde iletisim, vade ve fiyat listesi
- Alt sekmelerde adres, kisi, banka hesabi ve ekler
- Ust eylemlerde tahsilat, odeme, fatura ve duzenleme

Cari detayindan baslatilan islem cari baglamini otomatik tasimali; kullanicidan
cariyi yeniden secmesi istenmemelidir.

### 15.8 Stok karti ekranlari

Stok kartinda Genel, Fiyat ve Vergi, Stok Durumu, Birimler ve Barkodlar,
Tedarikciler, Hareketler ve Ekler sekmeleri kullanilabilir.

```text
Urun kodu          Barkod
Urun adi                                         (tam genislik)
Kategori           Urun/Hizmet
Birim              KDV
Alis fiyati        Satis fiyati

Mevcut: 124       Rezerve: 18       Kullanilabilir: 106
```

Stok ozeti kimlik alanlarinin arasinda kaybolmamalidir. Coklu depo durumunda
toplam degerin altinda depo dagilimi acilabilmelidir. Hareketler ayri sekmede
tarih, depo ve hareket tipi filtreleriyle sunulmalidir.

### 15.9 Kasa ve banka yerlesimi

```text
[Merkez Kasa · 24.500 TL] [Is Bankasi · 184.200 TL] [+ Hesap]

[Tahsilat] [Odeme] [Virman]

Tarih       Islem       Cari       Aciklama       Giris       Cikis
```

Tahsilat, odeme ve virman tek genel formdaki islem tipi secenegi olmamali; her
biri kisa ve amaca yonelik form acmalidir.

Virman formunda iliski acik gosterilmelidir:

```text
Kaynak hesap          →          Hedef hesap
Tutar                            Islem tarihi
Aciklama
```

Para birimi uyusmazligi veya yetersiz bakiye kaynak alaninin yaninda
gosterilmelidir.

### 15.10 Banka ekstresi eslestirme alani

Genis masaustunde uc bolmeli calisma alani kullanilabilir:

```text
┌───────────────────┬────────────────────────┬───────────────────┐
│ Ekstre satirlari  │ Secilen hareket        │ Eslesme onerileri │
│                   │ ayrintisi              │                   │
└───────────────────┴────────────────────────┴───────────────────┘
```

Kullanici ayni anda banka aciklamasi ve tutari, onerilen cari, onerilen acik
faturalar, eslesme gerekcesi ve olusacak tahsilat/odeme kaydini gorebilmelidir.
Dar ekranda uc kolon zorlanmamali; ayrinti ve oneriler sag panelde veya tam
ekran alt adimda acilmalidir.

### 15.11 Modal, yan panel ve ayri sayfa karari

| Islem | Onerilen yuzey |
|---|---|
| Basit onay | Modal |
| Hizli cari veya urun olusturma | Sag panel |
| Kisa tahsilat veya odeme formu | Sag panel veya modal |
| Filtreler | Arac cubugu acilimi veya sag panel |
| Satir vergi ayrintisi | Acilir tablo satiri |
| Fatura olusturma | Ayri sayfa |
| Cari/stok ayrintili duzenleme | Ayri sayfa |
| Belge ayrintisi | Ayri sayfa veya genis sag panel |

Uzun, sekmeli veya cok adimli formlar modal icinde acilmamalidir. Modal icinde
modal kullanilmamali; alt islem mevcut yuzey icinde yeni adima donusmelidir.

### 15.12 Responsive davranis

Masaustu yerlesimini mobilde yalniz kucultmek yeterli degildir:

- Iki kolonlu formlar tek kolona inmelidir.
- Tablo satirlari oncelikli alanlari gosteren ozet liste ogelerine donusmelidir.
- Filtreler tam ekran veya alt panelde acilmalidir.
- Kritik ana eylem ekran altinda erisilebilir kalmalidir.
- Sag paneller mobilde tam ekran olmalidir.
- Fatura kaleminde once urun, miktar ve tutar gosterilmelidir.
- Vergi ve satir ayrintilari acilir bolumde bulunmalidir.
- Sidebar acilir menu veya sinirli alt navigasyona donusmelidir.

| Genislik | Davranis |
|---|---|
| 1280 px ve uzeri | Tam tablo, opsiyonel sag ozet paneli |
| 1024-1279 px | Dusuk oncelikli kolonlar gizli, iki kolonlu form |
| 768-1023 px | Filtre paneli, daraltilmis tablo veya liste |
| 767 px ve alti | Tek kolon, tam ekran paneller, mobil kalem listesi |

Kirilimlar cihaz adina gore degil, icerigin gercekte sigdigi noktaya gore
uygulanmalidir.

### 15.13 Klavye ergonomisi

- DOM, gorsel ve `Tab` sirasi ayni olmalidir.
- Fatura kalemlerinde `Enter`, `Tab`, `Shift+Tab` ve ok tuslari tutarli
  davranmalidir.
- Enter tusu uzun formu yanlislikla kesinlestirmemelidir.
- Barkod okutma ve yeni satira gecme fare gerektirmemelidir.
- Panel acildiginda odak iceri alinmali, kapaninca tetikleyiciye donmelidir.
- Ikon dugmelerinde tooltip ve erisilebilir ad bulunmalidir.

### 15.14 Yerlesim dogrulama yontemi

Uygulama su gorunumlerde test edilmelidir:

- 1440 × 900 standart masaustu
- 1280 × 720 kisa dizustu
- 1024 × 768 tablet/yatay dar ekran
- 390 × 844 yaygin mobil
- 360 × 800 dar mobil

Her gorunumde su sorular yanitlanmalidir:

- Metin ve kontroller tasiyor mu?
- Sabit cubuklar icerigi kapatiyor mu?
- Modal ve paneller ekrana sigiyor mu?
- En uzun unvan, belge numarasi ve para degeri yerlesimi bozuyor mu?
- Hata mesajlari alanlari ust uste bindiriyor mu?
- Yukleme ve bos durumlarda boyut kaymasi oluyor mu?
- Klavye odagi gorunur ve mantikli sirada mi?

Playwright ekran goruntuleriyle temel fatura, cari, stok, kasa/banka ve ekstre
senaryolari icin gorsel regresyon kontrolleri CI surecine eklenmelidir.

### 15.15 Yerlesim uygulama onceligi

1. Ortak sayfa basligi, filtre cubugu ve tablo sablonu
2. Fatura formunun cari basligi, kalem tablosu ve toplam ozeti olarak ayrilmasi
3. Cari ve urun secicilerin ortak bilesenlere donusturulmesi
4. Cari ve stok formlarinin anlamsal sekmelere ayrilmasi
5. Tahsilat, odeme ve virmanin kisa gorev formlarina donusturulmesi
6. Banka eslestirme ekraninin cok bolmeli calisma alani olarak duzenlenmesi
7. Masaustu, kisa dizustu ve mobil davranislarinin ayri uygulanmasi
8. Gercek kullanicilarla gorev suresi ve hata olcumu yapilarak alan siralarinin
   dogrulanmasi

---

## 16. Sonuc

TekirExtra'nin teknik kapsami kullaniciya deger sunmak icin yeterince genistir.
Bir sonraki buyuk kazanc yeni moduller eklemekten cok, mevcut yetenekleri
kullanicinin gunluk is modeline gore yeniden duzenlemekten gelecektir.

En kritik urun kararlari sunlardir:

1. Satis ve satin alma arayuzde ayri calisma alanlari olmalidir.
2. Ortak belge/fatura motoru backend'de korunmalidir.
3. Cari ve urun secimi hizli, baglamli ve formdan ayrilmayi gerektirmeyen bir
   deneyime donusturulmelidir.
4. Fatura kalem girisi klavye ve barkod merkezli tasarlanmalidir.
5. Liste ekranlari pasif arsivler degil, hazir is kuyruklari olarak calismalidir.
6. Ana sayfa finansal ozetin yaninda role gore siradaki isi gostermelidir.

Bu siralama, kullanici egitim ihtiyacini ve islem hatalarini azaltirken gunluk
kullanim sikligini ve urune duyulan guveni artirmaya yonelik en yuksek etkili
yolu sunar.
