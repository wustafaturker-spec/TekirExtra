# Firma içi yetki taraması

Tarih: 2026-11-02. Taranan sürüm: `dead32a` (paket `kiraci-bag-20261103`). Durum: **düzeltildi (SEC-18).**

## Çalıştırma

```
cd apps/api
IDOR_ASAMA=rol node scripts/idor-kabul.mjs <derlenmiş-runtime-dizini> <rapor-dizini>
```

`IDOR_ASAMA=rol-dogrula` yalnız bulguların uçtan uca kanıtını çalıştırır. Ortam IDOR taramasıyla aynıdır: internetsiz Docker ağı, geçici veritabanı. Rapor `<rapor-dizini>/rol.json`.

## Yöntem

Aynı kiracıda 13 rol, hepsi kapalı bir özel rol ve denetim için yönetici. 360 okuma ve 553 yazma ucu her aktörle denenir (37.953 istek). Kaydedilenler: uç × rol durum matrisi, her rolün yanıtında görünen model alanları, rol başına 34 raporun çalıştırılması, salt okunur rollerde şemadan üretilen gövdeyle gerçek yazma, 46 sahipli modelde başkasının kaydına gerçek kimlikle istek ve satır karşılaştırması.

## Bulgular

| No | Önem | Bulgu | Kanıt |
|---|---|---|---|
| Y-1 | Yüksek | Özel rol kendini yükseltebiliyor: `ozel-roller` hiçbir yetki modülüne bağlı değil, yönetici şablonlu özel rolün kutuları bu ucu kapatmıyor. | Hepsi kapalı rol: `GET /cari` 403 → `PATCH /ozel-roller/:id` 200 → `GET /cari` 200; `POST /kullanicilar` 403 → 400 (uca ulaşıyor). |
| Y-2 | Orta | Ekler rol denetimsiz: `GET /ekler` ve `/ekler/:id/indir` yalnız `personel` ve `ai_sohbet` sahiplerini denetliyor. | Kalite, üretim operatörü, İK, depo: fatura, masraf, cari, kasa-banka eklerini listeledi. İndirme, dosya deposu olmadığı için canlı denenmedi; aynı denetimi kullanıyor. |
| Y-3 | Orta | `GET /pazaryeri/siparisler` bütün personel rollerine açık; müşteri adı, telefon, TCKN/VKN, adres ve ham sağlayıcı verisi dönüyor. Ekran yalnız muhasebe menüsünde. | Üretim operatörü, kalite, İK yanıtında alanlar görüldü. |
| Y-4 | Orta | `GET /cari/:id/crm` bütün personel rollerine açık; görüşme notları dönüyor. Ekran yalnız satış menüsünde. | Üretim operatörü, kalite, İK, depo 200. |
| Y-5 | Düşük | `duzeltmeler`, `ekler` özel rol kutularından etkilenmiyor. | Hepsi kapalı rol düzeltme kaydı okudu ve değiştirdi. |
| Y-6 | Düşük | `POST /bildirimler/tara` çalışan ve B2B bayi dahil herkese açık; firma geneli tarama başlatıyor. | Yazma matrisi. |

## Düzeltmeler (SEC-18)

- **Y-1:** `ozel-roller` ayarlar modülüne bağlandı. Ayrıca özel rollü kullanıcı `ozel-roller` ve `kullanicilar` uçlarında hiç yazamaz; kutuları açık olsa da kendini ya da başkasını yükseltemez.
- **Y-2, Y-5:** ek uçları sahibin ekranını kullanan rollere ve sahibin modül kutusuna bağlı (`EK_ERISIMI`). `duzeltmeler` dönem kapatma modülüne bağlandı. `yetki-modulu-kapsami.test.ts` modülsüz yeni denetleyiciyi yakalar.
- **Y-3:** sipariş listesi yönetici ve muhasebe.
- **Y-4:** `cari/:id/crm` yönetici, muhasebe, satış, salt okunur. Mali müşavir Cari ekranına girer ama CRM notlarını görmez; ekran bu boşluğa hazır.
- **Y-6:** kök neden, dar rollerin açık hesap yolu listesinin `@Roller` kısıtını ezmesiydi; rollü uç artık açılmaz.
- **Politika:** `cari/:id` kişi ve banka hesapları yönetici, muhasebe, satış, salt okunur, mali müşavir dışında boş döner. Üretim maliyet raporu operatör, kalite ve depoya kapalı. Özel rolde `ayarlar.goruntule` denetim izi ve e-posta geçmişini kapatır.

İK özlük ekleri: ekran indirmeyi `/ekler` üzerinden yapıyordu, İK 403 alıyordu. İK bu kurala eklendi.

## Temiz çıkanlar

- Parola özeti, TOTP sırrı, token ve şifreli bağlantı ayarı hiçbir rolün yanıtında yok.
- Salt okunur ve mali müşavir: şemalı gövdeyle yalnız kendi hesabına ait işlemler geçti (bildirim tercihi, sohbet, geri bildirim, mevzuat talebi); 31 uç sonuçsuz.
- Çalışan yalnız kendi kartını gördü, başkasının pusulası 404. Bayi yalnız kendi carisini gördü.
- Rapor listesi ile rapor çalıştırma tüm rollerde tutarlı (uyumsuzluk 0).
- Başkasının sohbeti, MCP anahtarı, onay talebi, rapor görünümü ve aboneliği değiştirilemedi.

## Kapsam sınırları

Token doğrudan imzalandı, giriş akışı sınanmadı. Xlsx/PDF içerikleri ve dosya deposu taranmadı. 22 model tohumlanamadı. Politika için tek kaynak web menüsü (`rol-yetkileri.ts`) ve 2026-10-28 raporu; yazılı bir yetki matrisi yok.
