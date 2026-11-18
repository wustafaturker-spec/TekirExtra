# TekirExtra V3.2 — Digital Workforce Management

**Durum:** Revize üretim mimarisi — Hermes / Codex CLI / Claude Code Pro hibrit çalıştırıcı modeli  
**Temel:** V3 ve V3.1 üzerine geriye uyumlu genişleme  
**Amaç:** Kalıcı kimlikli, yetkili, denetlenebilir dijital çalışanlardan oluşan otonom işletme operasyon platformu.

## 1. Hedef ve kapsam

TekirExtra V3.2; muhasebe, cari hesap, teklifler, müşteri iletişimi ve operasyon görevlerinde uzman dijital çalışanları yönetir. Master Agent görev planlar, dağıtır, sonuçları kontrol eder. Kritik işlemlerde kullanıcı onayı alınır. Mevcut V3.1 iş mantığı yeniden yazılmaz; adaptörlerle korunur.

### Kapsam dışı
- Kullanıcı onayı olmadan dışarıya teklif gönderme veya yeni cari hesap açma.
- Modelin doğrudan veritabanında sınırsız SQL çalıştırması.
- Doğrulanmamış üçüncü taraf ajanların üretim ortamına doğrudan alınması.
- Mevcut muhasebe kayıtlarının kontrolsüz otomatik değiştirilmesi.

## 2. Mimari ilkeler

1. **Model bağımsızlık:** Claude Code, Codex, Hermes, OpenCode, API ve yerel LLM için ortak Runtime Adapter arayüzü.
2. **Kalıcı çalışan:** Employee ID, rol, yetki, sürüm, hafıza ve performans geçmişi.
3. **En az yetki:** Her araç ve veri alanı için politika denetimi; tenant izolasyonu.
4. **Görev dayanıklılığı:** Kalıcı durum makinesi, idempotency key, tekrar deneme ve dead-letter queue.
5. **İnsan denetimi:** Risk temelli onay; finansal taahhüt, cari hesap oluşturma, dış iletişim gibi eylemler için tanımlı onay.
6. **Gözlemlenebilirlik:** Audit log, trace, görev maliyeti, token kullanımı, sonuç kalitesi.
7. **Geriye uyumluluk:** V3.1 servislerine API/adaptör katmanı; feature flag ile aşamalı geçiş.

## 3. Mantıksal bileşenler

```text
TekirExtra Web / Desktop / Mobile UI
  ├── Digital Employee Directory
  ├── Unified Inbox & Agent Messenger
  ├── Task Board / Activity Timeline
  ├── Approval Center
  └── Performance Dashboard
             │
API Gateway + Identity + Tenant Context
             │
Master Agent / Chief of Staff
             │
Digital Workforce Management
  ├── Employee Registry
  ├── Role & Skills Catalog
  ├── Lifecycle Manager
  ├── Workforce Planner
  ├── Task Orchestrator
  ├── Memory Service
  ├── Policy / Approval Engine
  ├── Performance & Evaluation
  └── Audit & Observability
             │
Runtime Gateway
  ├── Codex Adapter
  ├── Claude Adapter
  ├── Hermes Adapter
  ├── OpenCode Adapter
  ├── API LLM Adapter
  └── Local Model Adapter
             │
TekirExtra Business API / Tools
  ├── Accounting & Ledger
  ├── CRM / Current Accounts
  ├── Offers & Pricing
  ├── Inventory
  ├── Email / Messaging
  └── Reports / Documents
```

**Entegrasyon kuralı:** Master Agent ve Runtime Gateway yalnızca izinli Business API uç noktalarını kullanır; doğrudan üretim DB yazma yetkisi yoktur.

## 4. Dijital çalışan veri modeli

### digital_employees
- `id` UUID PK
- `tenant_id` UUID NOT NULL
- `display_name`, `role_id`, `description`
- `manager_employee_id` NULLABLE
- `runtime_profile_id`, `policy_profile_id`
- `status` ENUM(draft, active, paused, retired)
- `version` INTEGER, `created_at`, `updated_at`

### employee_skills
- `employee_id`, `skill_id`, `skill_version`, `enabled`

### employee_assignments
- `id`, `tenant_id`, `employee_id`, `task_id`, `assigned_by`, `status`, `created_at`

### workforce_tasks
- `id`, `tenant_id`, `type`, `request_payload_ref`, `status`, `priority`
- `parent_task_id`, `idempotency_key`, `retry_count`, `deadline_at`
- `created_by`, `assigned_employee_id`, `created_at`, `updated_at`

### task_events
- `id`, `tenant_id`, `task_id`, `event_type`, `actor_id`, `trace_id`, `payload_ref`, `created_at`

### approval_requests
- `id`, `tenant_id`, `task_id`, `action_type`, `risk_level`
- `action_digest`, `requested_by`, `approver_id`, `status`, `expires_at`, `decided_at`

### employee_memory
- `id`, `tenant_id`, `employee_id`, `scope`, `source_ref`, `content_ref`
- `classification`, `confidence`, `expires_at`, `created_at`

### performance_metrics
- `id`, `tenant_id`, `employee_id`, `task_id`, `metric_name`, `metric_value`, `evaluation_version`, `created_at`

### runtime_profiles
- `id`, `tenant_id`, `provider`, `model`, `cost_budget`, `timeout_seconds`, `config_ref`

**Veritabanı gereksinimleri:** Tenant bazlı izolasyon/RLS; benzersiz `(tenant_id, idempotency_key)` (uygun kapsamda); FK, index ve migration; hassas içerikler için şifreleme ve saklama süresi.

## 5. Ajan yaşam döngüsü

`draft → active ↔ paused → retired`

- `draft`: Kimlik, rol, yetki ve runtime seçilir.
- `active`: Görev kabul eder; tanımlı yetkilerle çalışır.
- `paused`: Yeni görev almaz; devam eden işler kontrollü durdurulur.
- `retired`: Yeni iş almaz; geçmiş ve denetim kayıtları saklama politikasına göre korunur.

Yeni ajan oluşturma talebi: Master Agent → role template → budget/policy validation → registry → sandbox validation → activation. Yüksek yetkili rol oluşturma kullanıcı/yönetici onayı gerektirir.

## 6. Görev orkestrasyonu

Durumlar: `created`, `triaged`, `planned`, `queued`, `running`, `waiting_approval`, `blocked`, `completed`, `failed`, `cancelled`.

- Planlar DAG olarak ifade edilir; bağımlılıklar tamamlanmadan alt görev başlamaz.
- Her dış etkili işlem idempotency key kullanır.
- Geçici hatalarda exponential backoff, kalıcı hatalarda insan eskalasyonu.
- Worker crash sonrası checkpoint'ten devam; süresi dolan kilitler geri alınır.
- İşlem başarısı yalnızca model çıktısına değil Business API teyidine dayanır.

## 7. Yetki ve onay matrisi

| Eylem | Varsayılan davranış |
|---|---|
| Gelen e-postayı sınıflandırma | Otomatik, erişim iznine bağlı |
| Mevcut cari hesabı arama | Otomatik, kapsamlı audit |
| Kamuya açık firma araştırması | Otomatik, kaynak kaydıyla |
| Teklif taslağı hazırlama | Otomatik |
| Teklifin müşteriye gönderimi | Kullanıcı onayı |
| Yeni cari hesap açma | Kullanıcı onayı |
| Muhasebe fişi kesinleştirme | Yetkili kullanıcı onayı |
| Para transferi / ödeme | Güçlü onay, ayrı güvenlik kontrolleri |
| Ajan rol/yetki yükseltme | Yönetici onayı |
| Salt okunur rapor üretme | Otomatik |

Onaylar; tam işlem özeti, değiştirilemez işlem özeti (digest), kapsam, süre sonu ve yetkili kullanıcıyla ilişkilendirilir. Onaydan sonra işlem parametreleri değişirse yeniden onay gerekir. Master Agent politika motorunu geçersiz kılamaz.

## 8. Hafıza mimarisi

- **Working memory:** Geçerli görev bağlamı; kısa ömürlü.
- **Employee memory:** Ajana ait tercih, öğrenim ve çalışma geçmişi; sürümlü.
- **Customer memory:** CRM ve müşteri ilişkisi bağlamı; tenant sınırları içinde.
- **Organizational knowledge:** Prosedür, politika ve ürün bilgileri; kaynaklı ve izinli.
- **Episodic memory:** Görev sonuçları, hatalar, onaylar, değerlendirmeler.

Her kayıt için kaynak, erişim etiketi, saklama süresi ve gerektiğinde silme/yenileme mekanizması olmalı. Hafıza içerikleri komut olarak değil, güvenilmeyen bağlam olarak ele alınmalı; prompt injection kontrolleri uygulanmalı.

## 9. Unified Inbox / Agent Messenger

Kanallar: kullanıcı↔ajan, kullanıcı↔ajan ekibi, ajan↔ajan, müşteri/iş akışı bağlamı. Mesaj türleri: text, voice transcript, attachment, task card, approval request, system event. Dosyalar zararlı içerik taramasından geçirilir. Gerçek zamanlı akış için WebSocket/SSE; kalıcı teslimat için event store. Ajanlar arası mesajlar da yetki ve tenant kontrolünden geçer.

## 10. Runtime Adapter sözleşmesi

```typescript
interface AgentRuntimeAdapter {
  capabilities(): Promise<RuntimeCapabilities>;
  start(input: AgentRunInput): Promise<AgentRunHandle>;
  stream(runId: string): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  getResult(runId: string): Promise<AgentRunResult>;
}
```

`AgentRunInput`: tenant context, employee identity, task ID, scoped tool tokens, time/token/cost budgets, trace ID. Sağlayıcı adaptörleri özellik ve izin farklarını açıkça raporlamalı; tüm CLI'ların aynı özellikleri sunduğu varsayılmamalı.

## 11. API sözleşmesi (öneri)

- `POST /api/v3/workforce/employees`
- `GET /api/v3/workforce/employees`
- `PATCH /api/v3/workforce/employees/{id}`
- `POST /api/v3/workforce/employees/{id}/pause`
- `POST /api/v3/workforce/tasks`
- `GET /api/v3/workforce/tasks/{id}`
- `POST /api/v3/workforce/tasks/{id}/cancel`
- `GET /api/v3/workforce/tasks/{id}/events`
- `GET /api/v3/workforce/approvals`
- `POST /api/v3/workforce/approvals/{id}/decision`
- `GET /api/v3/workforce/performance`

Tüm endpoint'ler kimlik doğrulama, tenant scope, rate limit, request validation ve audit uygular.

## 12. Referans iş akışı: Yeni müşteri teklif talebi

1. E-posta entegrasyonu gelen mesajı alır; kaynak kimliğiyle olay üretir.
2. Triage ajanı mesajı teklif talebi olarak sınıflandırır.
3. CRM ajanı mevcut müşteri kaydını arar; eşleşme belirsizse kullanıcıya sorar.
4. Araştırma ajanı yeni firmayı yalnızca izinli açık kaynaklardan araştırır; kaynakları iliştirir.
5. Teklif ajanı fiyat/stok/marj bilgilerini Business API üzerinden toplar ve taslak üretir.
6. Master Agent eksikleri, marj sınırlarını ve riskleri değerlendirir.
7. Yeni cari hesap açma gerekiyorsa işlem önizlemesiyle kullanıcı onayı alınır.
8. Teklifin gönderilmesi için alıcı, tutar, koşullar ve eklerle ayrı onay alınır.
9. İşlem sonucu CRM ve görev geçmişine yazılır; müşteriye gönderim API teyidi alınır.
10. Performans, maliyet ve hata ölçümleri kaydedilir.

## 13. Arayüz gereksinimleri

### Digital Employees
Çalışan kartları: isim, rol, durum, son görev, başarı oranı, bütçe kullanımı, yetkiler. Profil sayfası: görev geçmişi, izinler, beceriler, hafıza kaynakları, çalışma modeli.

### Mission Control
Görev panosu, bağımlılık grafiği, canlı olay akışı, başarısız iş kuyruğu, durdur/yeniden dene.

### Approval Center
Sadece kritik işlemler; kullanıcıya sade dille “ne yapılacak / etkisi / tutarı / alıcısı / neden onay gerekiyor” gösterilir. Toplu onay yalnızca politika izin verirse.

### Messenger
Müşteri, proje ve ekip kanalları; sesli mesaj dökümü, dosya, ajan çağırma, görevden konuşmaya ve konuşmadan göreve geçiş.

### Performance
Başarı, insan müdahalesi, ortalama süre, görev başı maliyet, hata, yeniden deneme, onay gecikmesi, doğruluk ölçümü.

## 14. Güvenlik ve operasyon

- Secrets manager, kısa ömürlü erişim belirteçleri, araç bazlı scope.
- Prompt injection, veri sızdırma, çapraz tenant erişimi ve yetki yükseltme testleri.
- Finansal kayıtlar için çift kayıt önleme, mutabakat ve telafi işlemleri.
- Audit log append-only; hassas veri maskeleme ve erişim izleri.
- Sağlık kontrolleri, kuyruk derinliği, worker restart, circuit breaker.
- Veri koruma: KVKK, saklama/silme, rol tabanlı erişim, yedekleme.
- Harici mesajlar ve dokümanlar güvenilmeyen girdi kabul edilir.

## 15. Aşamalı üretim planı

### Faz 0 — Mevcut sistem keşfi ve sözleşmeler
**Çıktı:** V3.1 modül envanteri, API ve veri akışları, yetki modeli, entegrasyon noktaları.  
**Kabul:** Mevcut davranışlar ve geriye uyumluluk testleri belgelenmiş.

### Faz 1 — Workforce Registry + Lifecycle
**Çıktı:** Şema/migration, çalışan CRUD, rol/skill profilleri, lifecycle, UI kartları.  
**Kabul:** Çalışan oluşturma/duraklatma/retire ve tenant izolasyonu testleri geçer.

### Faz 2 — Task Orchestration + Runtime Gateway
**Çıktı:** Kalıcı görev durum makinesi, kuyruk, worker, en az iki runtime adaptörü.  
**Kabul:** Yeniden başlatmada görev kaybı yok; idempotency ve retry testleri geçer.

### Faz 3 — Policy Engine + Approval Center
**Çıktı:** Risk sınıflandırması, izinli Business API çağrıları, onay ekranları.  
**Kabul:** Onaysız kritik işlem engellenir; parametre değişirse eski onay geçersizdir.

### Faz 4 — Memory + Messenger
**Çıktı:** Kaynaklı hafıza, erişim kontrolü, kanallar, olay akışı.  
**Kabul:** Tenant dışı bilgi görünmez; silme/erişim testleri geçer.

### Faz 5 — İşletme senaryoları
**Çıktı:** E-posta triage, müşteri kontrolü, araştırma, teklif taslağı, onaylı cari açma ve gönderme.  
**Kabul:** Uçtan uca senaryo, olumsuz durumlar ve onay akışları otomasyon testlerinden geçer.

### Faz 6 — Performance, Hardening ve Pilot
**Çıktı:** Dashboard, değerlendirme veri setleri, maliyet limitleri, yük/güvenlik testleri, pilot.  
**Kabul:** Pilot KPI eşikleri belirlenir ve karşılanır; rollback planı denenir.

## 16. Önerilen geliştirme iş paketleri

- **W01** V3.1 keşfi ve contract testleri
- **W02** Workforce DB migration + repository
- **W03** Employee Registry API + UI
- **W04** Role/Skill/Policy katalogları
- **W05** Task state machine + queue + worker
- **W06** Runtime Gateway + Codex/Hermes adaptör prototipleri
- **W07** Policy Enforcement + Approval Center
- **W08** Audit/Event Store + tracing
- **W09** Memory Service + retrieval permissions
- **W10** Unified Messenger + kanallar
- **W11** CRM/Offer/Email business tool adaptörleri
- **W12** E2E teklif talebi akışı
- **W13** Evaluation + Performance dashboard
- **W14** Security, resilience, rollback ve pilot

## 17. Test planı

**Unit:** policy kararları, görev geçişleri, bütçe limitleri, rol/skill çözümleme.  
**Integration:** Business API, runtime adapter, event delivery, approval, DB migration.  
**E2E:** Yeni müşteri teklif akışı; var olan müşteri; eksik veri; ret; iptal; timeout; tekrar mesaj; provider kesintisi.  
**Security:** Tenant sızıntısı, prompt injection, tool abuse, approval replay, secret exposure.  
**Resilience:** DB kesintisi, queue redelivery, worker crash, kısmi dış API başarısı.  
**Regression:** V3.1 muhasebe ve CRM davranışlarının korunması.

## 18. Ölçülebilir başarı kriterleri

Pilot öncesinde iş yükü bazlı hedefler kesinleştirilmelidir. Başlangıç önerileri:
- Kritik işlemlerde onaysız icra: **0**.
- Çapraz tenant veri erişimi: **0**.
- Görev olaylarında kayıp: **0** (test edilen hata senaryolarında).
- İş akışı uçtan uca başarı: hedef **≥ %95** (kontrollü pilot veri setinde).
- Tüm ajan eylemlerinde trace/audit kapsamı: **%100**.
- İşlem başı model maliyeti ve kullanıcı müdahalesi ölçülebilir.

## 19. Dağıtım ve geçiş

1. `workforce_v32` feature flag altında yeni servisleri ekle.
2. Migration'ları önce staging üzerinde çalıştır; eski V3.1 API'larını değiştirme.
3. Salt okunur ajanlarla başla; teklif taslaklarını gölge modda üret.
4. Onay motorunu zorunlu kılmadan yazma yetkisi verme.
5. Pilot tenant'larda sınırlı yetki ve bütçeyle aç.
6. Hata durumunda feature flag kapat, bekleyen görevleri güvenli duruma al, audit'i koru.

## 20. Açık kararlar

- Mevcut V3.1 backend dili, framework ve veritabanı nedir?
- Hangi iş akışları ve mesajlaşma altyapısı zaten kodlandı?
- Runtime çalıştırma ortamı Linux sunucu, Docker veya hibrit mi?
- Hangi modeller ilk sürümde desteklenecek?
- Tek tenant mı, çok şirketli kullanım mı?
- Teklif gönderme ve cari açma için kullanıcı yetki hiyerarşisi nasıl?

**Uygulama notu:** Bu belge mevcut V3.1 kaynak kodu görülmeden hazırlanmış bir hedef mimari ve üretim planıdır. Kod seviyesinde dosya yolları, migration isimleri ve sprint süreleri mevcut repo keşfinden sonra netleştirilmelidir.


---

# REVİZYON R1 — Hermes Agent + Abonelik Kontrollü Hibrit Runtime

**Tarih:** 18 Ekim 2026  
**Kapsam:** Önceki 20 bölüm korunur. Bu revizyon, runtime önceliklerini, faturalama emniyetini ve Hermes adaptörünün kabul kriterlerini somutlaştırır.  
**Önemli:** Buradaki ürün entegrasyonu bir hedef tasarımdır; V3.1 kaynak kodu, abonelik yetkileri ve gerçek sağlayıcı davranışı henüz test edilmemiştir.

## 21. Bağlayıcı mimari kararları (ADR)

| ADR | Karar | Gerekçe |
|---|---|---|
| ADR-01 | TekirExtra Master Agent ve Policy Engine bağımsızdır | Hermes yetki sınırlarını değiştiremez |
| ADR-02 | Hermes varsayılan **uzman ajan** runtime'ıdır; zorunlu tek runtime değildir | Hafıza/skills kazanımı ve taşınabilirlik |
| ADR-03 | Codex CLI ve Claude Code CLI mevcut abonelik oturumlarıyla ayrı adaptörlerdir | Var olan iş akışlarını korumak |
| ADR-04 | `paid_api_enabled=false`, `auto_topup=false`, `fallback_to_paid_api=false` | Öngörülemeyen API faturasını önlemek |
| ADR-05 | Kota dolunca `WAITING_FOR_QUOTA` veya izinli başka runtime | Görev kaybını ve gizli faturayı önlemek |
| ADR-06 | Ajan hafızası tenant/çalışan/iş alanı bazında ayrılır | Ticari veri izolasyonu |
| ADR-07 | Dış dünyaya yazan işlemler her durumda TekirExtra araç geçidinden geçer | Finansal doğruluk ve denetim |

## 22. Abonelik ve API gerçekliği — doğrulama kapısı

- **Claude Pro:** Claude Code CLI, sağlayıcının geçerli plan sınırları ve kullanım koşulları içinde kullanılır. Hermes'in Anthropic API çağrıları Claude Pro'ya dahil varsayılmaz. Claude Code'un CLI/SDK otomasyon senaryolarının güncel koşulları üretim öncesi kontrol edilir.
- **Codex CLI:** Mevcut ChatGPT/Codex abonelik kimlik doğrulaması korunur. Hermes'in ChatGPT/Codex OAuth entegrasyonu, desteklenen sürümde ve hesapta *pilot ile doğrulanmadan* abonelik kapsamındaki ücretsiz kullanım kabul edilmez.
- **Hermes:** Açık kaynak kod lisans maliyeti sıfır olabilir; model çağrıları, ek servisler ve işletim giderleri ayrıca ele alınır. Hermes'in varsayılan model sağlayıcısı `subscription_eligible` doğrulamasından geçmedikçe çalıştırılmaz.
- **API anahtarları:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ve benzeri ücretli sağlayıcı kimlik bilgileri Hermes servis ortamına verilmez. Mevcut uygulamanın başka servislerindeki anahtarlar Hermes'e aktarılmaz.
- **Ücretli kullanım engeli:** Yerel router'da ücretli sağlayıcılar devre dışı bırakılır; varsa sağlayıcı panelinde de bütçe/kredi ayarları kontrol edilir. Yerel bir `false` bayrağı tek başına dış sağlayıcı faturalarını teknik olarak garanti etmez.
- **Kesin maliyet:** Ek lisans $0 hedefi; ek API faturası $0 ancak ödeme kanalı kullanılmazsa; ek sunucu $0 ancak kapasite yeterliyse. Geliştirme, bakım ve kota fırsat maliyeti sıfır değildir.

## 23. Runtime seçim ve kota durum makinesi

```text
Task Created
  -> Policy Precheck
  -> Runtime Eligibility Check
     -> Hermes subscription-backed [verified]
     -> Codex CLI [verified]
     -> Claude Code CLI [verified]
  -> Quota Reservation / Concurrency Guard
  -> RUNNING
     -> SUCCESS / FAILED_RETRYABLE / NEEDS_APPROVAL
     -> RATE_LIMITED => WAITING_FOR_QUOTA
     -> AUTH_EXPIRED => WAITING_FOR_REAUTH
     -> PAYMENT_REQUIRED => BLOCKED_BILLING
  -> Audit + Metering + Memory Commit (after validation)
```

**Seçim algoritması:** Yetki ve veri yerleşimi > abonelik uygunluğu > kota kullanılabilirliği > görev tipi/model yeterliliği > bekleme süresi. Fiyatı bilinmeyen veya faturalama şekli doğrulanmamış runtime `ineligible` sayılır. Kota sinyalleri API'den okunamıyorsa gerçek durum `unknown` olarak saklanır; otomatik ücretli geçiş yapılmaz.

## 24. Runtime Adapter sözleşmesi (öneri)

```typescript
type BillingMode = 'SUBSCRIPTION' | 'LOCAL' | 'PAID_API';
type QuotaState = 'AVAILABLE' | 'LIMITED' | 'EXHAUSTED' | 'UNKNOWN';
interface RuntimeAdapter {
  id: 'hermes' | 'codex-cli' | 'claude-code';
  capabilities(): Promise<string[]>;
  authStatus(): Promise<'READY' | 'EXPIRED' | 'UNVERIFIED'>;
  billingMode(): Promise<BillingMode>;
  quotaStatus(): Promise<{ state: QuotaState; resetAt?: string }>;
  execute(task: SignedTask, ctx: ScopedContext): AsyncIterable<RuntimeEvent>;
  cancel(runId: string): Promise<void>;
  health(): Promise<'HEALTHY' | 'DEGRADED' | 'DOWN'>;
}
```

**Güvenlik:** `SignedTask` imzalı yetki kapsamı taşır; adapter bu kapsamı genişletemez. Araç çağrıları yalnızca `ToolGateway` üzerinden gider. Görev başına timeout, eşzamanlılık sınırı, iptal, idempotency ve sandbox zorunludur. CLI çıktısı güvenilmeyen içerik kabul edilir.

## 25. Hermes entegrasyon stratejisi

1. Hermes'i izole container/işletim kullanıcısı altında kur; çalışma dizinini ve ağ erişimini kısıtla.
2. Hermes sürümünü sabitle; belgelenmiş CLI/SDK/ACP veya API giriş noktalarını sürüm bazında doğrula. Var olmayan bir endpoint varsayma.
3. Kimlik doğrulama testinde abonelik destekli erişimin gerçekten kullanılabildiğini ve ücretli API çağrısı üretmediğini kontrol et.
4. Hermes hafızası ve skills deposunu tenant + employee ID ile bölümlendir; skills değişikliklerini otomatik üretime alma.
5. Master Agent görev zarfını Hermes adaptörüne gönderir; Hermes iş servislerine doğrudan veritabanı yetkisi almaz.
6. Hermes'in alt ajanları aynı bütçe, yetki, süre ve veri sınırlarını miras alır; alt ajan sayısı sınırlanır.
7. Çalışma izleri, harcanan çağrı/işlem sayısı, onay talepleri ve hata sınıfları ortak telemetry katmanına gönderilir.

## 26. Claude Code ve Codex CLI adaptörleri

- Mevcut CLI oturumlarını kullan; API anahtarı ekleyerek farkında olmadan API faturalamasına geçme.
- CLI sürümünü, kimlik doğrulama şeklini ve desteklenen noninteractive çağrıları keşif fazında doğrula.
- Her çalıştırma için izole workspace, `cwd` kısıtı, süreç timeout'u ve kaynak kotası uygula.
- CLI çıktısından yapılandırılmış sonuç almak için doğrulanmış şema kullan; serbest metinden kritik işlemi doğrudan tetikleme.
- CLI erişimi ve abonelik kotası paylaşılıyorsa, Hermes ile Codex'in birbirini aç bırakmaması için concurrency limitleri uygula.

## 27. Politika, finansal onay ve öğrenme emniyeti

| Eylem | Varsayılan kural |
|---|---|
| Gelen e-postayı sınıflandırma | Otomatik, okuma yetkisiyle |
| Kamuya açık firma araştırması | Otomatik, kaynak ve oran sınırıyla |
| Teklif taslağı oluşturma | Otomatik, taslak olarak |
| Yeni cari hesap açma | Yetkili kullanıcı onayı |
| Teklifi müşteriye gönderme | Yetkili kullanıcı onayı |
| Muhasebe kaydı değiştirme | İşlem türüne göre yetkili onay + doğrulama |
| Skills dosyasını güncelleme | Test, sürümleme ve onaydan sonra etkinleştirme |
| Yeni ajan oluşturma | Tanımlı kaynak/rol limitleri içinde; yüksek yetki için onay |

Prompt injection'a karşı gelen e-posta, PDF, web içeriği ve skills kaynakları güvenilmeyen girdi sayılır. Öğrenilen bir beceri erişim yetkisini değiştiremez.

## 28. Gözlemlenebilirlik ve bütçe kontrolü

Önerilen alanlar: `tenant_id`, `employee_id`, `task_id`, `runtime_id`, `auth_mode`, `billing_mode`, `quota_state`, `estimated_tokens`, `actual_tokens_if_available`, `wall_time_ms`, `tool_calls`, `retries`, `approval_count`, `outcome`, `provider_charge_if_available`.

Gösterge panosu: runtime başına görev sayısı, başarı, gecikme, kota bekleme süresi, abonelik kullanım baskısı, hata oranı, faturalama ihlali sayısı. Token verisi sağlayıcıdan gelmiyorsa tahmin olarak işaretlenir; abonelik kotası token ile bire bir eşdeğer kabul edilmez.

## 29. Revize geliştirme fazları ve kabul kriterleri

| Faz | Teslimat | Kabul kriteri |
|---|---|---|
| R0 — Keşif | V3.1 modül/CLI/env envanteri; Hermes sürüm ve OAuth doğrulaması | Gerçek komutlar ve faturalama modu kanıtlandı |
| R1 — Runtime Gateway | 3 adaptör + politika ve kota durumu | Ücretli API seçimi imkânsız; fail-closed testleri geçti |
| R2 — Hermes pilot | Tek uzman ajan, skills ve bellek adaptörü | İzole veri; 20 smoke test başarılı |
| R3 — İş akışları | Gelen teklif e-postası → araştırma → taslak → onay | Dış gönderim ve cari açma onaysız yapılamaz |
| R4 — Öğrenme | Skills değerlendirme, sürümleme, rollback | Zararlı/hatalı skill otomatik etkinleşmez |
| R5 — Performans | 100 görevlik karşılaştırmalı pilot | Başarı, kota, süre ve maliyet raporu tamam |
| R6 — Kademeli dağıtım | Feature flags, rollback, runbook | V3.1'e kesintisiz geri dönüş gösterildi |

**İlk pilot limitleri (öneri):** 1 Hermes çalışanı, en fazla 2 eşzamanlı iş, 15 dakika görev zaman aşımı, ücretli API = kapalı, dış yazma araçları = kapalı. Gerçek kota/süre sınırları ölçüme göre ayarlanır.

## 30. Kabul testleri — zorunlu

- API anahtarı yokken Hermes/Codex/Claude CLI izin verilen yollarla çalışıyor mu?
- `PAYMENT_REQUIRED`, 429, timeout, auth expiry ve kota bilinmiyor durumlarında ücretli fallback kesinlikle engelleniyor mu?
- Bir tenant'ın hafızası başka tenant'a sızıyor mu?
- Ajan, onay olmadan teklif göndermeyi veya cari hesap açmayı deneyince araç geçidi reddediyor mu?
- Hermes alt ajanı üst ajan yetki ve kaynak sınırlarını aşabiliyor mu?
- Yanlış öğrenilmiş skill rollback ile eski sürüme dönebiliyor mu?
- Ajanın iptali gerçekten alt süreçleri ve sandbox görevlerini sonlandırıyor mu?
- V3.1 akışları Hermes kapalıyken aynen çalışıyor mu?

## 31. Teslimat ve uygulama öncesi açık noktalar

1. TekirExtra V3.1 kaynak kodu ve mevcut deployment dosyaları incelenmedi; entegrasyon dosyaları henüz belirlenemez.
2. ChatGPT/Codex abonelik planı ve Hermes'in hesapta desteklenen abonelik kimlik doğrulaması doğrulanmalı.
3. Claude Pro'nun mevcut CLI kullanımına uygulanan güncel otomasyon/abonelik koşulları doğrulanmalı.
4. Sunucu CPU/RAM/depolama, container izinleri ve beklenen eşzamanlı iş sayısı ölçülmeli.
5. Hermes sürümünün gerçek CLI/SDK arayüzü ve alt ajan özellikleri test edilmeli.

**Go/no-go:** R0 sonunda Hermes'in abonelik temelli erişimi ücretli API olmadan doğrulanamazsa Hermes üretim runtime'ı olarak açılmaz. Codex CLI + Claude Code mevcut düzeni çalışmaya devam eder; Hermes'in yerel skills/memory işlevlerinden model çağrısı gerektirmeyen parçalar ayrıca değerlendirilebilir.
