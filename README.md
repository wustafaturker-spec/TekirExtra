# TekirExtra

KOBİ'lere yönelik, çok kiracılı (multi-tenant) web tabanlı ön muhasebe SaaS uygulaması.

- İsterler: [docs/ISTERLER.md](docs/ISTERLER.md)
- Mimari: [docs/MIMARI.md](docs/MIMARI.md)

## Yapı

```
apps/api        NestJS API + worker (BullMQ)
apps/web        Next.js arayüz
packages/shared Ortak DTO'lar, enum'lar, fatura hesaplama motoru
packages/baglanti Dış bağlantı adaptörleri (e-belge, pazaryeri, POS, banka)
```

## Geliştirme ortamı

Gereksinimler: Node ≥ 22, pnpm ≥ 9, Docker.

```bash
pnpm install
cp .env.example .env && cp .env.example apps/api/.env

# Altyapıyı başlat (Postgres + Redis; Metabase için: --profile analitik)
docker compose up -d postgres redis

# Veritabanı migrasyonları (RLS politikaları dahil)
pnpm --filter @tekirextra/api exec prisma migrate dev

# Derle ve test et
pnpm build && pnpm test

# API'yi çalıştır
node apps/api/dist/main.js        # http://localhost:3001/health
# Web'i çalıştır
pnpm --filter @tekirextra/web dev # http://localhost:3100
```

## Kiracı yalıtımı (RLS)

Uygulama veritabanına `tekir_app` rolüyle bağlanır; bu rolün `BYPASSRLS`
yetkisi yoktur ve tablo sahibi değildir. Kiracıya ait her tabloda
`tenant_id = current_setting('app.tenant_id')` politikası zorunludur —
sorgular `PrismaService.tenantIslem()` üzerinden, transaction başında
`SET LOCAL` kurularak çalışır. Ayrıntı: [docs/MIMARI.md §3](docs/MIMARI.md).

## Süreç kuralı

Her modülün geliştirilmesine başlamadan önce ilgili ister bölümü ürün
sahibiyle gözden geçirilip onaylanır (ISTERLER.md S-01).
