# TekirExtra Mimari ve Kod Tabanı Keşif Envanteri (P0 Architecture Inventory)

**Tarih:** 15 Ekim 2026  
**Durum:** Tamamlandı (P0 Fazı Teslimatı)  
**Referans Plan:** [TekirExtra_CLI_Assistant_Uretim_Plani_V1.md](TekirExtra_CLI_Assistant_Uretim_Plani_V1.md)

---

## 1. Depo ve Proje Mimarisi

TekirExtra, çok kiracılı (multi-tenant) bir KOBİ ön muhasebe ve iş yönetim SaaS platformudur. Kod deposu pnpm ve Turborepo ile yapılandırılmış bir **monorepo** mimarisindedir.

### 1.1. Monorepo Dizin Yapısı

| Dizin / Paket | Rolü ve Teknolojisi | Kaynak / Kanıt |
| :--- | :--- | :--- |
| [`apps/api`](../../../apps/api) | NestJS 11 + Express + Prisma ORM 6.19 + BullMQ API ve Worker servisi. | [`apps/api/package.json`](../../../apps/api/package.json) |
| [`apps/web`](../../../apps/web) | Next.js 15.3 (App Router) + React 19 + Tailwind/CSS UI ön yüzü. | [`apps/web/package.json`](../../../apps/web/package.json) |
| [`packages/shared`](../../../packages/shared) | Ortak DTO'lar, enum'lar, fatura hesaplama ve kuralları motoru. | [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts) |
| [`packages/baglanti`](../../../packages/baglanti) | Dış entegratör adaptörleri (e-Belge Sovos/Fit, Pazaryeri, POS, Banka). | [`packages/baglanti/src/index.ts`](../../../packages/baglanti/src/index.ts) |

---

## 2. Kimlik Doğrulama ve Yetkilendirme (Auth & Multi-Tenancy)

### 2.1. Kimlik Doğrulama (Authentication)
- Oturum yönetimi JWT ile sağlanır; token HTTP Cookie veya `Authorization: Bearer <token>` başlığından okunur ([`auth.guard.ts`](../../../apps/api/src/auth/auth.guard.ts)).
- Her HTTP isteğinde `AsyncLocalStorage` tabanlı `baglamAl()` / `aktifBaglam()` mekanizması devreye girer ([`istek-baglami.ts`](../../../apps/api/src/core/istek-baglami.ts)).
- Bağlam içeriği: `tenantId`, `userId`, `rol`, `eposta`.

### 2.2. Kiracı Yalıtımı ve Row-Level Security (PostgreSQL RLS)
- Uygulama veritabanına `tekir_app` kullanıcısıyla bağlanır. Bu rolün `BYPASSRLS` yetkisi **yoktur** ([`README.md`](../../../README.md#L40-L46)).
- Tüm kiracı veritabanı sorguları [`PrismaService.tenantIslem()`](../../../apps/api/src/core/prisma.service.ts#L35-L48) üzerinden yürütülür:
  ```typescript
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${kullanici}, true)`;
  ```
- PostgreSQL RLS politikaları `current_setting('app.tenant_id')` ile satırları süzer; bağlamsız sorgular boş küme döner (veri sızıntısı kesin olarak engellenir).

### 2.3. Rol Tabanlı Yetkilendirme (RBAC)
- Tanımlı roller ([`packages/shared/src/enums.ts`](../../../packages/shared/src/enums.ts#L1-L2)):
  `yonetici`, `muhasebe`, `satis`, `salt_okunur`, `mali_musavir`, `b2b_bayi`, `uretim_planlama`, `uretim_operatoru`, `depo`, `kalite`, `maliyet_muhasebesi`, `ik`, `calisan`.
- API uçları [`@Roller(...)`](../../../apps/api/src/auth/roller.decorator.ts) dekoratörü ve [`RollerGuard`](../../../apps/api/src/auth/roller.guard.ts) ile korunur.
- Çalışan (`calisan`) rolü yalnızca adının açıkça geçtiği uçlara ve [`CALISAN_ACIK_YOLLAR`](../../../apps/api/src/auth/roller.guard.ts#L13) istisnalarına erişebilir.
- UI seviyesinde menü ve sayfa erişimleri [`rolMenuYoluGorebilir()`](../../../apps/web/src/lib/rol-yetkileri.ts#L40-L51) ile denetlenir.

---

## 3. Mevcut Modül Envanteri ve Salt Okunur API Uçları

TekirExtra bünyesinde 30'u aşkın iş modülü bulunmaktadır ([`app.module.ts`](../../../apps/api/src/app.module.ts)):

| Modül | Temel Sorumluluk | Salt Okunur (Read-Only) API Uçları | Asistan Araç Karşılığı |
| :--- | :--- | :--- | :--- |
| **Cari** | Müşteri & Tedarikçi yönetimi, bakiye, risk | `GET /cari`, `GET /cari/:id`, `GET /cari/vade-hatirlatma/oncelikler` | `cari_ara`, `cari_getir`, `tahsilat_oncelikleri`, `tahsilat_riski` |
| **Stok** | Ürün, hizmet, varyant, depo bakiyeleri | `GET /stok`, `GET /stok/:id`, `GET /stok/:id/tavsiye-fiyat` | `stok_ara`, `stok_getir`, `fiyat_onerisi` |
| **Fatura** | Alış, satış, iade faturaları, KDV, tevkifat | `GET /fatura`, `GET /fatura/:id` | `fatura_ara`, `fatura_getir` |
| **Belgeler** | Teklif, sipariş, irsaliye yönetimi | `GET /belgeler`, `GET /belgeler/:id` | `belge_ara`, `belge_getir` |
| **Kasa-Banka** | Kasa ve banka hesapları, hareketler | `GET /kasa-banka/kasalar`, `GET /kasa-banka/bankalar` | `kasa_banka_hesaplari` |
| **Raporlar** | Finansal özet, gelir-gider, vadesi geçenler, dinamik katalog | `GET /rapor/ozet`, `GET /rapor/gelir-gider`, `GET /raporlar`, `GET /raporlar/:kod/calistir` | `finansal_ozet`, `gelir_gider`, `vadesi_gecen_alacaklar`, `rapor_katalogu`, `rapor_calistir` |
| **Masraflar** | Gider fişleri, kategoriler, kira tahakkuk | `GET /masraflar`, `GET /masraflar/kategoriler` | `masraf_kategorileri` |
| **Gelen E-posta** | Kurumsal IMAP ile gelen mailler, ekler, OCR | `GET /tenant/epostalar`, `GET /tenant/epostalar/:id` | `gelen_eposta_ara`, `gelen_eposta_getir`, `gelen_eposta_ek_ocr` |
| **Personel** | Bordrolar, izinler, avanslar, SGK bildirgeleri | `GET /personel`, `GET /personel/:id`, `GET /personel/bordrolar` | *Yeni eklenecek araç adayı* |
| **Üretim** | Reçeteler, iş emirleri, iş merkezleri, duruşlar | `GET /uretim/emirler`, `GET /uretim/receteler` | *Yeni eklenecek araç adayı* |
| **Satın Alma** | Talepler, teklifler, onay zincirleri | `GET /satin-alma/talepler`, `GET /satin-alma/teklifler` | *Yeni eklenecek araç adayı* |

---

## 4. Mevcut Yapay Zekâ (AI) ve Asistan Altyapısı

TekirExtra'da halihazırda üretim aşamasında çalışan kapsamlı bir yapay zekâ katmanı mevcuttur ([`apps/api/src/ai/`](../../../apps/api/src/ai/)):

### 4.1. Çoklu Sağlayıcı (Provider Factory)
- [`ai-provider.factory.ts`](../../../apps/api/src/ai/saglayici/ai-provider.factory.ts):
  - **Google Gemini** (`gemini-2.5-flash`, `gemini-1.5-pro`)
  - **Anthropic Claude** (`claude-3-5-sonnet`, `claude-3-haiku`)
  - **OpenAI** (`gpt-4o`, `gpt-4o-mini`)
  - **Yerel Ollama** (Llama 3 / Qwen)
  - **Mock Sağlayıcı** (Testler için)

### 4.2. Araç Çağrısı ve Güvenlik Yürütücüsü ([`UcCagirici`](../../../apps/api/src/ai/ajan/uc-cagirici.ts))
- **Ekran Ucu Çağırma:** Araçlar servisleri doğrudan çağırmak yerine NestJS controller uçlarını (`moduleRef.get(uc.denetleyici)`) çalıştırır.
- **Güvenlik Doğrulaması:** Controller üzerindeki `@Roller` tanımları çalışma anında `UcCagirici.yetkiliMi()` ile doğrulanır; yetkisiz roller için `ForbiddenException` fırlatılır.
- **Audit İzi:** Tüm araç çalıştırma olayları `AuditLog` tablosuna otomatik kaydedilir.

### 4.3. Veri Modeli ve Kalıcılık ([`schema.prisma`](../../../apps/api/prisma/schema.prisma))
- `AjanOturumu`: Kullanıcı/kiracı oturumları ve sohbet geçmişi.
- `AjanMesajGecmisi`: Asistan mesajları, araç çağrıları ve yanıtlar.
- `AiOnayTalebi`: Yazma içeren işlemler için onay mekanizması (CLI asistanında yazma olmayacak, yalnızca read-only kalacak).
- `TenantAiAyari`: BYOK (kendi anahtarını getir), günlük kota (`gunlukCagriSiniri`), KVKK veri aktarım onayı (`yurtDisiOnayAt`).
- `TenantAiGorev` & `TenantAiGorevCalisma`: Zamanlanmış arka plan AI görevleri ve idempotency kilidi.

### 4.4. Kullanıcı Arayüzü (UI)
- Asistan penceresi tüm uygulama ekranlarında global olarak mevcuttur:
  - Header & Sidebar tetikleyicisi: [`layout.tsx`](../../../apps/web/src/app/panel/layout.tsx#L360-L363)
  - Pencere bileşeni: [`asistan-penceresi.tsx`](../../../apps/web/src/components/asistan-penceresi.tsx)
  - Sohbet ve yanıt arayüzü: [`asistan-sohbet.tsx`](../../../apps/web/src/components/asistan-sohbet.tsx)

---

## 5. Dağıtım ve Altyapı Düzeni

- **Veritabanı:** PostgreSQL 16 Alpine (Port `5433:5432`)
- **Kuyruk / Cache:** Redis 7 Alpine (Port `6380:6379`)
- **Nesne Depolama (S3):** MinIO (API: `9002`, Konsol: `9003`)
- **E-posta Test Sunucusu:** Mailpit (SMTP: `1025`, Web: `8025`)
- **Arka Plan İşçisi:** BullMQ Worker (`main.worker.js`)
- **Uzak Tünel:** Cloudflare Quick Tunnel (`cloudflared`)

---

## 6. Boşluk (Gap) ve Risk Analizi

1. **Docker Sandbox İhtiyacı (P4):**
   Mevcut AI modülü ağır hesaplamalar yapmamakta, JSON yanıtları doğrudan dönmektedir. Kullanıcı "Tüm yılın satış ve stok verilerini çekip regresyon analizi yap ve PDF/Excel raporu derle" dediğinde, izole ve sınırlandırılmış bir Docker sandbox çalıştırma mekanizması henüz bulunmamaktadır.
2. **Kısıtlı CLI Arayüzü (P6):**
   Mevcut arayüz serbest doğal dil sohbetidir (`AsistanSohbet`). Kullanıcının doğrudan terminal komutu (`tekir cari list --bakiye>10000`, `tekir fatura rapor --ay=10`) yazabileceği allowlist tabanlı bir CLI kabuğu UI'da mevcut değildir.
3. **Artifact Servisi ve Saklama (P4/P5):**
   Üretilen rapor dosyalarının (Excel, PDF, CSV) MinIO/S3 üzerinde geçici/kalıcı depolanması ve kullanıcıya imzalı URL ile sunulması için birleşik bir `ArtifactService` gerekmektedir.
