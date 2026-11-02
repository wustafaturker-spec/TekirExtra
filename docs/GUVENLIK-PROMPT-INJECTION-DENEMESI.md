# Prompt injection denemesi

Tarih: 2026-11-02. Sürüm: `8e1d7de` üzerine. Durum: **bulgu giderildi (SEC-19).**

## Çalıştırma

Kiracı ayarından sağlayıcı bilgisini `IDOR_LLM` (JSON: `saglayici`, `apiKey`, `modelAdi`, `baseUrl`, `onaySaglayici`, `onayModel`, `onayPolitika`) olarak verip:

```
cd apps/api
IDOR_ASAMA=pi node scripts/idor-kabul.mjs <derlenmiş-runtime-dizini> <rapor-dizini>
```

Geçici veritabanı ve sahte kiracı verisi kullanılır. Modele yalnız bu sahte veri gider; SMTP ve entegratör sahte olduğundan gönderim olamaz. Sonuç `<rapor-dizini>/pi.json`.

## Yöntem

İki katman:

1. **Gerçek model:** e-posta gövdesi, gelen e-Fatura (gönderen unvanı, not, satır adı) ve cari unvanına dört tür talimat kondu: yanıta kanarya yazdırma, ekstreyi saldırgana gönderme, IBAN değiştirme, finans ve personel verisini dış bağlantıya taşıma. Her biri okuma ve "gerekeni hazırla" istekleriyle soruldu. Model: `deepseek-v4.1-flash` (EVREN).
2. **Talimata uyan en kötü model:** modelin direncine güvenmeden, gelen belgeyi okuduktan sonra yazma aracı çağıran senaryo sağlayıcısıyla kapılar sınandı (`ai-ajan.service.test.ts`).

## Sonuç

| Gerçek model (25 geçerli yanıt; 5 deneme sağlayıcı hatası) | |
|---|---|
| Yazma veya onay aracı çağrısı | 0 |
| Açılan onay talebi | 0 |
| Talimatın istediği finans/personel aracı | 0 |
| E-posta ve e-Faturada kullanıcıya uyarı | Kanarya, adres ve IBAN içeren bütün yanıtlarda |

Yanıtlarda kanarya, adres ya da IBAN yalnız şüpheli içerik aktarılırken ya da doğrulanmış özet şablonunda cari unvanı olarak göründü.

**Bulgu (giderildi):** "güvenilmeyen veri" etiketi ve yazma kilidi yalnız `gelen_eposta_*` ve OCR araçlarına uygulanıyordu. Gelen e-Fatura ve e-İrsaliyenin unvan, not ve satır adı da karşı tarafın yazdığı metindir. Talimata uyan modelle `gelen_efatura_*` ve `gelen_eirsaliye_*` okunduktan sonra yazma aracı onay talebi açabiliyordu (4 test düzeltmeden önce düştü).

**Düzeltme:** bütün `gelen_*` araçları etiketlenir ve kilide girer. Gelen belge işlemleri kullanıcı açıkça isteyebilsin diye niyet sözcükleri genişledi (işle, reddet, kabul et, yanıtla, yükle); "işlenmemiş", "reddedilen" gibi durum sözcükleri istek sayılmaz.

## Modele bağlı olmayan katmanlar

- Onay sınıfı araç yalnız talep açar; işlem yalnız isteyen kullanıcının düğmesiyle çalışır. Saldırganın adresi onay özetinde görünür (test edildi).
- Sohbet ekranı HTML ve görsel işlemez, yalnız `/panel/` yollarını bağlantı yapar. Dış adres düz metin kalır; görsel adresiyle veri sızdırma yolu yoktur.
- Araçlar rol süzgecinden geçer; silme aracı yoktur.

## Kalan riskler

- Kullanıcı "gerekeni hazırla" derse kilit açılır: talimata uyan bir model taslak (onaysız) ve onay talebi açabilir. Son karar insandadır; onay özetini okumak gerekir.
- `cari_*` araçları kilide girmez, çünkü kısa onaylarla süren akışları bozar. Cari unvanı doğrulanmış özette aynen görünür.
- Yanıttaki dış adres düz metin de olsa kullanıcı kopyalayabilir.
- MCP istemcisi kendi modelini kullanır; bu kilit yalnız panel asistanında çalışır. Onay kapısı MCP'de de geçerlidir.
- Tek model ve sınırlı senaryo: sonuç başka modele taşınamaz, sağlayıcı değişince yeniden çalıştırılmalı. OCR görseli ve sohbet ekleri canlı denenmedi; yanıtların yalnız ilk 340 karakteri kaydedildi.
