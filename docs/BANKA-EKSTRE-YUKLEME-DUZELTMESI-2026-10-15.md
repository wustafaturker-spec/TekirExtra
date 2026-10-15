# Banka ekstresi yüklemede Failed to fetch — 15 Ekim 2026

Ekstre yükleme bileşeni ortak API istemcisini kullanmıyordu. Kendi `fetch` yardımcısı, `NEXT_PUBLIC_API_URL` yokken `http://localhost:3001/api/v1` adresine gidiyordu. Çalışan eski web'in `.next/static/chunks/app/panel/kasa-banka/ekstre/page-8d2f75483f833909.js` dosyasında da bu sabit adres doğrulandı. HTTPS/tünel veya başka cihaz kullanımında tarayıcı kendi localhost'una doğrudan bağlanmaya çalışabilir; genel liste API'si çalışırken dosya yüklemesi `Failed to fetch` ile kesilebilir. İnceleme anında API hazırdı; kullanıcı dosyasının içeriği okunmadı.

`ekstre-yukleme.tsx` içindeki özel URL/fetch yardımcısı kaldırıldı. Önizleme ve aktarım mevcut ortak `api()` istemcisiyle FormData gönderir. Varsayılan yol uygulamayla aynı origin'deki `/api/v1` olur; Next mevcut rewrite üzerinden API'ye iletir. Multipart boundary tarayıcı tarafından kurulur. Ortak istemcinin access token yenilemesi, Idempotency-Key ve Türkçe bağlantı/sunucu hata işleme davranışları kullanılır. API iş kuralları ve ekstre ayrıştırıcısı değiştirilmedi.

## Doğrulama

`NEXT_DIST_DIR=.next-ekstre-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build` başarılı; tür kontrolü ve 130 sayfanın üretimi tamamlandı. Mevcut CSS `end`/`flex-end` uyumluluk uyarıları derlemeyi engellemedi.

Yeni üretim derlemesi, 3103 portunda ayrı Next ve Chromium ile test edildi:

```bash
EKSTRE_TEST_DIST=.next-ekstre-release-20261015 pnpm exec playwright test --config playwright.ekstre.config.ts
```

Üç test geçti:

- Önizleme ve aktarımın aynı origin'de multipart gönderilmesi; 401 → token yenileme → aynı dosya ve aynı istek anahtarıyla tekrar; aktarımın yalnız düğmeye basıldıktan sonra bir kez yapılması.
- Sunucunun dosya doğrulama hatalarının gösterilmesi ve aktarımın başlamaması.
- Bağlantı kesilmesinde Türkçe hata ve otomatik tekrar yapılmaması.

API isteklerinin tamamı tarayıcıda yakalanıp sentetik yanıtlarla karşılandı; gerçek banka hareketi eklenmedi. Gerçek dosyanın ayrıştırılması veya banka kayıtlarının muhasebeleştirilmesi bu tarayıcı kabulünün kapsamı değildir. `git diff --check` temiz.

## Yerel uygulama — 09:33–09:34 İstanbul

Yeni web ayrı klasörde hazırlandı; önceki `.next` klasörü korundu. Geçiş öncesi Next PID `26636` komut/çalışma dizini/başlama kimliği ve seçilmiş derleme dosyalarının SHA-256 değerleri doğrulandı. Yalnız bu web süreci SIGTERM ile kontrollü kapatıldı. Ortam değişkenleri yalnız bellekte korunup aynı Node executable ile yeni Next'e aktarıldı; değerler yazdırılmadı veya dosyaya kaydedilmedi.

- Yeni web PID `118322`, başlangıç 09:33:20; login HTTP 200 ve sunulan ekstre JS dosyasının yeni yerel derlemeyle eşitliği 09:33:25'te doğrulandı.
- Build ID: `r3wN-8aJvP9uk2jz3B81Y`; klasör `.next-ekstre-release-20261015`.
- Ekstre dosyası: `page-ffd24570b6d6c9dd.js`; SHA-256 `3395cc98148da1a41d79799284446b4cad4f4e24d3de273410e0dba0f2a84c03`.
- Son kontrol 09:34:00: web `/giris` HTTP 200; web üzerinden kimliksiz multipart `POST /api/v1/kasa-banka/ekstre/onizle` HTTP 401 (proxy API'ye ulaşıyor, yetkisiz yükleme reddediliyor); API ready ve DB/Redis/depo ok; worker ready.
- API PID `102153` ve worker PID `102264` değişmedi; bu işte yeniden başlatılmadılar. Migration, manuel banka kaydı veya dış AI çağrısı yapılmadı.

Manifest, kontrollü geçiş/sağlık hatasında geri dönüş betiği ve özel günlükler `/tmp/tekirextra-ekstre-yayin-qIU6uC` içinde. Eski `.next` klasörü geri dönüş için mevcut; `/tmp` kalıcı yedek değildir. Geri dönüş gerekmedi. Derleme mevcut çalışma ağacını kapsar; temiz bir commit paketi değildir. Kullanıcı açık sekmeyi tam yenileyip kendi dosyasıyla tekrar deneyebilir; gerçek dosya kullanıcı kabulü henüz görülmedi.
