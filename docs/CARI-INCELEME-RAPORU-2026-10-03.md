# Cari Hesap Modülü İnceleme Raporu

**Tarih:** 3 Ekim 2026
**İnceleme türü:** Kod okuma + yerel API'de canlı deneme (geçici test carileriyle; denemeden sonra silindi). Kod değişikliği yapılmadı.
**Kapsam:** Cari kartı, liste ve süzgeçler, bakiye/risk/finansal özet, ekstre (CARI-04/24/25/26),
yaşlandırma ve modül raporları, Excel içe aktarma, elle cari hareketi, kara liste / risk limiti uygulaması.
**Dosyalar:** `apps/api/src/cari/*`, `apps/api/src/core/excel-yardimci.ts`, `apps/api/src/fatura/fatura.service.ts`
(kara liste + risk kontrolü), `apps/web/src/app/panel/cari/**`

## 1. Özet

Ekstre tarafı (standart/ayrıntılı/döviz, iptal çifti gizleme, devir, PDF/Excel/e-posta) sağlam ve hızlı
(kart ve ekstre 50–140 ms). Kart düzeni, CRM, adres/kişi/banka hesapları, etiketler ve e-belge
mükellefiyeti isterleri karşılıyor. Cariye özel fiyat listesi, iskonto ve vade fatura ekranına geliyor.

Para hesabını ya da veri bütünlüğünü doğrudan etkileyen beş sorun var:

1. **Elle girilen dövizli cari hareketi kur kontrolü yapmıyor.** 100 USD kur 1 ile 100 TL olarak yazılıyor
   (denendi). Masrafta "dövizlide kur 1 yasak" kuralı var, burada yok.
2. **Risk, bankaya verilmiş çekleri saymıyor.** Tahsile ya da teminata verilen müşteri çeki, tahsil edilene
   kadar risktir; şu an çek bankaya verildiği anda müşterinin riski düşüyor.
3. **Dövizli carilerde bakiye, risk ve vadesi geçmiş tutar, hareketlerin tarihî TL karşılıklarının toplamı.**
   Güncel kurla değerleme yok; dövizler FIFO'da birbirine karışıyor.
4. **"Gecikmiş" süzgeci ödenmiş faturaları da sayıyor.** 15 carinin 11'i "gecikmiş" görünüyor; bunların
   arasında bakiyesi 0 olan ve bize borçlu olmadığımız (alacaklı) cariler var.
5. **Excel içe aktarma mevcut kartları boş hücrelerle eziyor.** Kodu eşleşen kartın VKN, e-posta ve
   telefonu boşaltılıyor. Tip boşsa kart "müşteri"ye çevriliyor; bu yüzden tedarikçiye alış faturası kesilemiyor.

## Durum

| Madde | Durum |
|---|---|
| P0-1, P1-5 | ✅ 2026-10-03 — CARI-27/28 (TCMB kuru, açılış bakiyesi, düzeltme fişi, doğrudan silme). Excel açılış sütunu P0-5 ile. |
| P1-1, P1-4 | ✅ 2026-10-03 — CARI-29 |
| P0-2, P0-4 | ✅ 2026-10-03 — CARI-30 (P1-7'nin iptal çifti kısmı da) |
| P0-5, P2-4 | ✅ 2026-10-03 — CARI-31 (P1-8'in içe aktarmadaki uyarısı da) |
| P1-2, P1-3 | ✅ 2026-10-03 — CARI-32 (kara liste her belgede, pasif yalnız yeni belgede; risk politikası uyar/engelle/yönetici onayı) |
| P0-3, P1-7 | ✅ 2026-10-03 — CARI-33 (güncel TCMB döviz satış kuru; döviz başına, iki yönlü yaşlandırma) |
| P1-6, P1-8 | ✅ 2026-10-04 — CARI-34 (son tahsilat/ödeme tüm ödeme kaynaklarından) ve CARI-35 (aynı VKN uyarı + onay) |
| P2-1 | ✅ 2026-10-04 — CARI-36 (listede döviz kırılımı, bakiye durumu/aralığı süzgeci, bakiyeye göre sıralama; güncel kurla TL) |
| P2-3 | ✅ 2026-10-04 — CARI-37 (Form BA/BS raporu + Excel, eşik ayarı, eşiğe yakınlar, cari bazında mutabakat PDF/e-posta) |
| P2-5 | ✅ 2026-10-04 — CARI-38 (toplu vade hatırlatma/ihtar e-postası, Ayarlar'dan şablon, fatura tablosu + 90 günlük ekstre eki, 7 gün sıklık sınırı, CRM kaydı) |
| P2-6 | ✅ 2026-10-04 — CARI-39 (teminat mektubu/ipotek/DBS/nakit/kefalet/diğer; geçerli teminat güncel kurla risk limitine eklenir; bitişe 30 gün kala ve süresi dolunca bildirim) |
| P2-2 | ✅ 2026-10-04 — CARI-40 (listede seçim + süzgece uyan tümü; toplu etiket, pasif/aktif — açık bakiyede onay, kara liste + not, temsilci, ekstre/mutabakat e-postası en çok 100 cari — e-postasız ve kara listedeki atlanır, CRM'e yazılır, seçilenlerin Excel'i; her toplu işlem tek auditLog `cari_toplu_*`; Muhtelif Müşteriler pasife/kara listeye alınmaz). Cari grubu ataması P3-2'ye bırakıldı (alan yok) |
| P3-2 | ✅ 2026-10-04 — CARI-41 (tek seviyeli cari grubu; grup riski = üyelerin riskleri toplamı, limit = grup risk limiti + üyelerin geçerli teminatları; sipariş onayı ve fatura kesinleştirmede cari limitinden sonra grup limiti de aynı politikayla denetlenir; grup sayfası üye kırılımı + Excel, kartta grup özeti, listede grup süzgeci ve toplu grup ataması; silinen grubun üyeleri gruptan çıkar) |
| P3-1 | ✅ 2026-10-04 — CARI-42 (mutabakat portalı: talepte bakiye + ekstre PDF dondurulur, kişiye özel girişsiz bağlantı — 256 bit anahtar, DB'de yalnız SHA-256 özeti; karşı taraf mutabık ya da döviz başına kendi bakiyesi + açıklama + isteğe bağlı PDF/Excel/CSV ekiyle itiraz eder, tek yanıt, IP/tarayıcı kaydı; itirazda anlık + taramalı bildirim, CRM kaydı, notla kapatma; son tarihe 3 gün kala worker'dan tek hatırlatma; kartta geçmiş, /panel/cari/mutabakatlar takip + Excel, listede toplu talep) |

## 2. Öncelik sınıfları

| Sınıf | Anlamı |
|---|---|
| **P0** | Yanlış tutar, yanlış bakiye/risk ya da veri kaybı |
| **P1** | Günlük kullanımda hemen hissedilen eksik ya da yanlış davranış |
| **P2** | Verimlilik, raporlama, toplu işlemler |
| **P3** | Stratejik / uzun vadeli |

## 3. P0 — Doğruluk hataları

### P0-1 Elle cari hareketinde kur denetimi yok
`cari.service.ts:743` `hareketEkle`, `cari.semalar.ts:124`. `kur` varsayılanı `"1"`; dövizli harekette
kur 1 ya da boş kabul ediliyor, TCMB kuru önerilmiyor. **Denendi:** `POST /cari/:id/hareketler`
`{dovizCinsi:"USD", tutar:"100", kur:"1"}` → 201, `tutar_try = 100.00`. Bu hareket TL bakiyesini, riski,
yaşlandırmayı ve muhasebe fişini yanlış etkiler.
**Öneri:** Masraftaki kuralı uygulamak: dövizde kur 1 yasak, boşsa `kur-coz` ile o günün kuru (DVZ-09'a
göre borçta satış, alacakta alış kuru).

### P0-2 Risk özetinde bankadaki çekler sayılmıyor
`cari.service.ts:212` — çek/senet riski yalnız `portfoyde` ve `ciro_edildi`. `tahsile_verildi` ve
`teminata_verildi` durumundaki alınan çekler hariç. Ama bu çekler karşılıksız çıkabilir; tahsil edilene
kadar müşteri riskidir. Fatura kesinleştirmedeki risk uyarısı (`fatura.service.ts:1460`) çek riskini hiç
saymıyor; kartta görülen risk ile faturadaki uyarı farklı hesaplanıyor.
**Öneri:** Risk = açık bakiye + {portföyde, ciro edildi, tahsile verildi, teminata verildi} alınan çek/senet.
Ciro edilen çekin riski, vadesi geçip karşılıksız bildirimi gelmeyene kadar sürer. Kart ve fatura aynı
fonksiyonu kullanmalı.

### P0-3 Dövizli cari: tarihî TL toplamı, güncel değerleme yok
`bakiyeleriGetir` (`:925`), `riskOzeti`, `finansalOzet` (`:229`), `yaslandirma.ts`, `cari.raporlar.ts`
(yaşlandırma, en yüksek bakiyeliler), fatura risk kontrolü — hepsi `tutarTry` toplar.
**Görülen örnek (MUS-IHR-01):** USD bakiye 148.349,10, EUR 5.200, TL −3.163.662,17. Kartta
"Alacaklıyız 4.322.572,83 TL", "Mevcut risk 4.322.572,83", "Vadesi geçmiş 4.322.572,83". USD tarafı tarihî
kurla 7.237.415 TL sayılmış. TL tarafındaki −3,16 milyon büyük olasılıkla dövizli faturaların TL ile
tahsil edildiği eski kayıtlar (finans P0-1 öncesi); USD borcu ile TL alacağı FIFO'da birbirini kapatıyor
gibi hesaplanıyor ama kur farkı yok sayılıyor.
**Öneri:** (a) Bakiye ve riskte her dövizin açık bakiyesi **güncel kurla** TL'ye çevrilir; tarihî değer ayrıca
gösterilir (fark = değerlenmemiş kur farkı). (b) Yaşlandırma döviz başına ayrı yapılır, TL toplamı güncel kurla.
(c) Bu carideki eski karışık kayıtlar için kur farkı ekranına yönlendirme. İş kuralı kararı gerekir
(güncel kur = TCMB döviz alış mı, efektif mi).

### P0-4 "Gecikmiş" liste süzgeci yanlış
`cari.service.ts:79` — `hareketler.some({tip:"borc", vadeTarihi < bugün})`. Vadesi geçmiş **herhangi** bir
borç hareketi olan cari geliyor; ödenmiş olsa da. **Denendi:** `?bakiye=gecikmis` → 11 cari; MUS-003
(bakiye 0,00), CARI-005 (−268.905,60, cari alacaklı), TED-IHR-01 dahil.
**Öneri:** Kartın "vadesi geçmiş bakiye" hesabıyla aynı kural (FIFO sonrası açık ve vadesi geçmiş > 0).
Liste sorgusunda yapılamadığı için ya hesaplanmış bir sütun (tetikleyiciyle güncel tutulan
`vadesi_gecmis_try`) ya da gece işi + olay anında yenileme.

### P0-5 Excel içe aktarma veriyi siliyor ve doğrulamıyor
`cari.service.ts:1056`, `core/excel-yardimci.ts:6`.
- `upsert.update` boş hücreyi `null` yazar: kodu eşleşen kartın VKN/e-posta/telefonu silinir.
- Tip sütunu boş ya da tanınmazsa `musteri` olur; mevcut tedarikçi kartı müşteriye döner, alış faturası
  `cariTipiniDogrula` hatası verir. `her_ikisi`, `personel`, `ortak` hiç tanınmıyor.
- VKN/TCKN format ve kontrol hanesi, e-posta biçimi, kişi tipi (gerçek kişide ad/soyad, CARI-21) denetlenmiyor;
  servis katmanındaki `olustur` kuralları tamamen atlanıyor.
- Kod yoksa `CARİ-<zaman damgası>-<satır>` üretiliyor (numaralandırma serisini kullanmıyor).
- "Muhtelif Müşteriler" sistem carisi kodla ezilebilir.
- Satır bazında hata raporu yok; tek hata tüm dosyayı düşürür ya da sessizce yanlış yazar.
**Öneri:** Önizleme + doğrulama adımı (satır satır hata/uyarı), boş hücre "değiştirme" anlamına gelir,
yeni / güncellenecek / hatalı sayıları onaydan sonra yazılır, `olustur`/`guncelle` kuralları kullanılır.

## 4. P1 — Günlük kullanım

### P1-1 Kart alanları temizlenemiyor
`guncelle` (`:528-534`): `riskLimiti: girdi.riskLimiti ? … : undefined`; `varsayilanIskonto`,
`kvkkOnayTarihi` aynı. Şema `null` kabul etmiyor (400), ekran boş alanı `undefined` gönderiyor
(`panel/cari/page.tsx:482`). **Denendi:** risk limiti 5000 yapıldıktan sonra boşaltılınca 5000 kaldı.
Ekran fiyat listesi ve varsayılan vadeyi de boşken `undefined` gönderdiği için bunlar da kaldırılamıyor;
temsilci ve IBAN aynı desende olabilir (denenmedi).
**Öneri:** Güncellemede `null` = temizle; ekran boş alanı `null` gönderir.

### P1-2 Kara liste ve pasif cari blokajı eksik
Kara liste yalnız **fatura kesinleştirmede** (`fatura.service.ts:1331`) uygulanıyor. Teklif, sipariş,
irsaliye (`belgeler`), satın alma siparişi, POS ödeme bağlantısı açık. Pasif cari için hiçbir yerde kontrol
yok. **Denendi:** pasif cariye fatura taslağı 201 ile oluştu. CARI-17'deki "AYR-04 kural altyapısıyla"
şartı karşılanmıyor (sabit kod).
**Öneri:** Tek bir `cariIslemeUygunMu(tx, cariId, islem)` denetimi; satış yönlü belgelerin oluşturulması ve
onayında hata, tahsilatta serbest (borçlu kara listedeki müşteriden tahsilat engellenmemeli).

### P1-3 Risk limiti yalnız fatura kesildikten sonra uyarıyor
Kontrol kesinleştirmede ve fatura yazıldıktan sonra yapılıyor. Taslak, teklif ve sipariş onayında önceden
uyarı yok. Limiti aşan satışı engelleme ya da yetkili onayı seçeneği yok. Çek riski sayılmıyor (P0-2).
**Öneri:** Kiracı ayarı: uyar / engelle / yetkili onayı (dört göz). Sipariş onayında ve fatura formunda
"bu belgeyle risk X, limit Y" bilgisi.

### P1-4 Belgesi olan cari silinince 500
`sil` (`:542`) yalnız cari hareketi sayıyor. Taslak faturası, teklifi, siparişi, irsaliyesi ya da çeki olan
cari silinmek istenince yabancı anahtar hatası 500 olarak dönüyor. **Denendi:** taslak faturalı cari → 500
"Beklenmeyen sunucu hatası".
**Öneri:** Bağlı kayıt türlerini sayıp anlaşılır mesaj ("3 taslak fatura, 1 teklif var; pasife alın").

### P1-5 Elle cari hareketi düzeltilemiyor; açılış bakiyesi yolu yok
Elle hareket eklenebiliyor ama silme/ters kayıt ucu yok. Yanlış hareket kalıcı. Açılış bakiyesi için
ayrı tür yok; Excel içe aktarmada bakiye sütunu yok.
**Öneri:** Elle hareketlere ters kayıt (finans P1-1'deki desen) + "açılış bakiyesi" türü (döviz ve vade
kırılımlı, muhasebede 1xx/3xx açılış fişi). Excel'e açılış bakiyesi sütunu.

### P1-6 Son tahsilat/ödeme tarihi eksik kaynaklardan
`finansalOzet` yalnız `kasaBankaHareket` (tahsilat/tediye) okuyor. Çek/senet, kredi kartı, POS ve mahsup
tahsilatları sayılmıyor. **Görülen:** MUS-IHR-01 "Son ödeme —".
**Öneri:** Cari hareketinin `kaynakTur` alanından türetmek (alacak yönlü ödeme türleri).

### P1-7 Yaşlandırma yalnız müşteri yönlü
`yaslandir` yalnız borç hareketlerini (bizim alacağımız) yaşlandırıyor. Tedarikçiye borçlarımızın vade
dağılımı (ödeme planı için gerekli) yok. İptal edilen faturanın ters hareketi FIFO'da en eski borcu
kapatıyor; yaşlandırma kayıyor.
**Öneri:** Yön seçimi (alacaklarımız / borçlarımız), iptal çiftlerini FIFO'dan önce düşmek, döviz başına
(P0-3).

### P1-8 Aynı VKN ile ikinci cari uyarısız açılıyor
**Denendi:** mevcut VKN ile yeni cari 201. Şube carileri için bilinçli olabilir; ama genelde mükerrer
kayıt ve bölünmüş bakiye demek.
**Öneri:** Uyarı + onay ("Bu VKN CARI-005'te kayıtlı; yine de aç").

## 5. P2 — Verimlilik ve raporlama

| No | Konu | Öneri |
|---|---|---|
| P2-1 | Listede bakiye tek TL sayısı (tarihî toplam) | Döviz kırılımı (USD/EUR rozeti), bakiye aralığı süzgeci ve sıralama |
| P2-2 | Toplu işlem yok | Seçili carilere toplu etiket, toplu pasife alma, toplu ekstre/mutabakat e-postası |
| P2-3 | BA/BS mutabakatı yok | Aylık 5.000 TL üstü KDV hariç alış/satış raporu (Form BA/BS) + cari bazında mutabakat mektubu |
| P2-4 | Excel içe aktarma dar | Şablon indirme; adres, vergi dairesi, kişi tipi, döviz, vade, risk limiti, etiket sütunları |
| P2-5 | Vadesi geçen alacak hatırlatması yok | Seçilen carilere vade hatırlatma / ihtar e-postası (şablonlu), CRM etkileşimine kayıt |
| P2-6 | Teminat takibi yok | Alınan teminat mektubu / ipotek / DBS limiti; risk limiti hesabında kullanılır |

## 6. P3 — Stratejik

| No | Konu |
|---|---|
| P3-1 | Mutabakat portalı: karşı taraf bağlantıdan ekstreyi onaylar/itiraz eder, sonuç kartta görünür |
| P3-2 | Cari grubu (holding/ana firma): grup bazında risk ve bakiye |
| P3-3 | Kredi sigortası / dış skor (Findeks) bağlantısı ve CARI-20 skoruna katkı |

## 7. Önerilen sıra

| Sıra | İş | Kapsam |
|---|---|---|
| 1 | P0-1 kur denetimi + P1-5 elle hareket ters kaydı / açılış bakiyesi | Küçük; şema + servis + form |
| 2 | P1-1 alan temizleme + P1-4 silme mesajı | Çok küçük, düşük risk |
| 3 | P0-4 gecikmiş süzgeci + P0-2 çek riski (kart ve fatura ortak risk fonksiyonu) | Servis |
| 4 | P0-5 Excel içe aktarma önizleme/doğrulama (+ P2-4) | Yeni akış + ekran |
| 5 | P1-2 kara liste / pasif blokajı + P1-3 risk limiti politikası | Birden çok modül; iş kuralı kararı |
| 6 | P0-3 güncel kurla değerleme + P1-7 yaşlandırma (döviz/yön) | En geniş; iş kuralı kararı |
| 7 | P1-6, P1-8 | Küçük |
| 8 | P2 → P3 | Modül modül |

P0-3 (hangi kurla değerleme), P1-2 (hangi belgeler engellenir) ve P1-3 (uyar/engelle/onay) iş kuralı
kararı gerektiriyor; kodlamadan önce S-01 onay kapısından geçmeli.
