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

## Son durum (2026-07-15)

**Bitti:** Paket **2** (Kullanıcı & 2FA), **7** (Modül Ayarları), **1** (Belge
Zinciri) — hepsi uçtan uca doğrulandı. Ayrıca öncesinde UI redesign, 2 hata
düzeltmesi ve Fiyat Listeleri modülü.
**Sıradaki (başlanmadı):** Paket **4** (Stok Detay) → **3** (Çek & Senet) →
**6** (Fatura/e-Belge tamamlama) → **5** (Cari detay ekleme formları).
> Paket 4 için henüz kod yazılmadı; ekran planı §4'te. Devamda buradan başla.

## Özet tablo

| # | Paket | Kapsanan İSTERLER | Backend | UI | Efor |
|---|---|---|---|---|---|
| 1 | Belge Zinciri | FTR-12, FTR-13 | ✅ | ✅ **Tamam (2026-07-15)** | **Büyük** |
| 2 | Kullanıcı & Yetki + 2FA | KLN-01/02/05 | ✅ | ✅ **Tamam (2026-07-15)** | Orta |
| 3 | Çek & Senet | KSB-05 | ✅ | ❌ Yok | Orta |
| 4 | Stok Detay & Alt-yapılar | STK-02/06/09/10/15/18/20 | ✅ | ❌ Yok | **Büyük** |
| 5 | Cari Detay Tamamlama | CARI-09/15 | ✅ | ⚠️ Kısmi (salt-okur) | Küçük |
| 6 | Fatura & e-Belge Tamamlama | FTR-06, EBLG-05 | ✅ | ⚠️ Kısmi | Orta |
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

## 3. Çek & Senet — *ekran yok* · Efor: Orta

Portföy/ciro/tahsil/karşılıksız takibi (KSB-05). Backend hazır.

**Uçlar:** `GET/POST /kasa-banka/cek-senet` · `GET/PATCH /kasa-banka/cek-senet/:id`

**Yapılacak UI:** Kasa & Banka altında "Çek & Senet" sekmesi ya da ayrı sayfa —
çek/senet listesi (durum rozetleriyle), giriş formu, durum güncelleme
(tahsil/ciro/karşılıksız).

## 4. Stok Detay & Alt-yapıları — *ekran yok* · Efor: Büyük

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

## 6. Fatura & e-Belge Tamamlama — *kısmi* · Efor: Orta

**Uçlar:**
- `GET/POST /fatura/seriler` — numaralandırma serisi yönetimi (FTR-06 / AYR-01)
- `POST /fatura/:id/pdf-gonder` — faturayı e-posta ile gönder
- `POST /fatura/:id/satisa-donustur` — alış→satış dönüştürme
- `POST /ebelge/gelenleri-cek` · `POST /ebelge/gonder/:faturaId` — gelen e-Fatura
  çekme ve alış faturasına işleme (EBLG-05); şu an yalnız `sorgula` kullanılıyor

**Yapılacak UI:** Fatura ekranına seri yönetimi (ayar), "E-posta Gönder" ve
"Satışa Dönüştür" butonları; **e-Belge gelen kutusu** ekranı (gelenleri çek →
onayla → alış faturası).

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
