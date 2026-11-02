# Kiracılar arası erişim (IDOR) taraması

Tarih: 2026-11-02. İlk taranan sürüm: `f3ea57f`.

## Çalıştırma

```
cd apps/api
node scripts/idor-kabul.mjs <derlenmiş-runtime-dizini> <rapor-dizini>
```

`IDOR_ASAMA=okuma` yalnız okuma aşamalarını, `IDOR_ASAMA=govde` yalnız gövde aşamasını çalıştırır. Rapor `<rapor-dizini>/sonuc.json`.

Derlenmiş API, geçici PostgreSQL ve Redis internete çıkışı olmayan ayrı bir Docker ağında çalışır. Ortam değişkenleri tek tek verilir, canlı ayar okunmaz, kaplar sonunda silinir. `zod-kayit.cjs` yalnız bu kapta yüklenir; uygulama kodu değişmez.

## Yöntem

Prisma şemasından iki kiracı (A, B) tohumlanır. A'nın `yonetici` token'ıyla B'nin kimlikleri denenir:

1. Yolda B kimliğiyle bütün okuma uçları.
2. A'nın kendi kimlikleriyle denetim: uca gerçekten ulaşıldığının kanıtı.
3. Listelerde sorgu parametresiyle B kimliği.
4. Yolda B kimliğiyle bütün yazma uçları (boş gövde).
5. Doğrulama şemasından üretilen geçerli gövdede kimlik alanları tek tek B'ye çevrilir.
6. Kurulan bağlardan sonra okuma uçları yeniden taranır.

Dedektörler: yanıtta B'nin işareti ya da gönderilmemiş kimliği, rastgele kimlikte başarısız olup B kimliğinde başarılı olan istek, B satırlarının özetindeki değişiklik, kiracıları farklı olan yabancı anahtar bağı. Koşu başında öz denetim bu dedektörlerin bilerek oluşturulan sorunları gördüğünü doğrular.

## Sonuç

- **Veri sızıntısı yok:** B'nin verisi A'ya dönmedi, B'nin satırı değişmedi. Son tam koşu 130.348 istek.
- **Doğrulanmayan yabancı kimlik (giderildi):** RLS okumayı engelliyor ama yabancı anahtar denetimi RLS'ye tabi değil. Aşağıdaki uçlar başka kiracının kimliğini kabul edip kiracılar arası bağ kuruyordu.

| Uç | Alan | Tablo.sütun |
|---|---|---|
| `POST /cari` | `fiyatListesiId` | `cari_hesaplar.fiyat_listesi_id` |
| `POST /stok` | `kategoriId` | `stok_kartlari.kategori_id` |
| `POST /stok/:id/tedarikciler` | `cariId` | `stok_tedarikcileri.cari_id` |
| `POST /belgeler` | `satirlar[].stokId` | `belge_satirlari.stok_id` |
| `POST /projeler` | `cariId` | `projeler.cari_id` |
| `POST /personel/izinler/bakiye-hareketleri` | `personelId`, `izinTuruId` | `personel_izin_bakiye_hareketleri` |
| `PUT /personel/organizasyon/personeller/:id` | `pozisyonId` | `personel.pozisyon_id` |
| `PATCH /masraflar/:id` | `cariId` | `masraflar.cari_id` |

Saldırganın karşı kiracının kimliğini bilmesi gerekiyordu (UUID, tahmin edilemez); B'nin verisi okunamıyordu.

## Düzeltme

Göç `20261103090000_kiraci_bag_denetimi`: `kiraci_bag_denetle()` tetikleyicisi, kiracılı iki tablo arasındaki her tek sütunlu yabancı anahtarda üst kaydın aynı kiracıda olmasını ister. Aykırılık yabancı anahtar hatasıdır (P2003), API 400 döner; "başka kiracıda" ile "hiç yok" ayırt edilemez. Bileşik anahtarlar `tenant_id` içerdiği için zaten güvenlidir. Yeni anahtar eklenip tetikleyici unutulursa `test/rls-kapsama.kabul.test.ts` düşer.

Düzeltme sonrası tam koşuda kiracılar arası bağ 0. Yazma maliyeti (ölçüm: 9 dolu yabancı anahtarlı tablo, 5.000 satır) satır başına 0,3 ms'den 1,5 ms'ye; boş anahtarlar tetikleyiciyi çalıştırmaz.

Geri alma: tetikleyiciler `DROP TRIGGER`, işlev `DROP FUNCTION kiraci_bag_denetle()`.

## Kapsam sınırları

- Rol `yonetici`; firma içi yetki ve kullanıcılar arası erişim bu taramada yok.
- Gövde aşamasında 314 denemenin 262'sinde A'nın kendi kimliğiyle yapılan denetim de geçmedi; bu denemeler sonuçsuz. 208 yazma ucunda şema alınamadı. Tetikleyici bu uçları da kapsar; ancak yabancı anahtarı olmayan alanları kapsamaz.
- 22 model tohumlanamadı (ör. `PosHesap`, `PosTahsilat`, `OdemeSozu`, `FaturaKapama`, `TahsilatTakibi`).
- 139 okuma ucunda denetim 2xx dönmedi (24'ü platform ucu).
- Zip/xlsx ve PDF içerikleri taranmadı. Dosya deposu (MinIO) test ortamında yok.
- JSON içine gömülü, yabancı anahtarı olmayan kimlikler bağ denetiminde görünmez (ör. bağlantı ayarındaki `config.bankaHesapId`). `tenants` tablosuna giden `faturalayan_tenant_id` ve `odeyen_tenant_id` bilerek kapsam dışı.
