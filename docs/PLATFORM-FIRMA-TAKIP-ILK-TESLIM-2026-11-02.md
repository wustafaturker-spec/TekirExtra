# Platform firma takibi — ilk teslim

Kaynak: [imalat programı](PLATFORM-GELISTIRME-IMALAT-PROGRAMI-2026-11-02.md). Kapsam: HZ-01–04 ilk liste sözleşmeleri, FR-01 ve FR-02'nin mevcut veriyle sağlanan görünümleri. Üretim yayını yapılmadı.

## Uygulanan sözleşme

`GET /api/v1/platform/firmalar/sayfali` yalnız mevcut platform yöneticisi yetkisiyle çalışır. `platform_firma_ozeti`, `platform_baglanti_sagligi` ve `platform_destek_durumu` dar veritabanı işlevlerini kullanır; yeni tablo yetkisi veya migration gerektirmez.

| Parametre | Kural |
|---|---|
| arama | En fazla 200 karakter, unvan/VKN içinde literal arama; SQL jokerleri kaçırılır |
| goster | hepsi, talep, askiyaAlinacak, askida, iptal, aktif, deneme, hicGirmeyen, uzunSuredirGirmeyen, yenilenecek, denemesiBitecek, baglantiHatali |
| plan | En fazla 40 karakter; mevcut/eski plan kodu |
| baglanti | hepsi, hata, ebelgeAktif, ebelgeYok |
| siralama | unvan, kayitYeni, sonGiris, yenileme; eşitlikte tenant kimliği |
| sayfa / sayfaBoyutu | 1–100000 / 1–100; varsayılan 1 / 25 |
| kayitBaslangic / kayitBitis | Türkiye takvim günü, iki uç dahil |
| yenilemeBaslangic / yenilemeBitis | Türkiye takvim günü, iki uç dahil |
| firma | İsteğe bağlı geçerli UUID; liste filtresinden bağımsız firma penceresi sorgusu |

Yanıt: `kayitlar`, filtreli `toplam`, `sayfa`, `sayfaBoyutu`, filtrelerden bağımsız `sayilar`. Liste, toplam ve sayaçlar tek SQL görünümünden hesaplanır. Destek durumu yalnız dönen firma kimlikleri için alınır. Eski `/platform/firmalar` dizi yanıtı özet ve ödeme ayarları için korunur; bu tüketicilerin sayfalı/özel özet uçlarına taşınması ayrı iştir.

## Ölçüm tanımları

- Aktif kullanıcı: mevcut işlevin aktif, çalışan rolü dışındaki hesap sayısı. Belirli dönemde ürünü kullanan kişi sayısı değildir.
- Son giriş: firmanın kullanıcılarındaki en son giriş zamanı. Modül kullanımı veya destekten arındırılmış müşteri etkinliği değildir.
- Hiç giriş yapmayan: son giriş NULL. 30 gündür giriş yapmayan: son giriş mevcut ve anlık UTC zamanından 30 gün eski. İki görünüm ayrıdır.
- Yenilenecek: aktif/deneme aboneliğinin dönem sonu, Türkiye takviminde bugün ile yedi gün sonrası arasında. Denemesi bitecek aynı aralığın deneme alt kümesidir.
- Bağlantı hatası: mevcut sağlık işlevinde durum hata veya ardışık hata sayısı pozitif. Hata görünmemesi bağlantının sağlıklı olduğunun kanıtı olarak kullanılmaz.
- Aktif e-belge: mevcut firma özetinin döndürdüğü aktif e-belge sağlayıcısı. Sağlık hatası ve aktiflik ayrı koşullardır.
- Ödemesi geciken: mevcut işlevdeki aktif/deneme ve dönem sonundan 15 gün geçmiş kuralı korunur; otomatik askı yapılmaz.

## Paket ve ölçüm ön envanteri

| Kaynak | Sonraki teslimde korunacak ilişki |
|---|---|
| `apps/api/src/tenant/abonelik.service.ts` | `ABONELIK_PLANLARI`, kullanıcı/cari/stok/aylık fatura limitleri, `v1` → profesyonel eşlemesi |
| `apps/api/src/abonelik-odeme/abonelik-tutari.ts` | 1/3/6/12 aylık dönemler, ondalık hesap, fiyat planı ve vergi |
| `apps/api/src/abonelik-odeme/abonelik-odeme.service.ts` | Ödeme teklifi, deneme, sağlayıcı tahsilatı ve otomatik yenileme |
| `apps/api/src/abonelik-odeme/abonelik-fatura.service.ts` | Abonelik açıklaması, fatura ve tahsilat ilişkileri |
| `apps/api/src/abonelik-odeme/platform-odeme-raporu.service.ts` | Yaklaşan yenilemenin beklenen tutarı ve rapor |
| `apps/api/src/core/abonelik-erisim.service.ts` | Askı/iptal erişimi, 30 saniyelik önbellek ve worker davranışı |
| `apps/web/src/app/platform/firmalar/page.tsx` | Sabit paket seçenekleri; PK tesliminde katalogla değiştirilecek |

Bu envanter HZ-01'in başlangıcıdır; tüm modül/kota tüketicilerinin taraması ve HZ-02 tarihsel metrik tanımları henüz tamamlanmadı.

## Kalan işler

- FR-02: takip tarihi geçmiş görünümü, FR-04 kaydıyla eklenecek.
- FR-03–05: ayrı firma detay sayfası, sorumlu/not/görüşme tarihi ve birleşik zaman çizelgesi.
- IS-01–05: günlük ölçüm ve tarihsel istatistikler; bugünkü son girişten geçmiş kullanım türetilmeyecek.
- Hacim büyüdüğünde dar firma özet işlevinin sorgu maliyeti ayrıca ölçülecek; sayfalama API yanıtını sınırlar, toplam/sayaçlar için tüm özet kapsamı değerlendirilir.

## Doğrulama

Tarayıcı kabulü güncel kaynak için ayrı 3112 portu ve `.next-platform-e2e` klasörü kullanır; çalışan 3100 pilotunu değiştirmez. Tarayıcı senaryoları API yanıtlarını taklit eder; SQL davranışı ayrıca gerçek PostgreSQL servis kabulünde doğrulanır.

| Kontrol | Sonuç |
|---|---|
| `vitest run src/mevzuat/platform-firma-filtre.test.ts src/mevzuat/platform-firma.service.test.ts` | 18 test geçti |
| `vitest run --config vitest.kabul.config.ts test/platform-firma-sayfalama.kabul.test.ts` | 8 test geçti; 215 firma, tüm sayfalar, literal/Türkçe arama, tarih sınırı ve bağlantı filtreleri |
| Platform Chromium: firma sayfalama + listeler + ödeme raporu | 14 senaryo geçti |
| Son grid düzeni: mobil taşma, masaüstü firma yönetimi, geciken ödeme | 3 senaryo geçti |
| Eski paket talebi onayı | İlk koşuda geliştirme sunucusunun JS yüklemesinde zaman aşımı; tek başına yeniden koşuda geçti |
| Web TypeScript kontrolü | Geçti |
| API TypeScript kontrolü | `node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` ile geçti |
| Değişen uygulama dosyalarında ESLint ve `git diff --check` | Geçti |

API genel TypeScript kontrolünün ilk denemesi varsayılan Node heap sınırına ulaştı; artırılmış bellekle son koşu başarıyla tamamlandı.

Yeniden çalıştırma: `pnpm --filter @tekirextra/web exec playwright test --config playwright.platform.config.ts e2e/platform-firma-sayfalama.spec.ts e2e/platform-listeler.spec.ts e2e/platform-odeme-raporu.spec.ts`. Paket talebi ve geciken ödeme regresyonları `critical-workflows.spec.ts` içinden adlarıyla seçilebilir.
