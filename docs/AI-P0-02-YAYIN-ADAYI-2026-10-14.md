# P0-02 — Yerel yayın adayı ve geçiş kontrol listesi

14 Ekim 2026. Durum: Kullanıcı onayıyla **yerel çalışan sürüme geçildi**; sağlık ve dosya kimliği kontrolü başarılı. Kullanıcı pilot kabulü ve canlı model testi açık.

Bu kayıt [P0-02 geliştirmelerini](AI-P0-02-SAYISAL-TUTARLILIK.md) yayın öncesi ve sonrası doğrular. İlk hazırlık aşamasında yeniden başlatma yapılmadı; ardından kullanıcının “evet” onayıyla 21:56'da API, worker ve web yeni derlemeye geçirildi. Migration çalıştırılmadı; mali kayıt/aktarım onayı elle değiştirilmedi, manuel dış AI testi tetiklenmedi. Worker olağan kuyruk işleyişine döndü.

## Yayın kapsamı

- Nakit akışı bordro/SGK/muhtasar kapsam açıklaması, ödeme takibi sınırları ve nakit–vade portföyü ayrımı.
- Büyük JSON number tutarları için hassasiyet uyarısı; decimal-string değerlerin korunması.
- Finans kaynağı alındıktan sonra olgu kimlikli seçim ve uygulamanın kaynak tutar/tarihinden ürettiği kontrollü yanıt. Serbest finans yorumu ve yeni oran hesabı yok.
- Geçersiz yanıt/model hatasında kaynak özeti ve kartların korunması, açıklama metadata'sının geçmişten dönmesi.

Derleme mevcut çalışma ağacının tamamını kapsar; yalnız P0-02'ye ait temiz bir Git commit'i/paketi değildir. Önceden bulunan kullanıcı değişiklikleri korunmuştur. Yeni migration eklenmedi/uygulanmadı; `prisma migrate status` 238 geçişle güncel.

## Doğrulamalar

API `NODE_OPTIONS=--max-old-space-size=4096 pnpm build` başarılı. Ana dosyalar 21:50:11 İstanbul zamanında üretildi.

Web `NEXT_DIST_DIR=.next-p0-02-release-20261014 NODE_OPTIONS=--max-old-space-size=4096 pnpm build` başarılı; 130 sayfa üretildi. Çalışan web klasörü değiştirilmeden ayrı klasör kullanıldı. Build kimliği: `_qCJNUtD8budcHer3LQx-`.

- 85 birim/döngü testi başarılı: finans olguları, kaynaklar, asistan, görev, işlem iddiası, nakit hesabı/bordro kapsamı ve çek vade ayrımı.
- 7 kabul testi başarılı: 1 yeni **derlenmiş API bileşenleri + üretim Next + HTTP/JWT/rol + Chromium** senaryosu, 3 gerçek DB rapor eşitliği ve 3 salt okunur envanter testi.
- Derleme modu `AI_FINANS_TEST_DIST=1`: testte controller/servis/guard/istek bağlamı/araç modülleri `apps/api/dist` dosyalarından Node `require` ile yüklenir. Web `next dev` değil `next start` ile yeni üretim klasöründen çalışır. Aynı negatif kâr, model hatasında kartın korunması, geçmiş, JWT/rol ve şirket ayrımı yeniden doğrulandı.
- Test şirketleri/faturalar/sohbetler rollback edildi; test şirketlerinin bulunmadığı ayrıca doğrulandı. İzole sunucular ve Chromium kapatıldı.
- İlk sandbox denemesinde port/DB erişimi engellendi; gerekli izinle tekrar çalıştırılan son koşu başarılıdır. Erişim hatası uygulama başarısızlığı gibi kaydedilmedi.

```bash
AI_FINANS_TEST_DIST=1 pnpm exec vitest run --config vitest.kabul.config.ts test/ai-finans-http-tarayici.kabul.test.ts test/ai-rapor-esitligi.kabul.test.ts test/ai-hazirlik-envanteri.kabul.test.ts
```

HTTP test modülü hâlâ minimaldir: tüm `AppModule`, worker görevlerinin çalışması, reverse proxy, rate limit, refresh-cookie, TOTP, parola girişi ve gerçek Gemini kalite/kota/aktarımı onayı bu kabulün kapsamı değildir. Kaynak ve derleme testlerinin geçmesi P0-02'nin bütün üretim kabul koşullarının tamamlandığı anlamına gelmez.

## Dosya kimlikleri — SHA-256

| Dosya | Özet |
|---|---|
| API `dist/main.js` | `eab0fadda462b675141eaebf82b71980fdca34346cda75868f6ed56d32ba9e63` |
| API `dist/main.worker.js` | `9653cb4c16f3642603149e23d18c02a2dbce35d65856860b71952991c7b98a95` |
| API `dist/ai/ajan/ai-ajan.service.js` | `1ae01a6f50f1e9e491ebe5a83a02c130aef90be1624c8d4a663020c9b3dd3e7a` |
| API `dist/ai/ajan/finans-aciklama.js` | `55f23f27c07ae988f4c4e1edd7373598cb0dae975dd8166ae17fc780de9a658f` |
| API `dist/nakit-akisi/nakit-akisi.service.js` | `d6c7b13164fe4749e1cbeb94544c780ef33c8f6a148e8345242496da823f9f4a` |
| Web yeni klasör `app-build-manifest.json` | `044bc7f17d9ec8fde76866b94e45d29cd7383e869023191b9eb2b6b025f85e37` |

Bu özetler seçilmiş dosyaların kimliğidir; tüm bağımlılıkların veya tüm çalışma ağacının imzalı/yeniden üretilebilir paket kanıtı değildir. Başka derleme yapılırsa bu aday yeniden doğrulanmalıdır.

## Korunan dosyalar ve çalışan ortam

- Önceki API disk derlemesi: `/tmp/tekirextra-p0-02-yayin-bVWntR/api-onceki-dist`. Yeni emit başlamadan alındı; yeni finans açıklama dosyası yok, eski nakit kapsam metni mevcut. Bu disk kopyası çalışan sürecin commit kimliğinin bağımsız kanıtı değildir.
- Yeni API aday kopyası: `/tmp/tekirextra-p0-02-yayin-bVWntR/api-aday-dist`; asıl yeni çıktı `apps/api/dist` içinde. Kopyalar aynı çalışma alanındaki bağımlılıklarla geri yüklemek içindir, bağımsız standalone API paketleri değildir.
- Eski çalışan web klasörü `.next-onay-release-20261014`, build `HHO2l4Gd3apxislfgXsRS` korunuyor. Yeni web ayrı `.next-p0-02-release-20261014` klasöründe.
- `/tmp` kopyaları kalıcı yedek değildir; makine temizliği/reboot ile kaybolabilir. Yayın öncesi geri dönüş dosyalarının varlığı tekrar doğrulanmalı ve gerekiyorsa operasyonun kalıcı yedek alanına alınmalıdır.
- 21:47'de API ready (DB/Redis/depo ok), worker ready, giriş ekranı HTTP 200. API PID `1002477` (21:05:03), worker `1002805` (21:05:18), web `1004330` (21:06:29) aynı kaldı. Bunlar **gözlem anının** PID'leridir; gelecekte körlemesine kullanılmaz.
- Yeni API dosyalarının diskte olması eski Node süreçlerinin bu kodu yüklediği anlamına gelmez. Süreçler bu hazırlıkta yeniden başlatılmadı.

## Kontrollü geçiş prosedürü

1. Kullanıcı/operasyon canlıya geçişi ve kısa API/web/worker kesinti penceresini açıkça onaylar.
2. Hedef çalışma dizini, portlar, süreç komutları ve yeni dosya kimlikleri yeniden doğrulanır. Beklenmeyen süreç/başka derleme varsa durulur; rastgele PID veya geniş kill uygulanmaz.
3. Geçerli ortam ayarları gizli değerler yazdırılmadan korunur. Eski web yolu ve önceki API kopyasının varlığı doğrulanır. Ayarlar/onay/mali veriler değiştirilmez; migration çalıştırılmaz.
4. Kuyruklar için kontrollü kapanışla API/worker, ardından yeni `NEXT_DIST_DIR` ile web başlatılır. Her servisin sağlığı ayrı doğrulanır; hatalı sağlık sonucuyla başarılı yayın denmez.
5. Sağlık, yeni web dosya kimliği, yeni API sürecinin başlama zamanı ve yetkili kullanıcının kaynak kartı/rapor kontrolü kaydedilir. Tenant'ın Gemini onayı bu yayın nedeniyle otomatik verilmez veya değiştirilmez; canlı model testi ayrıca kapsamlandırılır.
6. Sorunda yalnız doğrulanmış yeni süreçler kontrollü durdurulur; yeni dosyalar korunarak önceki API disk derlemesi ve eski web yolu geri seçilir. Aynı ortam ayarlarıyla başlatılıp sağlık tekrar doğrulanır. Finans kayıtları silinmez/geri sarılmaz; bu aday şema değişikliği içermediği için migration rollback planı yoktur. Disk geri dönüşü yeni sürümde oluşmuş sohbet JSON'unu geri almaz; eski sürümle geçmiş gösterimi ayrıca kontrol edilmelidir.
7. Başarılı geçiş ve pilot kabulü ardından plan durumu güncellenir. Tam P0-02 kabulü, büyük tutarlı hesap motoru incelemesi ve alan uzmanı/pilot onayı açık kalır.

## Yerel geçiş sonucu — 21:56–21:58 İstanbul

- Kullanıcı API/worker/web geçişini açıkça onayladı. Geçişten önce hedef PID/komutlar, çalışma dizinleri, altı yayın dosyasının SHA-256 değerleri, yeni web BUILD_ID ve önceki dosyaların varlığı doğrulandı.
- `/tmp/tekirextra-p0-02-yayin-bVWntR/restart.mjs` ile doğrulanmış eski süreçler SIGTERM kullanılarak kontrollü kapatıldı; SIGKILL veya geniş süreç kapatma uygulanmadı. Ortam ayarları yalnız bellekte korunarak yeni süreçlere aktarıldı; anahtarlar/değerler yazdırılmadı veya dosyaya alınmadı.
- API: PID `1072786`, başlangıç 21:56:17. Worker: PID `1073114`, başlangıç 21:56:32. Web: PID `1073416`, başlangıç 21:56:44. Yeni web `NEXT_DIST_DIR=.next-p0-02-release-20261014` ile çalışıyor.
- 21:57:21'de API `/health/ready` ready; veritabanı/Redis/depo ok. Worker `/health` ready, web `/giris` HTTP 200. Sağlık sonucu bütün zamanlanmış işlerin/hatırlatma teslimlerinin başarısı anlamına gelmez.
- Canlı web'den HTTP ile alınan `/_next/static/chunks/app/panel/nakit-akisi/page-2adae8015e57d499.js` dosyasının SHA-256 değeri yerel yeni derlemeyle aynı: `3f618d3e2899b8cd211047d3c6a35c5feb83bfce92e148f9e57465102048912f`. Dosya yeni “Hesap kapsamı ve varsayımlar” bölümünü içeriyor.
- Seçilmiş şirketin aktarım onayı salt okunur tekrar kontrol edildi: sağlayıcı `gemini`, model `gemini-2.5-flash`, politika `2026-10-v1`, tarih 21:11:04 İstanbul. Değişmedi; yeniden onay gerekmedi. Anahtar okunmadı/çözülmedi; manuel Gemini çağrısı yapılmadı.
- Geri dönüş dosyaları korunuyor; geri dönüş gerekmedi. Yeni süreçlerin günlükleri aynı özel geçici klasörde. Sistem servisi/PM2 veya reboot sonrası otomatik açılış bu işlemde kurulmadı.

Bu sonuç yalnız yerel TekirExtra ortamı içindir; başka bir sunucuya yayın yapıldığı iddia edilmez. Yetkili kullanıcının gerçek şirkette rapor/kaynak kartı kontrolü, kontrollü canlı model denemesi ve P0-02'nin diğer kabul koşulları hâlâ açık. Finans verilerine müdahale edilerek yayın testi yapılmadı.

Yayın sonrası kullanıcı denemesi: “Bir yanıt üretilemedi” bildirildi. İçeriksiz telemetri Gemini çağrılarının kullanılabilir yanıt olmadan başarılı işaretlendiğini gösterdi; eski kayıtta bitiş/engelleme nedeni yok. Kullanıcı onayıyla ayrı [boş yanıt düzeltmesi](AI-GEMINI-BOS-YANIT-DUZELTMESI-2026-10-14.md) geliştirildi; 94 test ve yeni API derlemesi başarılı. API 22:48, worker 22:55 İstanbul saatinde kontrollü yenilendi; sağlık kontrolleri başarılı. Web değişmedi. Gerçek Gemini kullanıcı kabulü bekleniyor; sağlık/sürüm kanıtı gerçek Gemini yanıt başarısını kanıtlamaz.
