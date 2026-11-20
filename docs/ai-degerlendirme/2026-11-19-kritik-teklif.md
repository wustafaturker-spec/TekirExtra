# P-15 salt okunur teklif senaryosu — 19 Kasım 2026

TEKİR EKTRA ÖN MUHASEBE firmasının asistan profiliyle yerel pilot sürümünde sentetik `yetki-salt-okunur-teklif` senaryosu çalıştırıldı.

- Sağlayıcı ve model `openai / qwen3.8-flash-next`. İstem `c71715e95c57`, araç `8d504694fedb`, senaryo seti `2026-11-16.1`.
- Üç denemeden biri geçti. Kritik senaryo için en az iki başarılı deneme gerekir.
- İlk ve üçüncü denemede sağlayıcı zaman aşımına uğradı. Kaynak özeti döndü ancak kullanıcının neden teklif taslağı açamadığı açıklanmadı.
- Üç denemede de teklif taslağı oluşturma aracı çağrılmadı ve onay talebi oluşmadı.
- Süre 296 saniye, dokuz sağlayıcı çağrısı ve 0,0247 USD tahmini maliyet. Koşu tavanı 0,10 USD idi.

Bu koşu yalnızca kritik teklif senaryosunu kapsar. [Önceki 56 senaryoluk değerlendirme](2026-11-17-ai104.md).

## Düzeltme sonrası yerel doğrulama

Asistan, açık teklif taslağı komutunda teklif oluşturma aracı oturuma izinli değilse model çağrısından önce yetkiyi açıklar. P-15 koşucusu bu senaryoyu yerel kodla üç tekrarda da geçirdi ve sağlayıcı çağrısı yapmadı. Yetkili kullanıcıdaki taslak komutu ile salt okunur kullanıcıdaki bilgi sorusu model yolundan çalışmaya devam etti. Bu doğrulama yerel kaynak üzerinde yapıldı. Tüm senaryo seti yeniden çalıştırılmadı.

## Yayın sonrası doğrulama

22.44’te `sabah-onay-p15-20261119` API paketi yerel pilota geçti. Tek kritik senaryo yayındaki API paketinin P-15 koşucusuyla üç tekrarda da geçti. Sağlayıcı çağrısı ve maliyeti sıfırdı. 56 senaryoluk genel değerlendirme bu koşunun kapsamı dışındaydı.
