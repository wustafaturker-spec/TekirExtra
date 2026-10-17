# TekirExtra V2 Accounting Intelligence — Canlıya Alma ve İşletim El Kitabı (Release Runbook)

**Sürüm:** V2.0.0 (Otonom Nakit Akışı ve Tahsilat Riski Dikey Dilimi)  
**Tarih:** 2026-10-15  
**Hedef Ortam:** Üretim (Production) & Pilot Dağıtım  

---

## 1. Mimari Genel Bakış

TekirExtra Muhasebe Zekâsı V2, kurumsal muhasebe sisteminde "Otonom Nakit Akışı ve Tahsilat Riski Analizi" dikey dilimini devreye alır. Sistem, işletmelerin kasa, banka, cari alacak ve fatura verilerini otonom olarak tarar; deterministik matematik motorları ile 7/30/90 günlük 3 senaryolu (iyimser, baz, kötümser) nakit akışı simülasyonları üretir ve tahsilat risklerini proaktif olarak yöneticinin dikkatine sunar.

### Temel Prensipler
1. **L5 Değişmez Kuralı (Salt-Okunur Zeka):** Yapay zeka ve otonom planlayıcı muhasebe defterlerine (yevmiye, fatura, cari hesap, kasa) kesinlikle yazma/silme yapamaz ve dış sistemlere ödeme talimatı tetikleyemez.
2. **Kural 6 (Deterministik Matematik):** Bütün finansal hesaplamalar, bakiye toplamları, gecikme faizleri ve tatil kaydırmaları deterministik TypeScript motorları tarafından integer kuruş hassasiyetinde yürütülür. LLM hiçbir koşulda serbest matematiksel tahmin üretemez.
3. **Veri Soy Ağacı (Data Lineage - EvidenceRef):** Üretilen her içgörü ve risk tespiti, veritabanındaki somut kayıtlara (`EvidenceRef[]`) dayandırılır. Kullanıcı rapordaki her rakamın kaynağını tek tıkla doğrular.
4. **Çoklu Kiracı ve RLS İzolasyonu:** `tenantIslem()` transaction standardı ile PostgreSQL Row-Level Security (RLS) aşılmaksızın kiracı verisi mutlak sınırlarla korunur (`app.tenant_id`).

---

## 2. Dikey Dilim Bileşenleri ve Modül Haritası

| Katman | Servis / Modül | Dosya Yolu | Sorumluluk |
| :--- | :--- | :--- | :--- |
| **Sözleşmeler** | `contracts/` | `apps/api/src/assistant/contracts/` | Tip tanımları, DTO'lar, EvidenceRef, TaskPlan |
| **Salt-Okunur Adaptörler** | `KasaBankaReadAdapter` | `.../modules/kasa-banka-read-adapter.service.ts` | Kasa & banka bakiyeleri, kanıt üretimi |
| | `FaturaReadAdapter` | `.../modules/fatura-read-adapter.service.ts` | Açık faturalar, vadeler, kalan tutarlar |
| | `CariReadAdapter` | `.../modules/cari-read-adapter.service.ts` | Alacaklar, ortalama gecikme günleri, alan maskeleme |
| | `NakitAkisiReadAdapter` | `.../modules/nakit-akisi-read-adapter.service.ts` | 3 senaryolu nakit projeksiyonu oluşturma |
| | `StokReadAdapter` | `.../modules/stok-read-adapter.service.ts` | Kritik stok seviyeleri ve maliyet analizi |
| | `BordroReadAdapter` | `.../modules/bordro-read-adapter.service.ts` | Personel bordro yükümlülükleri ve kalan tutarlar |
| **Güvenlik & Politika** | `PolicyEngineService` | `.../policy/policy-engine.service.ts` | L5 denetimi, RBAC/ABAC yetkilendirme, kotalar |
| | `RolloutService` | `.../policy/rollout.service.ts` | Canary, Pilot, GA aşamaları ve Acil Kill-Switch |
| | `AuditService` | `.../audit/audit.service.ts` | Denetim günlüğü, araç çalıştırma ve içgörü izi |
| **Finansal Motor** | `FinancialEngineService` | `.../finance/financial-engine.service.ts` | Resmi tatil kaydırmaları, cari gecikme risk skoru (0-100) |
| **Olay Yönetimi** | `EventCollectorService` | `.../events/event-collector.service.ts` | Olay kuyruğu, 24 saatlik mükerrerlik bastırma (dedup) |
| | `EventSchedulerService` | `.../events/event-scheduler.service.ts` | Vadesi geçen fatura ve nakit açığı periyodik taraması |
| **Planlama & İçgörü** | `AutonomousPlannerService`| `.../planner/autonomous-planner.service.ts` | 5 adımlı analiz planı oluşturma ve sıralı çalıştırma |
| | `InsightGeneratorService`| `.../planner/insight-generator.service.ts` | EvidenceRef destekli içgörü kartı sentezleme |
| **Görev Orkestrasyonu**| `TaskOrchestratorService`| `.../tasks/task-orchestrator.service.ts` | İşçi kiralama (lease), zaman aşımı, iptal, SHA-256 |
| **İçgörü Yaşam Döngüsü**| `InsightLifecycleService`| `.../insights/insight-lifecycle.service.ts`| ACTIVE -> ACKNOWLEDGED -> RESOLVED döngüsü |
| **Arayüz (Web)** | `YzIcgoruKartlari` | `apps/web/src/components/yz-icgoru-kartlari.tsx` | Nakit akışı ekranında içgörüler ve Evidence çekmecesi |
| | `KomutPaleti` | `apps/web/src/components/komut-paleti.tsx` | Finansal Zekâ & CLI hızlı erişim kısayolları |

---

## 3. Güvenlik ve Denetim Matrisi

### Rol Erişim Hakları (RBAC/ABAC)
- **`yonetici`:** Tüm salt-okunur araçlara, analiz planlamasına, içgörü onaylama ve denetim loglarına tam yetkili.
- **`muhasebe`:** Cari, fatura, kasa-banka ve nakit akışı analizlerine yetkili; hassas alanlar (IBAN vb.) görünür.
- **`salt_okunur`:** Yalnızca maskeli içgörüleri ve analiz sonuçlarını görüntüleyebilir; görev tetikleyemez.
- **`satis` / `depo` / `calisan`:** Finansal intelligence araçları ve içgörüler bu rollere kapalıdır (`ForbiddenException`).

### Alan Bazlı Maskeleme (Field-Level Security)
Yetkisiz rollere aşağıdaki hassas alanlar sunucuda maskelenir (`undefined` döner):
`karZarar`, `brutKar`, `netKar`, `maliyet`, `karMarji`, `iban`, `ozelNot`, `yetkiliTelefon`.

---

## 4. API Uç Noktaları Özeti

| Metot | Uç Nokta | Açıklama |
| :--- | :--- | :--- |
| `GET` | `/api/v1/intelligence/policies/effective` | Oturuma uygulanan etkin güvenlik ve yetki kapsamı |
| `GET` | `/api/v1/intelligence/tools` | Oturuma izin verilen salt-okunur araçların listesi |
| `POST`| `/api/v1/intelligence/tasks` | Otonom finansal analiz görev planı başlatma |
| `GET` | `/api/v1/intelligence/tasks/:id` | Çalışan veya tamamlanan görevin durumunu ve adımlarını getirme |
| `POST`| `/api/v1/intelligence/tasks/:id/cancel` | Çalışan görevi anında iptal etme |
| `GET` | `/api/v1/intelligence/insights` | Kiracıya ait aktif içgörü kartları |
| `GET` | `/api/v1/intelligence/insights/:id` | Tekil içgörü detayı, metrikler ve EvidenceRef listesi |
| `POST`| `/api/v1/intelligence/scan` | Vadesi geçen faturalar ve nakit açıklarını tarama |
| `GET` | `/api/v1/intelligence/events` | Yakalanan finansal olay kuyruğu |
| `GET` | `/api/v1/intelligence/artifacts/:id` | Denetlenebilir salt-okunur görev artefaktı |
| `GET` | `/api/v1/intelligence/audit` | Yapay zekâ güvenlik ve denetim kayıtları |
| `GET` | `/api/v1/intelligence/rollout/status` | Canary / Pilot / GA dağıtım durumu |
| `POST`| `/api/v1/intelligence/rollout/kill-switch` | Acil durdurma anahtarı (Admin) |

---

## 5. Canlıya Alma ve Dağıtım Adımları

1. **Bağımlılıklar ve Derleme:**
   ```bash
   pnpm install
   pnpm --filter @tekirextra/api build
   pnpm --filter @tekirextra/web build
   ```

2. **Veritabanı Migrasyonları ve RLS:**
   ```bash
   pnpm --filter @tekirextra/api exec prisma migrate deploy
   ```

3. **Otomatik Test Paketi Doğrulaması:**
   ```bash
   pnpm --filter @tekirextra/api test src/assistant
   ```
   *Beklenen Sonuç: 16 test dosyasının ve 81 birim/kabul testinin tamamının yeşil geçmesi.*

4. **Servis Başlatma:**
   ```bash
   # API Daemon
   cd apps/api && node dist/main.js
   # Web Arayüzü
   cd apps/web && pnpm start
   ```

5. **Sağlık Kontrolü (Smoke Test):**
   ```bash
   curl -s http://localhost:3001/health | grep '"durum":"ok"'
   ```

---

## 6. Geri Alma (Rollback) Prosedürü

Herhangi bir beklenmeyen durumda:
1. Mevcut API/web/worker süreçleri, sürüm kimlikleri, şema ve şirket ayarları kaydedilir. Doğrulanmış yedek/geri yükleme kanıtı ve hedef önceki paket belirlenir. Çalışma alanında teslim edilmemiş değişiklikler varsa yerinde `git checkout` ile sürüm değiştirilmez; önceki sürüm ayrı ve doğrulanmış dağıtım paketinden seçilir.
2. Önce mevcut sürümde ilgili otomasyon kapatılır ve özellik salt okunur/kapalı moda alınır. F02 için söz, takip, görüşme, bağ ve audit kayıtları silinmez; migration geri alınarak iş verisi yok edilmez. Özellik kapatma ve eski binary'ye dönüş ayrı işlemlerdir.
3. API ve worker, tanımlı servis yöneticisi üzerinden kontrollü yönetilir; yalnız bir porta göre süreç öldürme uygulanmaz. F02 öncesi hatırlatma kodu açık itirazı tanımayabilir. Eski sürüme geçmeden müşteri hatırlatma/ihtar gönderimi ve ilgili AI yürütme yolları durdurulmalıdır. AI controller metodunu süreç içinden çağırabildiği için yalnız HTTP yolunu proxy'de engellemek yeterli kabul edilmez. Engel doğrulanmadan eski gönderici süreçler başlatılmaz.
4. Önceki paketin yeni şemayla uyumu, API/web/worker eşleşmesi ve Node/workspace/Prisma bağımlılıkları izole ortamda kanıtlanır. Bir eski servis dosyasının karşılaştırılması veya yeni sürümde özelliği kapatmak, tam eski binary kabulü değildir. Onaylı önceki dağıtım paketi yoksa bu kapı açık kalır.
5. Kapsamı ve gerekli yetkilendirmesi belli geçişte önceki paket servis yöneticisiyle uygulanır. API/web/worker sağlık/sürüm kontrolleri yanında tenant erişimi, mali kaynak tutarlılığı ve kapalı gönderim yolları doğrulanır. Tek `/health` yanıtı geri dönüş kabulü değildir.
6. Yeni aday tekrar açılacaksa şema, şirket modu, sorumlu ve kullanıcı tercihleri güncel haliyle kontrol edilir. Worker tekrarının mevcut söz bağlarını/bildirimleri çoğaltmadığı doğrulanır; kesinti sırasında oluşmuş doğal işler ayrıca incelenir. Yayın ve alan kabulü kaydı kapatılır.

F02'nin somut adayları, yerel pilot durumu ve bu sınırların kanıtları [F02 pilot/yayın kaydında](F02-PILOT-VE-YAYIN-HAZIRLIGI-2026-10-16.md) tutulur. Bu metnin güncellenmesi çalışan süreçlere veya gerçek şirket ayarlarına müdahale etmez.
