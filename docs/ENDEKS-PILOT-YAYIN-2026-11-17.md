# Endeks tamamlaması — pilot yayını, 17 Kasım 2026

**Yayınlandı:** 2026-11-17 22:53:46 (Türkiye saati). **Paket:** `endeks-20261117`.

[Kaynak teslimi](ENDEKS-TAMAMLAMA-2026-11-17.md) pilotta etkinleştirildi. API ve web `.release-candidates/endeks-20261117` paketinden çalışıyor. Çalışan API sürümü `endeks-20261117 34d5b4a7`; paket, bu HEAD üzerindeki çalışma ağacı değişikliklerini içerir. Yeni bağımlılık eklenmedi. API üretim derlemesi, Next.js üretim derlemesi ve tip kontrolleri geçti. Web build kimliği: `V-dcck3GJxAGwp-4wu3qg`.

Paket ayrıntısı: [manifest](../.release-candidates/endeks-20261117/manifest.json). Önceki API `cari-adres-20261117/runtime`, önceki web `banka-ad-tutar-20261116/web` olarak korunuyor.

## Yedek ve migration

Yayın öncesi PostgreSQL yedeği: `backups/endeks-20261117-oncesi/tekirextra-20261117T194446Z.sql.gz` (yaklaşık 764 MB). `gzip -t` bütünlük denetimi geçti. Bu yayında yedekten geri yükleme yapılmadı.

Pilota uygulanan dört migration:

- `20261117210000_endeks_tamamlama`
- `20261117211000_onay_fiyat_islemi`
- `20261117212000_birim_tarihcesi_cascade`
- `20261117213000_fatura_birim_katsayi_kesinlesme`

Yayın sonrasında Prisma 406 migration için şemanın güncel olduğunu bildirdi; bekleyen migration yok.

## Yayın sonrası kontroller

- API, web, worker, Telegram ve ödeme sözü servisi `healthy`; yedekleme servisi çalışıyor ve ajan nabzı güncel.
- API `/health/ready` ve web `/giris`: HTTP 200.
- API endeks seçenekleri, platform endeksleri ve web üzerinden endeks seçenekleri oturumsuz istekte HTTP 401: erişim koruması sürüyor.
- Çalışan pakette `fiyat_listesi_guncelle` onay işlemi ve `USD_SATIS`/`EUR_SATIS` kur seçenekleri mevcut.
- İki yeni kiracı tablosunda RLS ve FORCE RLS açık; dört birim tetikleyicisi etkin. Platformun toplu sayım işlevini çalıştırma yetkisi var, ham kullanım tablosuna SELECT yetkisi yok.
- USD ve EUR satış serilerinin her birinde 121 aylık değer var; son dönem `2026-11-01`, çekim hatası yok.

| Kayıt | Yayın öncesi | Yayın sonrası |
|---|---:|---:|
| Fatura | 310 | 310 |
| Cari hareket | 544 | 544 |
| Stok hareketi | 729 | 729 |
| Özel rol | 0 | 0 |

Bunlar kayıt sayımı karşılaştırmalarıdır; bütün mali içeriklerin hash karşılaştırması değildir. Pilot üzerinde deneme faturası veya fiyat değişikliği/onay talebi oluşturulmadı; işlem senaryoları ayrı kabul veritabanında doğrulanmıştı.

Docker eski API, ödeme sözü ve yedekleme konteynerlerini kaldırırken geçici `Dead` durumu gözlendi. Compose yeniden oluşturmayı tamamladı; servisler açıldı ve sağlık denetimleri geçti. Önceki pakete dönüş gerekmedi.

## Geri dönüş

```sh
python3 scripts/pilot-yayin.py geri-don endeks-20261117
```

Bu komut uygulama paketlerini önceki sürüme geçirir; uygulanmış migration'ları ve veriyi geri almaz. Geri dönüş tanımı hazırdır; bu yayında geri dönüş provası yapılmadı.

Yayın betiğinde eski `.next`/e2e derlemelerinin üretilmiş rota türleri yalnız paket hazırlama sırasında dışarıda bırakıldı; kaynak tip denetimi korundu ve özgün `tsconfig.json` ile `next-env.d.ts` geri yüklendi.

## END-04 ek yayını, 18 Kasım 2026

`end04-20261118` paketi 08:45:26'da pilotta etkinleştirildi. API ve web üretim derlemeleri geçti. Web derleme kimliği `FU7cNMjga9TLH9K6RQmmK`. END-04 göçü önceki `telegram-dosya` API paketinde zaten bulunuyordu. Pilot veritabanında bekleyen göç olmadığı doğrulandı.

Docker eski konteynerleri kaldırırken API geçici olarak erişilemedi. Geçiş tamamlandıktan sonra altı servis sağlıklı duruma geldi. API `/health/ready` ve web `/giris` HTTP 200 döndü. Geri dönüş gerekmedi. Hedefli işlev testi ayrı kabul veritabanında yapıldı. [Paket manifesti](../.release-candidates/end04-20261118/manifest.json)

Yayın sonrası 26 endeks PostgreSQL kabul senaryosu ve 10 Görev Merkezi Chromium senaryosu geçti. Yeni tarayıcı senaryosunda örnek bir endeks revizyonu görevi yönetici ekranında açıldı ve “Oluşturan: Sistem” göründü. Pilot veritabanındaki salt okunur kontrolde END-04 tetikleyicisi etkindi ve açılmış revizyon görevi bulunmadı. Gerçek pilot görevinin yönetici ekranında görülmesi ilk kaynak revizyonunu bekliyor.
