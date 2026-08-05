# UI Tamamlama Paketi — Kapsam Listesi

**Tarih:** 2026-07-15
**Amaç:** Backend'de (API + veri modeli) kurulu ve çalışır olduğu hâlde web
arayüzünde (`apps/web`) hiç ya da kısmen karşılığı olmayan yapıların tam
envanteri. Kaynak: çalışan API'nin map ettiği 132 rota ile `apps/web`'in
çağırdığı uçların karşılaştırması.

> Not: Aşağıdaki maddelerin **hepsinin arka ucu hazırdır**; yapılacak iş yalnızca
> **arayüz + mevcut uçların tüketimi**. Her paket kodlanmadan önce S-01 kapısı
> işletilir ([[modul-onay-kapisi]]).

---

## Son durum (2026-08-05)

## ✅ KAPSAM TAMAMLANDI (2026-08-05)

**7 paketin tamamı bitti** — 1 (Belge Zinciri), 2 (Kullanıcı & 2FA), 3 (Çek &
Senet), 4 (Stok Detay), 5 (Cari Detay), 6a+6b (Fatura & e-Belge), 7 (Modül
Ayarları); hepsi tarayıcıdan uçtan uca doğrulandı. Ayrıca öncesinde UI redesign,
2 hata düzeltmesi ve Fiyat Listeleri modülü.

Son iki paket yalnız arayüz değildi, backend de genişledi:
- **6b:** gelen belgeler `GelenEbelge` kutusuna düşüyor, UBL-TR ayrıştırılıyor,
  satırlar stok kartlarıyla eşleştirilip kullanıcı onayıyla taslak alış
  faturasına dönüşüyor, EBLG-06 kabul/ret eklendi (bkz. §6b).
- **5:** adres/kişi silme uçları yoktu, eklendi (bkz. §5).

**Sırada bu doküman yok** — devamı Entegratör Paketi (İzibiz e-Arşiv dokümanı
A-06 bekleniyor) ve v1.0'da kalan [G] maddeler.

## Özet tablo

| # | Paket | Kapsanan İSTERLER | Backend | UI | Efor |
|---|---|---|---|---|---|
| 1 | Belge Zinciri | FTR-12, FTR-13 | ✅ | ✅ **Tamam (2026-07-15)** | **Büyük** |
| 2 | Kullanıcı & Yetki + 2FA | KLN-01/02/05 | ✅ | ✅ **Tamam (2026-07-15)** | Orta |
| 3 | Çek & Senet | KSB-05 | ✅ | ✅ **Tamam (2026-07-16)** | Orta |
| 4 | Stok Detay & Alt-yapılar | STK-02/06/09/10/15/18/20 | ✅ | ✅ **Tamam (2026-07-16)** | **Büyük** |
| 5 | Cari Detay Tamamlama | CARI-09/15 | ✅ (silme uçları eklendi) | ✅ **Tamam (2026-08-05)** | Küçük |
| 6 | Fatura & e-Belge Tamamlama | FTR-06, FTR-09, EBLG-05/06 | ✅ (6b'de genişletildi) | ✅ **Tamam (6a 07-16, 6b 08-05)** | Orta→**Büyük** |
| 7 | Ayarlar Altyapısı | AYR-01/02/03, STK-17 | ✅ | ✅ **Tamam (2026-07-15)** | Orta |

---

## 1. Belge Zinciri — ✅ TAMAM (2026-07-15) · Efor: Büyük

> Eklendi: `/panel/belgeler` — tek ekran, tür filtresi (Tümü/Teklif/Sipariş/
> İrsaliye), oluşturma (kalem tablosu + faturaHesapla + fiyat listesi önerisi),
> onayla/iptal/kopyala/sil, **zincir dönüştürme** (teklif→sipariş→irsaliye→
> fatura), **toplu faturalama** (seçili onaylı belgeler), belge PDF (blob),
> detayda zincir izi (kaynak/türetilen/fatura). Menüde Finansal İşlemler > Belgeler.
> Uçtan uca doğrulandı (teklif→onayla→siparişe dönüştür→PDF).


Teklif → Sipariş → İrsaliye → Fatura zinciri (FTR-12) ve toplu faturalama
(FTR-13). Backend "tam kapsam" bitmiş (Belge Zinciri Paketi), UI hiç yok.

**Uçlar:** `GET/POST/PATCH/DELETE /belgeler` · `POST /belgeler/:id/donustur` ·
`/onayla` · `/iptal` · `/kopyala` · `POST /belgeler/toplu-fatura` ·
`GET /belgeler/:id/pdf`

**Yapılacak UI:** `/panel/belgeler` — belge listesi (tip/durum filtreli),
oluşturma formu (fatura formuna benzer kalem tablosu), **tek tık dönüştürme**
(teklif→sipariş→irsaliye→fatura zincir göstergesi), toplu seçip faturalama,
PDF görüntüleme, onay/iptal/kopyala eylemleri. Menüye "Belgeler" grubu.

## 2. Kullanıcı & Yetki Yönetimi + 2FA — ✅ TAMAM (2026-07-15) · Efor: Orta

> Eklendi: `/panel/ayarlar/kullanicilar` (liste, yeni kullanıcı, satır-içi rol
> değiştir, aktif/pasif), `/panel/ayarlar/hesap` (2FA/TOTP kur→etkinleştir),
> sidebar'da giriş rolü (`/auth/ben`). Menüye Kullanıcılar + Hesap Güvenliği.
> Uçtan uca doğrulandı.


v1.0 kapsam modülü; kullanıcı davet/rol atama ve iki adımlı doğrulama kurulumu.

**Uçlar:** `GET/POST /kullanicilar` · `PATCH /kullanicilar/:id` ·
`POST /auth/totp/kur` · `POST /auth/totp/etkinlestir` · `GET /auth/ben`

**Yapılacak UI:**
- `/panel/ayarlar/kullanicilar` — kullanıcı listesi, davet/oluştur, rol değiştir,
  aktif/pasif (KLN-01/02).
- **Hesap güvenliği** ekranı — 2FA (TOTP) kur: QR/secret göster → doğrulama kodu
  ile etkinleştir (KLN-05).
- `GET /auth/ben` → yan menüde giriş yapan kullanıcının adı/rolü (şu an sabit
  "TekirExtra" yazıyor).

## 3. Çek & Senet — ✅ TAMAM (2026-07-16) · Efor: Orta

> Eklendi: `/panel/kasa-banka/cek-senet` — **Alınan / Verilen** yön segmenti,
> KPI'lar (portföydeki ya da tedavüldeki borç, vadesi geçmiş, 30 gün içinde),
> tür + durum filtresi, yöne göre giriş formu (alınanda Borçlu, verilende
> Keşideci + zorunlu Lehtar), **güdümlü durum akışı**: alınanda Tahsil/Ciro/
> Karşılıksız/İade, verilende Ödendi/Karşılıksız/Geri Alındı; sonuçlanmış kayıt
> salt-okur. Her işlemin para ve cari etkisi onay kartında yazılı. Menüde
> Kasa & Banka altında.
>
> **Backend iki kez genişletildi (S-01 kararları):**
>
> **(a) Tahsil → para hareketi.** Tahsil yalnız durumu değiştiriyordu, para
> hiçbir yere girmiyordu. Artık `PATCH .../cek-senet/:id` `hesapKasaId` /
> `hesapBankaHesapId` / `islemTarihi` alıyor ve hesaba **tahsilat fişi** yazıyor
> (`kaynakTur=cek_senet`). Doğrulandı: 5.000 TL çek → kasa 0 → 5.000.
>
> **(b) Verilen (kendi kestiğimiz) çek — Paket 3b.** Model yalnız alınan çeki
> varsayıyordu (`CariHesap.ceklerAlinan`, `borclu` = karşı taraf). Kendi çekimiz
> girilseydi üç şey yanlış olurdu: cari ters yönde işlenirdi, ödeme parayı
> hesaba *sokardı*, müşterinin risk limiti bizim borcumuz kadar şişerdi.
> Eklenen: `CekSenet.yon` (`alinan` | `verilen`) + `verildi`/`odendi` durumları
> (migration `20260716203342_cek_senet_yon`; mevcut kayıtlar `alinan`),
> `GET .../cek-senet?yon=`, yön/durum uyumu denetimi, `cari.service` risk
> sorgusuna `yon: "alinan"` filtresi.
> Yön etkileri: **alınan** → cariye alacak, tahsilde **tahsilat** fişi;
> **verilen** → lehtara borç (zorunlu), ödemede **tediye** fişi.
> Doğrulandı: 3.000 TL kendi çekimiz → cari bakiye +3.000 (borç azaldı), çek
> riski 0'da kaldı, ödemede kasa 5.000 → 2.000, cari değişmedi, tek tediye fişi.
> Sunucu reddediyor: verilene `tahsil_edildi`, alınana `odendi`, lehtarsız
> verilen çek (üçü de 400).
>
> Ortak kurallar: hesap para birimi çek/senetle uyuşmalı; aynı duruma ikinci
> geçişte tekrar fiş yazılmaz; fişte `cariId` **boş bırakılır** (cari, çek
> alınırken/verilirken zaten işlendi).
>
> Kapsam dışı kalan: karşılıksız/iade/geri alma para hareketi üretmez (ekranda
> belirtilir).

## 4. Stok Detay & Alt-yapıları — ✅ TAMAM (2026-07-16) · Efor: Büyük

> **4a:** `/panel/stok/[id]` — Genel (tüm kart alanları, kategori, aktif/pasif;
> eylemler `izinliEylemler`'e bağlı), Hareketler (8 tip, girilen birim → ana
> birim çevrimi ve önizlemesi, `eksiStokUyarisi` gösterimi), Birimler, Barkodlar
> (+ tek ürün etiket PDF'i), Tedarikçiler. Stok listesine "Detay" linki.
> Doğrulandı: 5 koli girişi → 60 adet.
> **4b:** `/panel/stok/kategoriler` — girintili ağaç, üst seçerek ekleme; silme
> kuralları (alt kategori / ürün) butona yansır.
> **4c:** `/panel/stok/sayim` — taslakta tüm ürünler listelenir, yalnız fiili
> girilenler kalem olur; liste + detay (fark tablosu) + onayla.
> Doğrulandı: 100 → fiili 93 → onayda `sayim_duzeltme -7`, mevcut 93.
>
> Notlar: `StokHareket.miktar` API'de **işaretli** saklanır (çıkışta eksi); UI
> ayrıca işaret koymaz. Sayım onayında farklar **onay anındaki** güncel miktara
> göre yeniden hesaplanır (STK-20) — taslaktaki fark bilgi amaçlıdır.

Stok kartı ekranı şu an yalnız **liste + oluştur + kopyala**. Backend'de zengin
alt-yapılar var, kart **detay** ekranı hiç yok.

**Uçlar & isterler:**
- `GET/POST /stok/:id/hareketler` — stok hareketleri (giriş/çıkış/fire/zayi) (STK-02)
- `GET/POST /stok/sayimlar` · `POST /stok/sayimlar/:id/onayla` — sayım (STK-06/20)
- `GET/POST/DELETE /stok/kategoriler` — kategori ağacı (STK-09)
- `POST/DELETE /stok/:id/birimler` — çoklu birim (STK-10)
- `POST/DELETE /stok/:id/barkodlar` · `GET /stok/barkod/:barkod` ·
  `POST /stok/etiketler` (etiket PDF) — barkod (STK-15)
- `POST/DELETE /stok/:id/tedarikciler` — ürün-tedarikçi (STK-18)

**Yapılacak UI:** `/panel/stok/:id` **stok kart detayı** (sekmeler: Genel,
Hareketler, Birimler, Barkodlar, Tedarikçiler) + `/panel/stok/kategoriler`
(kategori ağacı) + `/panel/stok/sayim` (taslak→onay→düzeltme akışı) + barkod
etiket basımı butonu.

## 5. Cari Detay Tamamlama — ✅ TAMAM (2026-08-05) · Efor: Küçük

> **Eklendi — backend:** `DELETE /cari/:id/adresler/:adresId` ve
> `DELETE /cari/:id/kisiler/:kisiId` (+ servis `adresSil`/`kisiSil`). Ekleme
> uçları zaten vardı; silme yalnız banka hesabında vardı, adres/kişide yoktu.
> `deleteMany({ id, cariId })` deseni banka hesabıyla aynı — başka cariye ait
> id ile silme denemesi 404 döner.
>
> **Eklendi — UI (`/panel/cari` detay paneli):** Adresler ve İlgili Kişiler
> sekmeleri artık salt-okur değil; her ikisinde satır başına **Sil** ve altta
> **ekleme formu** var (banka hesapları sekmesindeki desenle aynı).
> - Adres formu CARI-15 alanlarının tamamını taşıyor: tip (fatura/sevk/merkez/
>   şube/depo), başlık, açık adres, il, ilçe, **posta kodu**.
> - Adres tablosuna posta kodu sütunu eklendi ve tip etiketleri düzeltildi —
>   `merkez`/`sube`/`depo` üçü birden "🏢 Merkez/Şube" görünüyordu, artık
>   `ADRES_TIP_ETIKETI` ile ayrı ayrı gösteriliyor.
> - Boş bırakılan opsiyonel alanlar gövdeye **hiç konmuyor** (boş string zod'un
>   `max`/`email` kontrollerine takılıyordu).
>
> **Yol üstünde düzeltilen UX hatası:** `detayAc` her tazelemede
> `setAktifSekme("genel")` yapıyordu — alt formdan kayıt eklenince kullanıcı
> Genel Bakış'a fırlıyor, eklediğini göremiyordu (banka hesaplarında da
> vardı). Artık `detayAc(id, sekmeyiKoru)`; alt form çağrıları sekmeyi korur,
> listeden açış eskisi gibi Genel Bakış'a döner.
>
> **Uçtan uca doğrulandı (2026-08-05, tarayıcı + API):** adres ekleme (depo/şube
> tipleri, posta kodu), kişi ekleme, her ikisinin silinmesi (DELETE → 204, tablo
> anında güncelleniyor), sekmenin korunması; başka cariye ait id ile silme 404,
> silinmiş kaydı tekrar silme 404.
>
> **S-01 kararları (2026-08-05, kullanıcı onayladı):**
> - Kapsam **Ekle + Sil**; düzenleme (PATCH) yok — cari modülünde başka hiçbir
>   alt kayıtta (banka, etiket) düzenleme yok, desen bozulmasın. Yanlış kayıt
>   silinip yeniden eklenir.
> - **Manuel cari hareket girişi kapsam dışı** (`POST /cari/:id/hareketler`
>   backend'de duruyor ama UI'ı yok): ekstre salt-okur kalır, hareketleri
>   fatura/tahsilat üretir; elle borç/alacak girişi muhasebeyi bozma riski
>   taşıyor ve hiçbir İSTER maddesi talep etmiyor.

## 6. Fatura & e-Belge Tamamlama — ✅ TAMAM (6a 2026-07-16, 6b 2026-08-05) · Efor: Orta→Büyük

### 6a — ✅ TAMAM (2026-07-16, `cfb6944`)

> `/panel/ayarlar/fatura-serileri` (FTR-06): liste + ekleme, sıradaki numara
> önizlemesi (SERİ+YIL+9 hane). Fatura listesine "✉️ E-posta" (`pdf-gonder`;
> adres boşsa cari kartındaki kullanılır — Mailpit ile doğrulandı) ve
> "➡️ Satışa Dönüştür" (yalnız proformada, FTR-09). Fatura formuna **Proforma**
> tipi eklendi (formda yoktu, yani FTR-09'un proforma açma tarafı hiç
> çalışmıyordu).
>
> Ayrıca fatura listesinde API ile uyuşmayan 4 alan düzeltildi (hepsi ekranda
> görünen hatalardı): `faturaNo`→`no` (kesinleşmiş fatura "(Taslak)"
> görünüyordu), `netTutar`/`kdvTutari`→`toplamMatrah`/`toplamKdv` ("NaN TL"),
> `ebelgeGonderimDurumu`→iç içe `ebelge:{durum,tur}` + BelgeDurum enum'u (sütun
> hep boştu), tip etiketi (proforma/iadeler "Alış" görünüyordu).

### 6b — ✅ TAMAM (2026-08-05): e-Belge gelen kutusu (EBLG-05 + EBLG-06)

> **Eklendi — backend:**
> - Şema `GelenEbelge` + `20260805182714_gelen_ebelge` migration (RLS politikası
>   dahil). `[tenantId, uuid]` teklik → tekrar çekimde yinelenmez; `faturaId`
>   unique ve FK `ON DELETE SET NULL`.
> - `ubl-oku.ts` — UBL-TR 1.2 okuyucu (`fast-xml-parser`, yeni bağımlılık).
>   Tolere edici: eksik alan varsayılana düşer, yalnız `Invoice` kökü yoksa
>   hata. Çoklu `PartyIdentification` arasından schemeID=VKN/TCKN olanı seçer;
>   UN/ECE birim kodlarını (C62→adet, KGM→kg…) sistem birimlerine çevirir;
>   iskontoyu `MultiplierFactorNumeric`'ten, KDV oranını `TaxSubtotal/Percent`
>   ya da `TaxCategory/Percent`'ten okur, yoksa tutardan türetir.
> - `mock-adapter.ts` artık 2 gerçek UBL-TR belgesi döner (biri TİCARİ 3 satır +
>   %10 satır iskontosu, biri TEMEL 1 satır); tarih `sonrasi`+1 gün — hem 30
>   günlük pencereye düşer hem deterministik kalır.
> - Servis: `gelenBelgeleriCek` **fatura üretmez**, kutuya yazar;
>   `gelenListele(durum?)`, `gelenGetir(id)` (ayrıştırma + eşleştirme önerisi),
>   `gelenOnayla(id, satirEslesmeleri)`, `gelenYanitGonder(id, kabul|ret,
>   gerekce)`.
> - Uçlar: `GET /ebelge/gelen[?durum=]` · `GET /ebelge/gelen/:id` ·
>   `POST /ebelge/gelen/:id/onayla` · `POST /ebelge/gelen/:id/yanit`
>   (`POST /ebelge/gelenleri-cek` davranışı değişti).
>
> **Eklendi — UI:** `/panel/fatura/gelen-kutusu` (menüde "📥 Gelen e-Belgeler").
> Liste (Onay Bekleyen / İşlenmiş / Reddedilen / Tümü) + "Entegratörden Çek";
> onay ekranında belge toplamları, cari kartı, EBLG-06 kabul/ret, satır
> eşleştirme tablosu (oto-eşleşme rozeti, canlı aramalı stok seçici, "Yeni Kart"
> formu). Yeni kart açılırken barkod ve tedarikçi ürün kodu da karta bağlanır ki
> bir sonraki fatura otomatik eşleşsin.
>
> **Fatura üretimi `FaturaService.olustur` üzerinden** yapılır (tek hesaplama
> yolu). Bunun için `EbelgeModule ↔ FaturaModule` çift yönlü `forwardRef`
> oldu; `EbelgeKuyrukService`'in `EbelgeService` enjeksiyonu da `forwardRef`
> istedi (üçlü require döngüsünde sınıf referansı tanımsız kalıyordu).
>
> **Kararlar/kurallar (koda yansıyan):**
> - Onay öncesi tüm satırlar eşleşmeli; eşleşmeyen varsa uç 400 döner.
> - Kabul/ret **yalnız TICARIFATURA** profilinde; ret gerekçe ister ve belgeyi
>   `reddedildi` yapar (artık faturaya işlenemez). İşlenmiş belge reddedilemez.
> - Cari yoksa onay anında `TED-<VKN>` kodlu tedarikçi carisi açılır.
> - Oluşan taslak fatura sonradan silinirse (`faturaId` NULL'a düşer) belge
>   **kendiliğinden onaya geri döner** — aksi hâlde kilitli kalıyordu.
> - Onay yanıtında `toplamFarki`: belge toplamı ile bizim hesabımız uyuşmazsa
>   kullanıcı uyarılır (mock belgelerde fark 0).
>
> **Uçtan uca doğrulandı (2026-08-05, tarayıcı + API):** çekim (2 belge) →
> tekrar çekimde yinelenmeme → 3 eşleştirme kaynağının üçü de (barkod, tedarikçi
> ürün kodu, ad) → eksik eşleşmeyle onay reddi → kabul yanıtı → faturaya işleme
> (6.072,00 ₺, 3 satır, tutarlar birebir) → tekrar onay 409 → ret akışı ve
> ret sonrası işleme reddi → fatura silinince belgenin onaya dönmesi.

**Neden büyüktü:** Bu bir "UI eksik" işi DEĞİLDİ — backend isteri karşılamıyordu.
1. **Onay kapısı yok.** `gelenBelgeleriCek` çektiği her belgeyi *anında* taslak
   alış faturasına çeviriyor; EBLG-05 "kullanıcı onayıyla işlenebilmelidir" der.
2. **Tutarlar sıfır.** Oluşan taslakta tüm toplamlar 0 ve satır yok; UBL XML
   `GelenBelge.xml` içinde duruyor ama ayrıştırılmıyor. Gelen belgeleri tutacak
   tablo da yok (`EbelgeKayit` giden faturaya bağlı, `faturaId` unique).
3. **EBLG-06 (kabul/ret) hiç yok.** Adaptörde `yanitGonder` var; servis/uç/ekran
   yok. [Z] madde.
4. **`FaturaSatir.stokId` zorunlu** ve kesinleştirmede her satır stok hareketi
   yazıyor (`fatura.service.ts` kesinlestir) → gelen faturanın satırları bizim
   stok kartlarımıza bağlanmak zorunda.

**S-01 kararları (2026-07-16, kullanıcı onayladı):**
- Gelen akış: **onay kapısı + XML ayrıştırma** (tam çözüm; EBLG-05'i karşılar).
- **EBLG-06 kabul/ret Paket 6b'ye dahil.**
- Stok eşleştirme: **onay ekranında eşleştir** — sistem otomatik dener (barkod →
  `StokTedarikci.tedarikciUrunKodu` (STK-18) → ad); eşleşmeyenleri kullanıcı
  seçer ya da yeni kart açar. Hepsi eşleşmeden "Faturaya İşle" açılmaz.

**Açık kalan (v1.0 sonrası):** Satır birimi ile stok kartının ana birimi
farklıysa miktar dönüştürülmez — `FaturaSatir.birim` etikettir, kesinleştirmede
`miktar` doğrudan ana birim sayılır (mevcut fatura modülü semantiği). Onay
ekranı farkı **rozetle uyarır**, kullanıcı düzeltir. Gerçek entegratöre
geçildiğinde (Entegratör Paketi) UBL okuyucu gerçek belgelerle tekrar
sınanmalı — mock belgeler bizim ürettiğimiz şemayı izliyor.

## 7. Ayarlar Altyapısı — ✅ TAMAM (2026-07-15) · Efor: Orta

> Eklendi: `/panel/ayarlar/moduller` — jenerik tipli form; kayıtlı 5 modül
> (arayuz, cari, stok [STK-17 eksi stok politikası dahil], fatura, kasaBanka)
> `GET/PUT /ayarlar/:modul` üzerinden düzenlenir. Alan tanımları frontend'de
> deklaratif. Menüye "Modül Ayarları". Doğrulandı.


Modül bazlı yapılandırılabilir ayar deposu (AYR-01/02/03). Backend'de ortak
ayar altyapısı var, hiçbir ayar sayfası bunu kullanmıyor.

**Uçlar:** `GET /ayarlar` · `GET/PUT /ayarlar/:modul`

**Yapılacak UI:** Her modül için ayar sayfası (Fatura: seri/varsayılan KDV;
Stok: **eksi stok politikası STK-17**, kritik seviye; Cari: varsayılan vade/döviz;
Kasa/Banka: varsayılan kasa/fiş no) + Sistem Ayarları (global). Şema-güdümlü
ortak ayar bileşeni.

**Ek küçük iş:** `POST /raporlar/:kod/pdf` — rapor panelinde yalnız Excel butonu
var; PDF butonu eklenebilir.

---

## Zaten UI'da kapsanan (sınır — bunlar tamam)

Cari (liste/detay/ekstre/kopyala/excel/etiket/banka), Stok (liste/oluştur/
kopyala/excel), Fatura (oluştur/kesinleştir/kopyala/sil/PDF/e-belge sorgula),
Kasa & Banka (kasa/banka/fiş/virman), Raporlar (RPR-06 araç seti + Excel),
Fiyat Listeleri (yeni), Firma ayarları, Entegratör ayarları (test/aktif-et),
Denetim İzi, Auth (giriş/kayıt/doğrula), Finansal Özet.

## Önerilen sıra

Değer/görünürlük ve bağımlılığa göre: **2 (Kullanıcı & 2FA — güvenlik/temel) →
7 (Ayarlar altyapısı — diğer modüller buna dayanır) → 1 (Belge Zinciri — en
büyük işlevsel boşluk) → 4 (Stok detay) → 3 (Çek & Senet) → 6 (Fatura/e-Belge
tamamlama) → 5 (Cari detay — en küçük, ara doldurma).**

> Alternatif: en büyük tek işlevsel boşluk olduğu için **1 (Belge Zinciri)** ile
> başlanabilir. Karar S-01 kapısında verilir.

İlgili: [[modul-onay-kapisi]] · [[tasarim-sistemi]]
