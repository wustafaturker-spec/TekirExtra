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

## Son durum (2026-07-16)

**Bitti:** Paket **2** (Kullanıcı & 2FA), **7** (Modül Ayarları), **1** (Belge
Zinciri) — hepsi uçtan uca doğrulandı. Ayrıca öncesinde UI redesign, 2 hata
düzeltmesi ve Fiyat Listeleri modülü.
**Paket 4 (Stok Detay)** ve **Paket 3 (Çek & Senet)** tamamlandı (2026-07-16) —
hepsi tarayıcıdan uçtan uca doğrulandı. Paket 3'te KSB-05 backend'i de genişletildi
(tahsil → kasa/banka fişi; bkz. §3). S-01 kararları: sayımda tüm stok
listelenip fiili miktar girilir (boşlar gönderilmez); etiket basımı yalnız kart
detayından (liste toplu basım yok).

**Sıradaki: Paket 6b — e-Belge gelen kutusu** (§6'da tam plan ve S-01 kararları).
Backend isteri karşılamadığı için "UI eksik" değil, geliştirme işi: onay kapısı +
UBL ayrıştırma + stok eşleştirme + EBLG-06 kabul/ret. Sonra **5** (cari detay
ekleme formları) → UI Tamamlama kapsamı biter.

## Özet tablo

| # | Paket | Kapsanan İSTERLER | Backend | UI | Efor |
|---|---|---|---|---|---|
| 1 | Belge Zinciri | FTR-12, FTR-13 | ✅ | ✅ **Tamam (2026-07-15)** | **Büyük** |
| 2 | Kullanıcı & Yetki + 2FA | KLN-01/02/05 | ✅ | ✅ **Tamam (2026-07-15)** | Orta |
| 3 | Çek & Senet | KSB-05 | ✅ | ✅ **Tamam (2026-07-16)** | Orta |
| 4 | Stok Detay & Alt-yapılar | STK-02/06/09/10/15/18/20 | ✅ | ✅ **Tamam (2026-07-16)** | **Büyük** |
| 5 | Cari Detay Tamamlama | CARI-09/15 | ✅ | ⚠️ Kısmi (salt-okur) | Küçük |
| 6 | Fatura & e-Belge Tamamlama | FTR-06, FTR-09, EBLG-05/06 | ⚠️ 6b için eksik | ⏳ 6a tamam, 6b bekliyor | Orta→**Büyük** |
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

## 5. Cari Detay Tamamlama — *kısmi (salt-okur)* · Efor: Küçük

Cari detayda **Adresler** ve **İlgili Kişiler** sekmeleri var ama yalnız
**okuyor** — ekleme/silme formu yok. Banka hesabı ve etiket eklemede zaten var.

**Uçlar:** `POST /cari/:id/adresler` · `POST /cari/:id/kisiler` ·
`POST /cari/:id/hareketler` (manuel cari hareket)

**Yapılacak UI:** Adresler ve İlgili Kişiler sekmelerine **ekleme/silme formu**
(CARI-09/15); istenirse manuel cari hareket girişi.

## 6. Fatura & e-Belge Tamamlama — *6a tamam, 6b başlanmadı* · Efor: Orta→Büyük

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

### 6b — ⏳ BAŞLANMADI: e-Belge gelen kutusu (EBLG-05 + EBLG-06)

**Neden büyük:** Bu bir "UI eksik" işi DEĞİL — backend isteri karşılamıyor.
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

**Yapılacaklar:**
1. Şema: `GelenEbelge` (uuid, belgeNo, gonderenVkn, gonderenUnvan, tarih,
   xmlIcerik, durum: beklemede|islendi|reddedildi, faturaId?, yanit:
   kabul|ret?, yanitGerekce?) + migration. `[tenantId, uuid]` unique (tekrar
   çekimde yinelenmesin).
2. `ubl-oku.ts`: UBL-TR faturadan satırlar (ad, miktar, birim, birim fiyat,
   KDV oranı, iskonto) + toplamlar + ProfileID (TICARIFATURA/TEMELFATURA).
   Not: `xml-uretec.ts` üretim tarafı, örnek olarak bakılabilir.
3. `mock-adapter.ts` XML'i gerçekçi UBL-TR faturaya zenginleştir (şu an yalnız
   ID/IssueDate/VKN var; ayrıştırmayı uçtan uca denemek için gerekli).
4. Servis: `gelenBelgeleriCek` artık fatura ÜRETMEZ, `GelenEbelge` yazar;
   `gelenListele(durum?)`, `gelenOnayla(id, satirEslesmeleri)` (XML→satır+
   toplam, cari bul/oluştur, taslak alış faturası), `gelenYanitGonder(id,
   kabul|ret, gerekce)` (EBLG-06, adapter.yanitGonder).
   ⚠️ `ebelge.test.ts`'teki "gelenBelgeleriCek → fatura.create" testi bu
   değişiklikle güncellenmeli (test EBLG-08 diye etiketli ama EBLG-05'i test
   ediyor).
5. Uçlar + ekran: gelen kutusu listesi, onay/eşleştirme ekranı, Kabul/Ret.

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
