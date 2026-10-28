# Rol kısıtı olmayan uçlar — inceleme raporu (2026-10-28)

**Kapsam:** `@Roller` taşımayan (sınıf ya da metot düzeyinde), oturum isteyen (`@Public` olmayan) API uçları. Liste, denetleyicilerin TypeScript sözdizimi ağacından çıkarıldı (954 uç; 157'si rolsüz: 112 okuma, 45 yazma).

**Kural (bugün):** rolsüz uç, oturum açmış her role açıktır. Çalışan (self-servis) bu kuraldan muaftır (PRS-21). Web menüsü rolleri ayrıca süzer (`ROL_YOLLARI`) ama API'yi korumaz.

## P0 — B2B bayi bütün firma verisini okuyabiliyordu (düzeltildi: e5b40d3)

Bayi firmanın müşterisidir. Rolsüz uçlar ona da açıktı. Canlı denemede bayi kullanıcısı:

- tüm cari listesini, başka bir müşterinin kartını, ekstresini ve risk durumunu,
- fatura, stok, belge, masraf listelerini, satış özetini,
- asistan sohbet uçlarını

200 ile okuyordu (kasa-banka sınıf düzeyinde kısıtlı olduğu için 403).

**Düzeltme:** bayi de çalışan gibi yalnız adının açıkça geçtiği uçlara (`b2b/*`) ve hesap/bildirim uçlarına erişir; asistan araç süzgeci aynı kuralı kullanır. Düzeltmeden sonra aynı uçların hepsi 403, portal uçları (`b2b/profil`, `katalog`, `ekstre`) 200.

## Personel rolleri için öneriler (A, B, C, E uygulandı)

İlke: API'deki rol listesi, ucu kullanan **ekranlara giren rollerin** birleşimi olur. Formlarda ortak kullanılan arama/seçim uçları açık kalır.

### A. Cari finans ayrıntıları — uygulandı

| Uç | Kullanan ekran | Önerilen roller |
|---|---|---|
| `cari/:id/ekstre` (+pdf, excel) | Cari kartı, ana sayfa | yönetici, muhasebe, satış, salt okunur, mali müşavir |
| `cari/:id/durum`, `cari/:id/davranis-analizi` | Cari Durum Paneli | aynı |
| `cari/:id/teminatlar` | Cari kartı › Teminatlar | aynı |
| `cari/:id/babs` (+pdf) | Cari kartı › BA/BS | muhasebe, salt okunur, mali müşavir |
| `cari/mutabakatlar` (+excel, ekstre, ek) | Cari › Mutabakatlar | muhasebe, salt okunur, mali müşavir |
| `cari/gruplar/:id/excel` | Cari grupları | muhasebe, satış, salt okunur |

Bugün bu uçlar üretim planlama/operatör, depo, kalite, maliyet muhasebesi ve İK rollerine de açık; bu rollerin menüsünde Cari yok.

### B. Satış/alış özetleri — uygulandı

| Uç | Ekran | Önerilen roller |
|---|---|---|
| `fatura/satis-ozeti` | Satış özeti | satış, muhasebe, salt okunur, mali müşavir |
| `fatura/alis-ozeti` | Satın alma özeti | muhasebe, salt okunur, mali müşavir |

`fatura/is-kuyrugu-ozeti` ve `stok/kritik-ozeti` ana sayfada her role gösterilen sayaçlar; açık kalmalı.

### C. Masraflar — uygulandı

`masraflar`, `masraflar/:id`, `masraflar/kategoriler`, `masraflar/kiralar`: Masraflar ekranı (muhasebe), kredi kartı işlem formu (muhasebe) ve **araç detay ekranı** (depo da girer) kullanıyor. Öneri: muhasebe, salt okunur, mali müşavir, depo.

### D. Açık kalmalı (ortak arama/seçim ve belge görüntüleme)

- `cari`, `cari/:id`, `cari/etiketler`, `cari/gruplar`, `cari/toplu/kimlikler` — fatura/teklif/irsaliye/satın alma formlarında cari seçimi (satış, depo, üretim planlama talepleri).
- `stok`, `stok/:id`, `stok/barkod/:barkod`, `stok/:id/fiyatlar`, `stok/:id/tavsiye-fiyat`, `stok/:id/depo-bakiyeleri`, `stok/:id/partiler`, `stok/kategoriler`, `depo`, `depo/:id`, `fiyat-listeleri` — ürün seçimi ve stok ekranları (satış, depo, üretim).
- `belgeler`, `belgeler/:id` (+pdf, sürümler, durum geçmişi), `fatura/seriler`, `fatura/sablon-onizleme`, `sevkiyat/araclar`, `sevkiyat/soforler`, `ebelge/uygulamalar` — belge formları ve görüntüleme.

### E. İkinci tur — ekran ekran doğrulandı ve uygulandı

- `fatura`, `fatura/:id` (+pdf, durum geçmişi), `fatura/tekrarlayanlar`: fatura listesi tutarları üretim/kalite/İK rollerine de açık; ama irsaliye–fatura bağlama ve sevkiyat ekranları da kullanıyor. Kısıtlamadan önce ekran ekran doğrulama gerekir.
- `ebelge/gelen`, `ebelge/irsaliye/*` okuma uçları: e-Belge ekranları muhasebe (+ satış için giden irsaliye, depo için gelen irsaliye eşleştirme). Aynı doğrulama gerekir.
- `stok/sayimlar*`, `stok/:id/hareketler`, `depo/transferler*`: stok ekranlarına girmeyen roller (satış, İK, kalite…) için kapatılabilir.

## Not

Kasa-banka okuma uçları sınıf düzeyinde `@Roller("muhasebe", "salt_okunur")` ile zaten kısıtlıdır; özel rol matrisinin satışa kasa-banka kutusu göstermesi oturumsuz POS uçlarından kaynaklanıyordu (b73e931 ile düzeltildi).

## Uygulama doğrulaması (2026-10-28)

Geçici firmada rol başına canlı istek (200 = açık, 403 = kapalı):

| Uç | muhasebe | satış | depo | üretim planlama | mali müşavir |
|---|---|---|---|---|---|
| `cari`, `cari/:id` | 200 | 200 | 200 | 200 | 200 |
| `cari/:id/ekstre`, `durum`, `teminatlar` | 200 | 200 | 403 | 403 | 200 |
| `cari/:id/babs`, `cari/mutabakatlar` | 200 | 403 | 403 | 403 | 200 |
| `fatura/satis-ozeti` | 200 | 200 | 403 | 403 | 200 |
| `fatura/alis-ozeti` | 200 | 403 | 403 | 403 | 200 |
| `masraflar`, `masraflar/kiralar` | 200 | 403 | 200 | 403 | 200 |
| `stok` | 200 | 200 | 200 | 200 | 200 |

Web: cari kartındaki BA/BS ve mutabakat panelleri ile `/panel/cari/mutabakatlar` sayfası yalnız bu rollere görünür.

## E maddesi uygulaması (2026-10-28)

Her uç, onu çağıran ekranların rolleriyle sınırlandı (çağıranlar zaten rol koşuluna bağlı: ana sayfa gelen e-belge sayacı finans rollerinde, komut paleti fatura araması fatura sayfasına girebilenlerde).

| Uç | Kullanan ekranlar | Roller (+yönetici) |
|---|---|---|
| `fatura`, `fatura/:id` (+pdf, durum geçmişi), `fatura/tekrarlayanlar`, `ebelge/gelen` (+:id, pdf), `ebelge/giden/:faturaId/pdf` | Fatura, Satış, Kasa-Banka, Cari (ödeme sözleri) | muhasebe, satış, salt okunur, mali müşavir |
| `ebelge/irsaliye/gelen` (+:id, pdf) | e-İrsaliye gelen | muhasebe, salt okunur, mali müşavir |
| `ebelge/irsaliye/giden` (+:id, pdf, entegratör geçmişi) | e-İrsaliye giden, Belgeler | muhasebe, satış, salt okunur |
| `ebelge/irsaliye/numara-bosluklari` (+taslak) | e-İrsaliye giden | muhasebe, satış |
| `stok/sayimlar*`, `stok/:id/hareketler`, `depo/transferler*`, `depo/:id/bakiyeler` | Stok ekranları | muhasebe, salt okunur, üretim planlama, depo, maliyet muhasebesi |

Canlı rol denemesi: fatura listesi depo/üretim operatörü/kalite/İK'ya 403, satış ve mali müşavire 200; stok sayımı ve depo transferi satış/üretim operatörü/kalite/İK/mali müşavire 403, depoya 200. Ortak arama uçları (`cari`, `stok`, `belgeler`) bütün iç rollere açık kaldı. Rolsüz okuma ucu sayısı 112 → 68 (kalanlar oturum, bildirim, asistan, ayar okumaları ve ortak arama/seçim uçları).
