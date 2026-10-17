# Arşiv — V2 / CLI Asistan tasarımı (kaldırıldı)

**Durum:** Geçersiz. Bu klasördeki belgeler yalnız tarihsel kayıttır; anlattıkları yapı uygulamada yoktur.

15 Ekim 2026'da "TekirExtra Accounting Intelligence V2" ve "TekirExtra CLI Assistant" planlarıyla bir asistan katmanı tasarlandı ve kısmen kodlandı (bellek içi `apps/api/src/assistant/` modülü, `api/openapi.yaml`, `docker/sandbox/`; planlanan Go arka ucu). 16 Ekim 2026'da bu katman **AI-26 (V2 temizliği)** ile kaldırıldı; nakit ve tahsilat analizi mevcut AI görev hattına taşındı (AI-23…AI-25, `ai_icgoruler`). Güncel yapay zekâ kuralları ISTERLER §3.18'dedir.

| Belge | İçerik |
|---|---|
| `TekirExtra_CLI_Assistant_Uretim_Plani_V1.md` | CLI asistan üretim planı (Go çekirdek, Docker sandbox, P0–P9) |
| `architecture-inventory.md`, `integration-decisions.md`, `integration-risks.md`, `threat-model.md`, `module-map.md` | CLI asistan P0/P1 keşif, entegrasyon ve güvenlik belgeleri |
| `v2-architecture-inventory.md`, `v2-module-map.md`, `v2-integration-risks.md`, `v2-release-runbook.md` | V2 dikey dilim (nakit akışı ve tahsilat riski) envanteri ve yayın el kitabı |

Belgelerin referans verdiği `TekirExtra_Accounting_Intelligence_V2_Detayli_Uretim_Plani.md` repoda hiç yer almadı. Arşive alınırken (2026-10-17) belgeler arası mutlak `file://` bağlantıları göreli bağlantıya çevrildi; içerik değiştirilmedi.
