# Finans yolu senaryoları — 21 Kasım 2026

Yerel pilot `finans-duz-metin-20261121` API paketi (4341fc34), TEKİR EKTRA asistan profili. Kapsam: 2026-11-20 koşularında finans açıklaması yoluna (AI-98/103) giren 29 senaryo, `--paralel 2`, temel çizgiyle karşılaştırmalı.

Değişiklik: finans kaynağı tesadüfen alındığında (ör. kayıt aranırken `cari_ara` cari bakiyesini döndürür) modelin rakamsız düz metin yanıtı artık yalnız not olarak kabul edilir (`finansAciklama.duzMetin`). Rakam ya da yüzde içeren, 600 karakteri aşan, JSON denemesine benzeyen ya da uydurma işlem denetimine takılan metin eskisi gibi doğrulanmış kaynak özetine döner. Sözleşme istemine "soru tutar sormuyorsa olgu seçme, bulunmayanı açıkça söyle" eklendi.

Sağlayıcı/model: openai / qwen3.8-flash-next · istem 919719366e9b · araç c0fb259a2674 · set 2026-11-21.1
Maliyet: 0.4875 USD / tavan 2 USD · 139 çağrı · 564 sn

Geçen: 26/29 · kritik 13/14

| Kategori | Geçen |
|---|---|
| yetki | 6/6 |
| finans | 8/8 |
| arac_secimi | 5/5 |
| belirsizlik | 3/5 |
| hata_iptal | 4/5 |

## Hedef senaryolar

- **hata-olmayan-taslak-iddiasi** (kritik) 3/3 — 2026-11-20 tam koşuda 1/3. Yanıt "taslak bulunamadı" olarak korunuyor.
- **hata-telegram-onay** 1/1 — 2026-11-20'de 0/1. Senaryo kuralı AI-105 commit'inde (d142beed) istemle uyumlu hâle getirilmişti; bu koşuda doğrulandı.

## Geçmeyenler ve yeniden koşu

- **belirsiz-cari-teklif** (kritik) 1/3, **belirsiz-fatura-iptal** 0/1 — iki ayrı yeniden koşuda 3/3 ve 1/1 geçti (temel çizgide 0/3 ve 0/1). Düşen denemelerden biri rakamlı serbest metin (eski yol, güvenli özet), biri model sormadan "bulunamadı" dedi; değişikliğe bağlı gerileme görülmedi.
- **arayuz-form-yok** 0/1, yeniden koşuda 1/2 — düşen yanıtlar nedeni söylüyordu ("kayıt kesin durumda… yazamam", "yapamadım"); puanlayıcının ret kalıbında geçmiş zaman ve yazma/düzenleme fiilleri yoktu. Kalıp genişletildi, `degerlendirme.test.ts` ile sabitlendi; set 2026-11-21.2.
