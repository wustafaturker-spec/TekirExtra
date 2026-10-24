# F04 yerel pilot hazırlığı — 23 Ekim 2026

F04 **yayına alınmadı**. Hazırlık sırasında başka bir oturum çalışan pilotu
`demirbas-butce-20261023` sürümünden `arac-yetki-20261023` sürümüne geçirdi.
Yeni özellikleri geri almamak için paket hazırlığının sürüm kontrolünde duruldu.
Canlı migration, mod değişikliği, kuyruk pause/resume veya uygulama durdurma
işlemi yapılmadı. Geçişe son çalışan sürüm temel alınarak devam edilmelidir.

## Tamamlanan doğrulamalar

- `backups/f04-yerel-20261023/postgres.dump`: 440.010.287 bayt PostgreSQL custom
  yedeği; dosya izni 600, üst dizin 700; Git dışında.
- Yedek ağ erişimi olmayan PostgreSQL 16 konteynerine `pg_restore --no-owner
  --exit-on-error` ile hatasız geri yüklendi. `tekir_app` ve `tekir_platform`
  rolleri önceden oluşturuldu.
- Üç F04 migration'ı yalnız geri yüklenen kopyada, tek transaction içinde
  uygulandı. Önceden bulunan migration geçmişi değiştirilmedi.
- Prova veritabanında 226 → 231 tablo; beş yeni tablonun tamamında
  `relrowsecurity` ve `relforcerowsecurity` etkin.
- Seçili kaynak kopyasında beş test dosyası, 114 test geçti: e-belge 75,
  tarihli ihtiyaç 23, üretim kaynağı 6, sipariş kaynağı 5, karşılama 5.
- API ve web derlemesi tamamlandı. Aday:
  `.release-candidates/f04-yerel-secili-kaynak-20261023/.release-candidates/f04-secili`.
  Web build: `p-qEKhcxfBqyxha-PmiEl`.
  Kaynak SHA-256: `e84a0972e44e0932c50564bbdf59945ff5f59dc0e6543e57f65417f433eafc92`.
  Paket SHA-256: `3aa34dd983e5732e1c7b0fd010a2d1e3be20127d80f6a42bc0ba8f11effe3c18`.

Bu adayın tabanı `991696e` commit'idir; yeni `arac-yetki` yayınının yerine
kurulmamalıdır. Daha önce üretilen `f04-yerel-guncel-20261023` adayı eşzamanlı
araç geliştirmesini içerdiğinden seçili yayın adayı olarak kabul edilmedi.

## Hazırlanan araçlar ve kalan işler

`scripts/f04-yerel-pilot-hazirla.py` mevcut çalışan Compose yolunu doğrular;
sağlık veya sürüm uyuşmazlığında sırları okumadan/paket oluşturmadan durur.
Hazırlanan migration aracı yalnız üç F04 dosyasını uygular. Operatör kabulü
kısa ömürlü token kullanır; gerçek parola ile giriş kabulü değildir.

Önce eşzamanlı yayınlar tamamlanmalı ve son sürüm sabitlenmeli. Sonra F04,
araç/yetki dahil yayındaki özellikleri koruyan yeni kaynağa birleştirilip
yeniden paketlenmeli. Yeni paket gerçek Node 22 ortamında doğrulanmalı,
güncel yedek alınmalı; kontrollü servis geçişi, pilot modu açılışı, tarayıcı
kabulü ve servis yeniden başlatma kontrolü yapılmalı. Hazırlanan systemd
taslağı kurulmadı. Canlı parola ile giriş veya host yeniden başlatma testi
yapılmadı.

Hazırlık için oluşturulan ek Docker ağı kaldırıldı; altyapı servislerinin bu
ağa ek bağlantıları temizlendi. `tekir-f04-yerel-restore-20261023` prova
konteyneri durduruldu, verisi ve yedek korundu.
