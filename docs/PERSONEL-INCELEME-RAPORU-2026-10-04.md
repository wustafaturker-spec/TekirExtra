# Personel ve İK Modülü İnceleme Raporu

**Tarih:** 4 Ekim 2026
**İnceleme türü:** Kod okuma + yerel API'de canlı deneme (deneme personeli `PRS-000001 Deneme İnceleme`,
Eylül 2026 bordrosu onaylı; para hareketi yaratan avans/ödeme akışı canlıda denenmedi). Kod değişikliği yapılmadı.
**Kapsam:** Personel kartı ve yaşam döngüsü, hassas veri şifreleme, organizasyon, puantaj (dönem çalışması),
bordro tahakkuk/onay/ödeme, mevzuat parametreleri ve brütten nete hesap, avans, izin, özlük belgeleri,
İK raporları, banka maaş dosyası; bordronun tahakkuk raporu, nakit akışı ve muhasebe aktarımıyla ilişkisi.
**Dosyalar:** `apps/api/src/personel/*`, `apps/api/src/rapor/tahakkuk.ts`, `apps/api/src/nakit-akisi/nakit-akisi.service.ts`,
`apps/api/src/mali-musavir/muhasebe/fis-okuyucu.ts`, `apps/web/src/app/panel/personel/**`, `apps/web/src/components/personel-belgeleri.tsx`
**Referans:** `docs/INSAN-KAYNAKLARI-GELISTIRME-PLANI.md` (20 Ağustos 2026 uygulama durumu)

## 1. Özet

Modülün iskeleti geniş ve doğru kurulmuş: TCKN/IBAN alan şifrelemesi ve görüntüleme denetim izi, RLS,
atomik personel numarası, istihdam dönemleri, işyeri–departman–pozisyon–yönetici ağacı, bordroda
hazırlayan ≠ onaylayan, kısmi/çoklu ödeme ve ters kayıtla iptal, avans talep–onay–ödeme–mahsup, izin
bakiyesi hareket defteri, özlük belgeleri. Brütten nete hesap motoru (`bordro-hesaplama.ts`) da yapı
olarak mevzuata uygun: kümülatif gelir vergisi, asgari ücret GV/DV istisnası, SGK taban/tavan ve iki aylık
tavan devri, yemek istisnası, engellilik/şahıs sigortası/sendika indirimleri, teşvikli işveren maliyeti.

Ancak demo kiracıda modül hiç kullanılmamış (personel, bordro, mevzuat seti sıfır) ve günlük kullanımı
doğrudan durduran ya da para/bakiye yanlışı üreten sorunlar var:

1. **Banka maaş dosyasına şifreli TCKN ve IBAN yazılıyor.** Dosya bankaya yüklenemez (denendi).
2. **Bordrodan mahsup edilen avans, personel carisinde hiç kapanmıyor.** Tahakkuk net ödenecek (avans
   düşülmüş) tutarla yazıldığı için avans borcu cari bakiyede sonsuza dek açık kalır.
3. **İşten ayrılan personelin son ay maaşı tahakkuk edilemiyor.** Toplu tahakkuk yalnız "aktif" durumdaki
   personeli alıyor; ay içinde çıkışı yapılan kişi listeye girmiyor.
4. **Ay içinde işe girene tam ay ücret tahakkuk ediliyor.** 20 Eylül girişli personele Eylül için 30 gün,
   tam ücret yazıldı (denendi). Puantaja elle gün girilmezse giriş/çıkış günleri hesaba katılmıyor.
5. **Bordro iptal edilemiyor ve yeniden hesaplanamıyor.** Mevzuatla hesaplanan bordroya elle kalem
   eklenemiyor; reddedilen ya da girdisi yanlış bordro için hiçbir düzeltme yolu yok ("yeniden tahakkuk
   oluşturun" diyen hata mesajı var ama tekil kayıt kuralı yüzünden yeniden tahakkuk imkânsız).
6. **Personel kartı ekrandan düzenlenemiyor.** API'de `PUT /personel/:id` var, web'de hiçbir ekran
   çağırmıyor: maaş artışı, IBAN, TCKN, telefon değişikliği yapılamıyor.

Bunlara ek olarak bordronun finans tarafına yansıması eksik: tahakkuk carisine onay gününün tarihi yazılıyor
(Eylül bordrosu 04.10'a düştü, denendi); tahakkuk raporu ve nakit akışı personel giderini yalnız net ücret
olarak sayıyor, SGK ve vergi yükü hiçbir raporda görünmüyor; brüt hesap için her kiracının asgari ücreti,
SGK tavanını, oranları ve vergi dilimlerini kendisinin girmesi gerekiyor.

## Durum

| Madde | Durum |
|---|---|
| P0-1, P0-6 | ✅ 2026-10-04 — PRS-01 (banka dosyası: çözülmüş TCKN/IBAN, `onaylandi`+`kismen_odendi` ve kalan tutar, IBAN'sız personel varsa dosya üretilmez, UTF-8 BOM, `HASSAS_VERI_TOPLU_DISA_AKTAR` denetim kaydı, sahte banka biçimleri kaldırıldı; detayda düzenleme penceresi, bağlı cari eşitlenir, giriş tarihi açık istihdam dönemine yazılır, `personel_guncelle` denetim kaydında değişen alanlar ve ücretin eski/yeni değeri) |
| P0-3, P0-4 | ✅ 2026-10-04 — PRS-02 (karar: takvim günü, tam ay 30; çıkış günü dahil; askıda/uzun süreli izin tahakkuka girer, puantajla düşülür. Tahakkuk ve puantaj kapsamı dönemle kesişen istihdam dönemlerinden, yalnız taslak hariç; varsayılan prim günü istihdam günü; puantajda gün istihdam gününü aşamaz, eksik gün nedeni yalnız istihdam içi eksikte istenir. `tahakkuk-kapsami.ts`) |
| P0-5, P2-5 | ✅ 2026-10-04 — PRS-03 (karar: yeniden hesapta elle kalemler ve avans mahsupları korunur; onayı yalnız yönetici gerekçeyle geri alır; onaysız bordro gerekçeyle silinir. Hesaplanmış/onay bekleyen/reddedilmiş bordroda "Yeniden hesapla" (sistem kalemleri yeniden üretilir, yeniden hesaplayan hazırlayan olur), onaylı ve ödemesiz bordroda "Onayı geri al" (cari tahakkuku `bordro_tahakkuk_iptal` ters kaydıyla kapanır), onaysız bordroda "Sil" (avans mahsupları avansa döner); mevzuatlı bordroda kişinin sonraki ay bordrosu varken önceki ay düzeltilemez (kümülatif matrah zinciri). Toplu tahakkuk ve yeniden hesap ortak `bordroHesabi`. P2-5 prim hesabı `temel_brut_ucret`i de temel sayar. Tehlikeli eylem düğmesinin görünmeyen kırmızı zemini düzeltildi) |
| P0-2, P1-3, P1-10 | ✅ 2026-10-04 — PRS-04 (karar: cari tahakkuk mahsup öncesi net; cari bağlanınca eksik tahakkuklar dönem sonu tarihiyle yazılır. Onayda cariye `odenecek + avans mahsupları` alacak — avans borcu + maaş ödemesi tahakkuku kapatır (canlıda bakiye 0); avans kasa fişine `kaynakRef`; mahsup edilmemiş avans ödemesi ters kasa/cari kaydıyla geri alınır (`personel_avans_iptal`, avans yeniden onaylı); `POST /personel/:id/cari-bagla` yeni ya da mevcut cari bağlar, kapalı dönemde reddeder; detayda "Cari aç ve bağla", avans listesinde "Ödemeyi geri al") |

## 2. Öncelik sınıfları

| Sınıf | Anlamı |
|---|---|
| **P0** | Yanlış tutar, yanlış bakiye, kullanılamayan çıktı ya da akışı tamamen durduran eksik |
| **P1** | Günlük kullanımda hemen hissedilen eksik ya da yanlış davranış |
| **P2** | Verimlilik, raporlama, tutarlılık |
| **P3** | Stratejik / uzun vadeli |

## 3. P0 — Doğruluk ve çalışabilirlik

### P0-1 Banka maaş dosyasında şifreli TCKN ve IBAN
`personel.service.ts:688` `bankaMaasDosyasiOlustur`. Personel `tckn` ve `iban` alanları `hassasSifrele` ile
`enc:v1:…` biçiminde saklanıyor; dosya üretilirken `hassasCoz` çağrılmıyor.
**Denendi:** `GET /personel/bordrolar/banka-dosyasi?yil=2026&ay=9&format=garanti` →
`"Deneme İnceleme";"enc:v1:/E5WNr0WK…";30000.00;"2026/09 Maaş Ödemesi";"enc:v1:tcyP/44w…"`.
Ek kusurlar: yalnız `onaylandi` bordrolar alınıyor (`kismen_odendi` olanın kalanı dosyaya girmiyor), tutar
`kalanTutar` değil `odenecekTutar` (kısmen ödenmişte fazla ödeme), IBAN'sız personel `IBAN_TANIMSIZ`
satırıyla dosyaya giriyor, toplu hassas veri dökümü denetim izine yazılmıyor, "garanti/isbank/akbank"
seçenekleri gerçek banka biçimi değil aynı genel CSV.
**Öneri:** Çözülmüş değer + IBAN zorunluluğu (eksikse dosya üretmeden listele), `onaylandi|kismen_odendi`
ve `kalanTutar`, `HASSAS_VERI_TOPLU_DISA_AKTAR` audit kaydı. Banka biçimleri için KSB-07'deki ödeme paketi
profil altyapısı (Excel/CSV sütun profili, pain.001) yeniden kullanılabilir.

### P0-2 Bordrodan mahsup edilen avans cari bakiyede kapanmıyor
`personel.service.ts:680` (avans ödemesi: cari **borç** A), `:461` (mahsup: bordroya `avans_mahsup` kesintisi),
`:480` (`odenecek = kazanç − kesinti`), `:398` (onay: cari **alacak** = `odenecekTutar`).
Net N, avans A: cari = borç A + borç (N−A) (ödeme) − alacak (N−A) (tahakkuk) = **borç A açık kalır**.
Avans kasadan çıkmış, bordrodan kesilmiş, ama personel carisi "bize A borçlu" göstermeye devam eder;
ekstre ve risk/yaşlandırma yanlış.
**Öneri:** Tahakkuk carisine mahsup öncesi net (N) yazılmalı; mahsup kalemi cari tarafta ayrı bir eşleşme
(ya da tahakkuk alacağı N, mahsup kendi kendini kapatan kayıt) olarak işlenmeli. Bordro onayı geri alınırsa
(bkz. P0-5) iki kayıt birlikte terslenmeli.

### P0-3 İşten ayrılan personelin son ay bordrosu oluşturulamıyor
`personel.service.ts:286` toplu tahakkuk `where: { aktif: true, durum: "aktif", … }`. Çıkış işlemi
(`istenCikar`) durumu `isten_ayrildi`, `aktif=false` yapıyor; ardından alınan tahakkukta kişi yok.
`cikisTarihi >= dönem başı` koşulu bu yüzden hiç işe yaramıyor. Aynı süzgeç `askida` ve `uzun_sureli_izin`
durumundakileri de dışarıda bırakıyor. Puantaj (`donemCalismaKaydet`) da yalnız aktif personeli kabul ediyor;
çıkan kişinin son ay günü girilemiyor.
**Öneri:** Tahakkuk kapsamı istihdam dönemlerinden belirlenmeli: dönemle kesişen her istihdam dönemi.
Puantaj aynı kapsamla açılmalı.

### P0-4 Ay içinde giriş/çıkışta tam ay ücret
`personel.service.ts:317` `primGunu = calisma?.primGunu ?? 30`. Giriş/çıkış tarihi hiç kullanılmıyor.
**Denendi:** giriş 20.09.2026, net 30.000 → Eylül bordrosu `primGunu 30`, `netMaas 30000.00`.
Doğrusu 11 gün (20–30 Eylül) ve kısmi ücret; SGK prim günü de 11 olmalı.
**Öneri:** Varsayılan prim günü = istihdam dönemiyle ay kesişimindeki takvim günü (30 gün kuralı: tam ayda 30,
ay içi giriş/çıkışta fiilî gün); puantajda elle girilen gün bunun önüne geçer, eksik gün nedeni otomatik
"kısmi" değil işe giriş/çıkış olarak işaretlenir.

### P0-5 Bordro iptal / yeniden hesaplama yolu yok
`PersonelBordroDurum.iptal` tanımlı ama hiçbir uç kullanmıyor; bordro silme ucu yok. `bordroKalemEkle`
mevzuatlı bordroda kalemi reddediyor ve "brüt ücret girdisini düzelterek yeniden tahakkuk oluşturun" diyor,
ama `@@unique([tenantId, personelId, donemYil, donemAy])` ve tahakkukun "mevcut varsa atla" mantığı yüzünden
yeniden tahakkuk hiçbir şey üretmiyor. Sonuç: puantaj ya da ücret yanlış girildiyse o ayın bordrosu düzeltilemez;
reddedilen mevzuatlı bordro kilitli kalır; onaylanmış ama ödenmemiş bordro geri alınamaz (cari tahakkuku da).
**Öneri:** (a) `hesaplandi|reddedildi` bordroda "yeniden hesapla" (kalemleri silip güncel puantaj/ücretle yeniden
üret; avans mahsuplarını koru), (b) onaylı ve ödemesi olmayan bordroda "onayı geri al" (cari tahakkuku ters kayıt),
(c) `iptal` durumu ve kümülatif matrah zincirinde iptal/reddedilen bordroların atlanması (şu an
`personel.service.ts:318` önceki bordroyu durumuna bakmadan alıyor).

### P0-6 Personel kartı düzenlenemiyor
`PUT /personel/:id` (`personel.controller.ts`, `personel.service.ts:228`) var; `apps/web/src/app/panel/personel/**`
içinde çağıran ekran yok (detay sayfasında yalnız "İşten çıkış işlemi" ve hassas veri görüntüleme var).
Maaş, IBAN, TCKN, iletişim, çalışma tipi, engellilik derecesi, teşvik oranı oluşturulduktan sonra değiştirilemez.
**Öneri:** Detayda düzenleme formu; ücret değişikliği için P1-1'deki yürürlük tarihli ücret geçmişi.

## 4. P1 — Günlük kullanım ve finans tutarlılığı

### P1-1 Ücret değişikliğinin geçmişi ve yürürlük tarihi yok
`guncelle` `netMaas/brutMaas`ı üzerine yazıyor. Ay ortası zam, geriye dönük zam farkı, "hangi ay hangi ücret"
sorusu cevapsız; geçmiş bordrolar tutarını koruyor ama kartta tarihçe yok.
**Öneri:** `personel_ucretleri` (yürürlük tarihi, brüt/net, neden); tahakkuk dönemin ücretini buradan alır,
ay içinde değişiklik günlere bölünür.

### P1-2 Tahakkuk carisine onay tarihi yazılıyor; kapalı dönem denetimi yok
`personel.service.ts:405` `tarih: onayTarihi`. **Denendi:** Eylül bordrosu `cari_hareketler.tarih = 2026-10-04`.
Eylül maaş gideri/borcu Ekim'e düşüyor; Eylül kapandıysa kapalı döneme sızma yerine yanlış döneme yazılıyor.
Onay, ödeme, ödeme iptali ve avans ödemesinde `DonemKilidiService` çağrılmıyor.
**Öneri:** Tahakkuk tarihi = dönem sonu; tüm finansal adımlarda dönem kilidi.

### P1-3 Carisi olmayan personel hiç ödenemiyor
`cariOlustur:false` ile açılan personelde onay cari tahakkuku yazmıyor, ödeme ve avans ödemesi "cari hesap
gereklidir" diye reddediliyor; sonradan cari bağlamanın ucu ya da ekranı yok.
**Öneri:** Cari zorunlu (personel açılışında otomatik) ya da "cari bağla/oluştur" eylemi; bağlanınca onaylı
bordroların eksik tahakkukları yazılır.

### P1-4 Personel gideri tahakkuk raporunda ve nakit akışında yalnız net ücret
`rapor/tahakkuk.ts:178` gider = `odenecekTutar` (avans mahsubundan sonra daha da düşük);
`nakit-akisi.service.ts:216` çıkış = bordro kalanı. SGK işçi+işveren payı, işsizlik, gelir/damga vergisi
hiçbir yerde gider ya da nakit çıkışı değil; işveren maliyeti yalnız İK maliyet raporunda.
Mevzuatlı bordroda personel gideri ~%40–60 eksik görünür; ayın 26'sındaki SGK/muhtasar ödemesi nakit
planında yok. Bütçe (BUT) ve NAK paketlerinin "tek kaynak" ilkesi personelde bozuluyor.
**Öneri:** Tahakkukta gider = işveren maliyeti (brüt + işveren SGK/işsizlik − teşvik), nakit akışında net ücret
+ ertesi ay 26'sında SGK ve muhtasar (hesap özetinden). Net ücretli (mevzuatsız) personelde bugünkü davranış sürer.

### P1-5 Mevzuat parametreleri her kiracıya bırakılmış, kabul döngüsel
`mevzuat.service.ts`: brüt ücretli tek bir personel varsa tahakkuk etkin mevzuat seti ister; seti kiracı kendisi
yazar (asgari ücret, SGK tavanı, işçi/işveren oranları, vergi dilimleri, istisnalar), kendisi kabul senaryosu
ekler ("beklenen" sonucu da kendisi girer) ve ikinci bir kullanıcı etkinleştirir. KOBİ kullanıcısı bu sayıları
bilmez; hata yaparsa bütün bordrolar yanlış olur ve kabul senaryosu bunu yakalamaz (beklenen değer de
aynı kişiden).
**Öneri:** Sistem genelinde yayımlanan, sürümlü resmî parametre seti (ör. "2026 Ocak", "2026 Temmuz";
resmî tatillerdeki `packages/shared` yaklaşımı) ve uzman doğrulamalı yerleşik kabul senaryoları; kiracı yalnız
seçer ya da istisnai durumda kopyalayıp değiştirir.

### P1-6 Net ücretli personelde vergi/SGK yok; netten brüte çevirme yok
Yalnız `netMaas` girilen personel "operasyonel net" ile tahakkuk ediliyor: kesinti, işveren maliyeti, SGK
matrahı yok. Türkiye'de KOBİ ücretlerinin çoğu net anlaşılır; doğru bordro için netten brüte iterasyon gerekir.
**Öneri:** Mevzuatlı hesapta "net hedef" girdisi (aynı motorla ikili arama), kartta "ücret net anlaşıldı" işareti.

### P1-7 Yıllık izin hak edişi otomatik değil; cumartesi kuralı ortak takvimle çelişiyor
`izin.service.ts`: yıllık izin bakiyesi yalnız elle "hak ediş" hareketiyle artıyor; kıdeme göre 14/20/26 gün
(18 yaş altı ve 50 yaş üstünde en az 20; İş K. m.53) ve yıl dönümü hak edişi yok.
`isGunuSayisi` (`izin.service.ts:7`) cumartesiyi her zaman 0 sayıyor; ortak çalışma takvimi kuralı
(2026-09-30, `uretim-takvim.ts`) "cumartesi 0,5". Altı gün çalışan işyerinde izin eksik düşülür.
**Öneri:** Yıl dönümünde otomatik hak ediş (worker), doğum tarihi alanı; gün sayımı tek takvim fonksiyonundan
ve cumartesi kuralı ayar olarak.

### P1-8 İzin ve puantaj bağlı değil
Onaylanan ücretsiz izin ya da raporlu hastalık izni dönem çalışmasına (prim günü, eksik gün nedeni) yansımıyor;
puantaj ayrı ekranda elle giriliyor. Aynı bilgi iki yerde, tutarsızlığa açık.
**Öneri:** Tahakkuk/puantaj açılırken dönemle kesişen ücretsiz/raporlu izinlerden eksik gün ve neden önerilsin.

### P1-9 Ücret hesap pusulası (bordro çıktısı) yok
İş K. m.37 ücret hesap pusulası verilmesini ister. Bordro detayında PDF ya da e-posta yok.
**Öneri:** Kalem dökümü + hesap özeti (mevzuatlıda) PDF, toplu e-posta; şablon FTR-22 belge şablonlarıyla.

### P1-10 Avans ödemesinin kaynak bağı ve iptali yok
`avansOde` (`personel.service.ts:666`) kasa/banka fişine `kaynakRef` yazmıyor; ödenmiş avansı geri alma ucu yok.
Yanlış kasadan ödenen avans düzeltilemez, muhasebe/denetimde fiş avansa bağlanamaz.
**Öneri:** `kaynakRef = avans.id`, bordro ödemesindeki gibi ters kayıtlı "ödemeyi iptal et" (mahsup edilmemişse).

### P1-11 Puantaj ekranı yemek yardımını sıfırlıyor (ek bulgu, PRS-02 sırasında)
`bordrolar/calisma-gunleri/page.tsx`: nakit yemek yardımı ve fiilî çalışma günü alanları ekranda yok; kaydet
bu iki alanı göndermediği için API varsayılanı (0) yazılıyor. API'den girilmiş yemek yardımı ekrandan herhangi bir
düzeltmede silinir; özellik ekrandan kullanılamaz.
**Öneri:** İki sütun eklensin (yemekte fiilî gün zorunlu kuralı zaten şemada).

## 5. P2 — Verimlilik, raporlama ve tutarlılık

| No | Konu | Öneri |
|---|---|---|
| P2-1 | Organizasyon yalnız oluşturuluyor | İşyeri, departman, pozisyon düzenleme/pasife alma; işyerine SGK sicil no |
| P2-2 | İK bildirimi yok | BLD'ye: özlük belgesi süre sonu (rapor ekranında var, zilde yok), bekleyen izin/avans/bordro onayı, deneme süresi bitimi |
| P2-3 | Liste sayfalamasız ve Türkçe aramasız | Sunucu sayfalama, durum/departman süzgeci, `aramaNormal` benzeri aksansız arama (ILIKE İ/ı katlamıyor), satırdan karta geçiş |
| P2-4 | Ekranlar tasarım sisteminin dışında | `.hr-subpage` altında Tailwind sınıflarını taklit eden sabit hex'li katman, koyu gradyan başlıklar, mor vurgu; uygulamanın açık+turuncu `components/ui` diline taşınmalı |
| P2-5 | Bordro özetinde "prim" yanlış | `bordroToplamlariniGuncelle` prim = kazanç − `temel_ucret`; mevzuatlı bordroda kod `temel_brut_ucret`, avans mahsubundan sonra bütün brüt "prim" görünür |
| P2-6 | Net ücretli personelde puantajın fazla mesai/prim/yemek alanları yok sayılıyor | Operasyonel bordroya kazanç kalemi olarak eklensin |
| P2-7 | Toplu işlemler | Bordroda toplu onaya gönder/onayla/öde (tek tek yapılıyor), puantaj Excel içe aktarma |
| P2-8 | Ayrı İK rolü yok | Maaş ve özlük verisi tüm muhasebe kullanıcılarına açık; `ik` rolü ya da maaş görünürlüğü izni |

## 6. P3 — Stratejik

| No | Konu |
|---|---|
| P3-1 | Bordronun muhasebe fişi: MUH aktarımı bordroyu "maaş programından gelir" diye kapsam dışı tutuyor (`fis-okuyucu.ts:27`); modül zaten SGK/vergi kırılımını hesapladığı için 770/335/360/361 fişi üretilebilir |
| P3-2 | Çıkış bordrosu: kıdem ve ihbar tazminatı, kullanılmamış izin ücreti |
| P3-3 | SGK/GİB çıktıları: işe giriş–çıkış bildirgesi verisi, MUHSGK (muhtasar ve prim hizmet beyannamesi) ön dökümü |
| P3-4 | Çalışan self-servis: personel ↔ kullanıcı bağı, kendi izin/avans talebi ve pusulası; onay yönetici hiyerarşisinden (`yoneticiId` zaten var) |
| P3-5 | Bordro tahakkukunun arka plan işi ve büyük kadro performansı (şu an tek transaction içinde personel başına 3–4 sorgu) |

## 7. Önerilen sıra

| Sıra | İş | Kapsam |
|---|---|---|
| 1 | P0-1 banka dosyası + P0-6 personel düzenleme | Küçük; hemen kullanılabilirlik |
| 2 | P0-3 + P0-4 tahakkuk kapsamı ve kısmi ay (istihdam dönemlerinden) | Servis + test |
| 3 | P0-5 yeniden hesapla / onayı geri al / iptal + kümülatif zincir | Servis + bordro ekranı |
| 4 | P0-2 avans–cari eşleşmesi + P1-10 avans iptali + P1-3 cari bağlama | Finans tutarlılığı; iş kuralı kararı |
| 5 | P1-2 dönem sonu tarihi ve dönem kilidi + P1-4 gider/nakit akışı | Rapor + nakit akışı |
| 6 | P1-1 ücret geçmişi + P1-6 netten brüte | Şema + hesap motoru |
| 7 | P1-5 yerleşik mevzuat setleri | İçerik + uzman doğrulaması gerekir |
| 8 | P1-7, P1-8, P1-9 | İzin ve pusula |
| 9 | P2 → P3 | Modül modül |

P0-2 (avans mahsubu caride nasıl kapanır), P0-4 (30 gün kuralı ve giriş/çıkış günü), P1-4 (giderde brüt mü
işveren maliyeti mi) ve P1-5 (resmî set kimin sorumluluğunda) iş kuralı kararı gerektiriyor; kodlamadan önce
S-01 onay kapısından geçmeli. P1-5 ve P1-6 bordro uzmanı / mali müşavir doğrulaması ister.

## 8. Deneme verisi

Yerel demo kiracıda kalan: `PRS-000001 Deneme İnceleme` (giriş 20.09.2026, net 30.000, cari `PRS-000001`),
Eylül 2026 bordrosu `onaylandi` (ödeme yok) ve carisinde 30.000 TL `bordro_tahakkuk` alacağı (04.10.2026).
Bordro iptal ucu olmadığı için (P0-5) API'den geri alınamıyor; düzeltmeler sırasında test verisi olarak kullanılabilir.
