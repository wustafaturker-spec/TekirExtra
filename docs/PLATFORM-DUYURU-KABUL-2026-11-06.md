# Duyuru sistemi — pilot sonrası PostgreSQL kabulü

6 Kasım 2026: 2 dosyada 21 kabul testi gerçek PostgreSQL üzerinde geçti. Tüm migration zinciri yalnız bu koşuya ait geçici PostgreSQL konteynerine uygulandı. Pilot verisi ve yayın paketi değiştirilmedi; geçici konteyner koşu sonunda kaldırıldı.

```sh
node apps/api/scripts/platform-firma-kabul.mjs \
  test/platform-duyuru.kabul.test.ts \
  test/platform-duyuru-yayin.kabul.test.ts
```

## Doğrulanan kapsam

Önceki 16 senaryo taslak/geçmiş atomikliği, eşzamanlı düzenleme, arşiv değişmezliği, hedefleme, alıcı parmak izi, süreli önizleme, yayın zamanları, durdurma, güncel yetki denetimi ve benzersiz gösterim/okudum/tıklama metriklerini kapsar.

Eklenen 5 senaryo:

- Bir kez gösterim, yeni veritabanı bağlantısında korunur; başka kullanıcıyı etkilemez. Otomatik gösterim engellense de merkezden okuma ve okudum kaydı çalışır.
- Günde bir gösterim süresi dolana kadar tekrar engellenir; tekrar gösterim benzersiz kullanıcı metriğini artırmaz.
- Haftada bir gösterimde aynı süre ve metrik kuralları uygulanır.
- Popup erteleme/kapatma tercihleri yeni bağlantıda korunur. Tekrarlanan işlemler raporda kullanıcı başına bir kez sayılır; diğer kullanıcı etkilenmez. Durdurma sonrası tercih kaydı reddedilir.
- Popup tercihi hedef dışındaki kullanıcıya ve popup olmayan yayına kapalıdır. Tenant tercih tablosunu doğrudan okuyamaz; platform rolü doğrudan değiştiremez.

Süre dolumunu temsil eden doğrudan zaman değişikliği yalnız geçici veritabanının sahibiyle yapıldı; uygulamaya test saati veya yetki atlatma ucu eklenmedi. Test temizliği, gösterim/tercih kayıtlarının yabancı anahtar sırasını da kapsar.

## Kabul sınırı

Bu kontroller servisler ve gerçek veritabanı rolleri/RLS üzerinden yürür; giriş yapmış tarayıcıdan gerçek HTTP akışı yerine geçmez. Önceki [tasarım pilot yayını](PLATFORM-DUYURU-TASARIM-PILOT-2026-11-06.md) üretim paketinde 12 masaüstü/mobil tarayıcı senaryosu ve canlı sağlık/giriş kontrolleri içerir; o 12 senaryonun iş API yanıtları taklittir.

Sonraki doğrulamada üretim API/web paketleri ayrı PostgreSQL, Redis ve MinIO ile çalıştırılarak gerçek parola/TOTP girişi, görsel yükleme, yayın, hedef dışı erişim, etkileşim raporu ve durdurma 1440/390 px tarayıcılarda geçti. [Gerçek HTTP/tarayıcı kabulü ve paket kanıtı](PLATFORM-DUYURU-HTTP-TARAYICI-KABUL-2026-11-06.md).

İşletmenin gerçek pilot hesaplarıyla manuel kullanıcı kabulü açık kalır. Geniş DY planı bütünüyle kapatılmadı.

Makinece okunur kayıt: `.release-candidates/platform-duyuru-design-20261106/izole-postgres-kabul.json`.
