# TekirExtra Accounting Intelligence V2 — Mimari ve Repo Keşif Envanteri (P0)

**Tarih:** 15 Ekim 2026  
**Durum:** Doğrulandı ve Tamamlandı (P0 Fazı Teslimatı)  
**Referans Plan:** [TekirExtra_Accounting_Intelligence_V2_Detayli_Uretim_Plani.md](../../TekirExtra_Accounting_Intelligence_V2_Detayli_Uretim_Plani.md)

---

## 1. Kod Ağacı ve Teknoloji Yığını (Doğrulanmış Bulgular)

TekirExtra, çok kiracılı (multi-tenant) kurumsal ön muhasebe ve iş yönetim SaaS platformudur. Kod deposu pnpm ve Turborepo ile yönetilen bir **monorepo** yapısındadır.

| Katman / Paket | Teknoloji | Sorumluluk ve Konum |
| :--- | :--- | :--- |
| **Backend API** | NestJS 11 + Express + Prisma ORM 6.19 | Ana REST API, Auth, RLS ve Controller uçları ([`apps/api/src/`](../../../apps/api/src/)). |
| **Arka Plan Worker** | BullMQ 6.3 + Redis 7 + Node.js 24 | Zamanlanmış görevler, kuyruklar, e-posta tarama, döviz kuru çekimi ([`apps/api/src/main.worker.ts`](../../../apps/api/src/main.worker.ts)). |
| **Frontend UI** | Next.js 15.3 (App Router) + React 19 + Tailwind/CSS | Kullanıcı paneli, muhasebe ekranları, bildirim merkezi ([`apps/web/src/`](../../../apps/web/src/)). |
| **Ortak Kütüphane** | TypeScript ESM (`@tekirextra/shared`) | DTO'lar, enum'lar, fatura hesaplama, resmi tatil ve kuralları ([`packages/shared/src/`](../../../packages/shared/src/)). |
| **Dış Bağlantılar** | TypeScript ESM (`@tekirextra/baglanti`) | e-Belge (Sovos, NES, Uyumsoft), POS, Pazaryeri ve Banka adaptörleri ([`packages/baglanti/src/`](../../../packages/baglanti/src/)). |

---

## 2. Kimlik, Yetkilendirme ve Kiracı Yalıtımı (Doğrulanmış Bulgular)

### 2.1. Kimlik Doğrulama (Auth)
- JWT tabanlı kimlik doğrulama ([`auth.guard.ts`](../../../apps/api/src/auth/auth.guard.ts)).
- `AsyncLocalStorage` tabanlı istek bağlamı ([`istek-baglami.ts`](../../../apps/api/src/core/istek-baglami.ts)): `tenantId`, `userId`, `rol`.

### 2.2. PostgreSQL Row-Level Security (RLS) ve Veritabanı Sınırları
- Veritabanına bağlanan kullanıcı: `tekir_app`.
- **Kritik Güvenlik Güvencesi:** `tekir_app` kullanıcısının `BYPASSRLS` yetkisi **yoktur** ([`README.md`](../../../README.md#L40-L46)).
- Tüm kiracı sorguları [`PrismaService.tenantIslem()`](../../../apps/api/src/core/prisma.service.ts#L35-L48) üzerinden yürütülür:
  ```sql
  SELECT set_config('app.tenant_id', $tenantId, true), set_config('app.user_id', $userId, true);
  ```
- Bu mimari sayesinde, yapay zekâ veya otonom planlayıcı doğrudan sorgu çalıştırsa dahi başka bir firmanın (`tenant`) verisini fiziksel olarak okuyamaz (`SEC-01`).

### 2.3. Rol Tabanlı Yetkilendirme (RBAC)
- Tanımlı roller ([`packages/shared/src/enums.ts`](../../../packages/shared/src/enums.ts#L1-L2)): `yonetici`, `muhasebe`, `satis`, `salt_okunur`, `mali_musavir`, `b2b_bayi`, `uretim_planlama`, `uretim_operatoru`, `depo`, `kalite`, `maliyet_muhasebesi`, `ik`, `calisan`.
- API uçları [`@Roller(...)`](../../../apps/api/src/auth/roller.decorator.ts) ve [`RollerGuard`](../../../apps/api/src/auth/roller.guard.ts) ile korunur.
- V2 Accounting Intelligence için `PolicyEngineService`, her araç çağrısında ve içgörü yayımlamadan önce alıcının rolünü yeniden denetler (`SEC-04`).

---

## 3. Olay İzleme ve Arka Plan Görev Altyapısı (Doğrulanmış Bulgular)

Mevcut repoda V2 Otonom Planlayıcı ve Görev Motoru (`Task Orchestrator`) için kullanılabilecek çalışan altyapı:

| Altyapı | Teknoloji / Dosya | Durum ve Yetenek |
| :--- | :--- | :--- |
| **Kuyruk Yöneticisi** | BullMQ (`redis://localhost:6380`) | Dayanıklı görev kuyruğu, gecikmeli işler, retry ve konküransi kontrolü hazır. |
| **Worker Süreci** | `main.worker.ts` | Bağımsız çalışan arka plan işçisi; API servisinden ayrı süreç olarak çalışır. |
| **Zamanlayıcılar (Schedulers)** | `DovizZamanlayiciService`, `KiraTahakkukZamanlayiciService`, `EpostaZamanlayiciService`, `DuzeltmeTaramaZamanlayiciService` | Periyodik tarama ve zamanlanmış olay üretme şablonları mevcuttur. |
| **AI Görev Tablosu** | `TenantAiGorev`, `TenantAiGorevCalisma` ([`schema.prisma`](../../../apps/api/prisma/schema.prisma)) | Görevlerin tetiklenme günü, durumu (`calisiyor`, `basarili`, `hata`), idempotency anahtarı (`sahiplik_anahtari`) şemada tanımlıdır. |

---

## 4. Mevcut Test Altyapısı ve Durumu

- **Birim & Entegrasyon Testleri:** Vitest 3.2 ([`vitest.config.ts`](../../../apps/api/vitest.config.ts)).
- **E2E Kabul Testleri:** Playwright 1.61.
- **Finans & Hesaplama Testleri:** `nakit-akisi.hesap.test.ts`, `fatura-hesapla.test.ts`, `cari-ekstre.test.ts`, `resmi-tatiller.test.ts` gibi deterministik matematik testleri mevcuttur.

---

## 5. Doğrulanmış Gerçekler vs. Varsayımlar

### ✅ Doğrulanmış Gerçekler (Doğrudan Kod Referanslı)
1. Nakit akışı motoru (`nakit-akisi.hesap.ts`) saf/deterministik fonksiyondur; kuruş duyarlılığında tamsayı aritmetiği kullanır (`kurus: number`).
2. Cari vade hatırlatma ve tahsilat gecikme analizi (`cariDavranisAnalizi`, `vade-hatirlatma.service.ts`) mevcuttur ve tutar ağırlıklı ortalama gecikme gününü (`gecikmeGun`) hesaplamaktadır.
3. Çek/Senet (`cekSenet`), Faturalar (`fatura`), Banka/Kasa hareketleri (`kasaBankaHareket`) eksiksiz olarak Prisma şemasında ve controller katmanında mevcuttur.
4. Resmî tatiller ve iş günleri (`resmiTatiller()`, `packages/shared/src/resmi-tatiller.ts`) 2026 ve 2027 dinî/resmî bayramlarını kapsayacak şekilde tanımlıdır.

### ⚠️ Belgede Yer Alan ve Düzeltilen Varsayımlar
1. **Go Dili Varsayımı:** V2 belgesi referans mimaride Go servislerini (`Accounting Intelligence API - Go`) göstermiştir. Ancak belgenin §3 maddesinde *"İlk aşamada modüler monolit... mevcut TekirExtra teknolojisi P0'da incelenmeden zorunlu yeniden yazım yapılmaz"* denilmektedir. Mevcut NestJS/TypeScript altyapısı `@tekirextra/shared` ve Prisma ile tam uyumlu olduğundan Control Plane NestJS içinde inşa edilecektir.
2. **Dağıtık Event Bus (Kafka/RabbitMQ) Varsayımı:** V2 belgesi dağıtık event bus'ın yalnızca ölçek gerektirdiğinde ekleneceğini belirtmiştir (§3). Mevcut Redis + BullMQ ve PostgreSQL outbox/polling yapısı bu aşamada %100 yeterlidir.
