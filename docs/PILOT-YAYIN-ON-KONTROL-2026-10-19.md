# Pilot ve yayın ön kontrolü — 19 Ekim 2026

Kullanıcı pilot/yayın hazırlığına devam edilmesini istedi. Önceki hedef TEKİR EKTRA ÖN MUHASEBE, `admin@tekirextra.local`, `localhost:3100`. Güncel hedef teyidi soruldu; henüz yanıt alınmadı.

## Güncel doğrulama

- `node scripts/cekirdek-servis-dogrula.test.mjs`: 7 test geçti.
- `node scripts/cekirdek-servis-kabul-ozetle.mjs .release-candidates/cekirdek-aday-20261018-3`: başarılı. Bu işlem önceki 17 servis kontrolünün kanıt bütünlüğünü yeniden doğruladı; servis provasını yeniden çalıştırmadı.
- Aday: `f02-20261018T104407891Z-fe2dc94f`; web BUILD_ID: `aIwge1an3oYs0FjsNT3FB`.
- Aday kaynak özeti: `2ac7314b5e4ed3166d2fcab546b4bc6cdc331293fd7db0f02db2b64b494c9bef`.
- Aday kaynak envanteri ile güncel kaynak envanteri arasında 110 dosya farkı var. Bu sayı uygulama değişiklikleri yanında test ve işletim betiklerini de kapsar; 110 işlev değişikliği anlamına gelmez. Şema, migration, kimlik doğrulama, API/web ve bağımlılık farkları bulundu. Önceki adayın kabulü güncel kaynaklara aktarılamaz.
- [Kaynak fark raporu](../.release-candidates/pilot-yayin-20261019/kaynak-farklari.json) kaydedildi.
- `docker ps` çalışan konteyner göstermedi. Yerel PostgreSQL, Redis, MinIO ve Mailpit durmuş durumda. API/web/worker için durmuş veya oluşturulmuş konteynerler mevcut; dağıtım kimlikleri incelenmedi.
- `127.0.0.1:3100/` ve `127.0.0.1:3001/health` bağlantıları kurulamadı. Mevcut yerel hedef çalışır durumda değil.

## Devam sırası

1. Yerel hedef veya başka sunucu adresini netleştir.
2. Seçilen hedefte mevcut paket, kalıcı hacimler ve yapılandırmayı gizli değerleri rapora almadan incele. Önceki şirket/pilot ayarlarının güncel durumunu salt okunur doğrula.
3. Güncel hedef yedeğini al; ayrı ortamda geri yükleme ve yeni migration uyumunu doğrula. 16 Ekim yedeği güncel yedek yerine geçmez.
4. Yayınlanacak kaynak kimliğini sabitle; güncel kaynak seçilirse yeni API/web/runtime paketi ve uygun kabul kontrollerini üret. Eski adayın testleri yeni paketin kabulü değildir.
5. Geçiş, servis açılışı, sağlık ve aynı origin API kontrollerini somut paket üzerinden yürüt. Otomasyon ve bildirim ayarlarını ayrıca değerlendir.
6. Doğal iş örneğini ve alan kabulünü kullanıcıyla kaydet; sahte şirket işlemi oluşturma. Kalıcı servis/reboot ve uygun önceki sürüme dönüş açıklarını hedef üzerinde kapat.

Bu ön kontrolde servis başlatılmadı; gerçek şirket verisi, migration veya pilot ayarı değiştirilmedi. Yayın yapılmadı; REL kabul kapıları kapatılmadı.

## 5 Kasım 2026 güncellemesi

Yerel pilot hedefi daha sonra `localhost:3100` olarak açıldı ve `.release-candidates/platform-duyuru-pilot-20261105` paketiyle güncellendi. Duyuru sisteminin sekiz migration'ı uygulandı; toplam 344 migration güncel. Duyuru öncesi tam veritabanı yedeği alındı ve gzip bütünlüğü doğrulandı. API, web, worker ve söz hatırlatma servisi healthy; API readiness 200. Ayrıntı: [duyuru pilot yayın kaydı](PLATFORM-PILOT-YAYIN-2026-11-05.md).

Bu güncelleme yalnız yerel pilot hedefini doğrular. Uzak üretim host'u veya erişim yapılandırması bu ortamda bulunmuyor; önceki hedef seçimi açık kalıyor. Platform yönetici oturumuyla doğal duyuru akışı kabulü yapılmadı. Uzak yayın ve gerçek kullanıcı kabulü için hedef ve yetkili operatör oturumu gerekir; bunlar olmadan başka hedefe bağlanılmadı.
