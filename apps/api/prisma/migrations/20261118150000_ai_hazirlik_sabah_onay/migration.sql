-- P-19: Ajan Hazırlık Katmanı ve Sabah Onay Kutusu

-- 1. AiGorevCalismaDurumu enum genişletmesi (3.2: yeni değerler eklenir, eskiler okunabilir kalır)
ALTER TYPE "AiGorevCalismaDurumu" ADD VALUE IF NOT EXISTS 'kismi_basarili';
ALTER TYPE "AiGorevCalismaDurumu" ADD VALUE IF NOT EXISTS 'atlandi';

-- 2. ai_hazirliklar tablosu
CREATE TABLE IF NOT EXISTS "ai_hazirliklar" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "tur" VARCHAR(50) NOT NULL,
    "durum" VARCHAR(30) NOT NULL DEFAULT 'hazir',
    "tekil_anahtar" VARCHAR(120) NOT NULL,
    "kaynak_tur" VARCHAR(50),
    "kaynak_id" VARCHAR(100),
    "baslik" VARCHAR(200) NOT NULL,
    "ozet" TEXT NOT NULL,
    "oneri" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "kanit" JSONB,
    "alternatifler" JSONB,
    "hedef_ozeti" VARCHAR(128),
    "gecerlilik_bitis_at" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
    "hazirlayan_gorev_id" UUID,
    "hazirlayan_calisma_id" UUID,
    "olusturan_user_id" UUID,
    "onaylayan_user_id" UUID,
    "karar_at" TIMESTAMP(3) WITHOUT TIME ZONE,
    "karar_notu" TEXT,
    "olusan_kayit_tur" VARCHAR(50),
    "olusan_kayit_id" VARCHAR(100),
    "hata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_hazirliklar_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_hazirliklar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_hazirliklar_hazirlayan_gorev_id_fkey" FOREIGN KEY ("hazirlayan_gorev_id") REFERENCES "tenant_ai_gorevleri"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_hazirliklar_hazirlayan_calisma_id_fkey" FOREIGN KEY ("hazirlayan_calisma_id") REFERENCES "tenant_ai_gorev_calismalari"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_hazirliklar_olusturan_user_id_fkey" FOREIGN KEY ("olusturan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_hazirliklar_onaylayan_user_id_fkey" FOREIGN KEY ("onaylayan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ai_hazirliklar_tenant_id_tekil_anahtar_key" UNIQUE ("tenant_id", "tekil_anahtar"),
    CONSTRAINT "ai_hazirliklar_durum_check" CHECK (durum IN ('hazir', 'onaylandi', 'reddedildi', 'suresi_doldu', 'hedef_degisti', 'hata')),
    CONSTRAINT "ai_hazirliklar_tur_check" CHECK (tur IN ('fatura_stok_esleme', 'banka_ekstre_esleme', 'vadesi_gecen_hatirlatma', 'kritik_stok_talep', 'ay_sonu_kapanis'))
);

-- İndeksler
CREATE INDEX IF NOT EXISTS "ai_hazirliklar_tenant_id_durum_gecerlilik_bitis_at_idx" ON "ai_hazirliklar"("tenant_id", "durum", "gecerlilik_bitis_at");
CREATE INDEX IF NOT EXISTS "ai_hazirliklar_tenant_id_tur_created_at_idx" ON "ai_hazirliklar"("tenant_id", "tur", "created_at");

-- RLS (Tenant İzolasyonu)
ALTER TABLE "ai_hazirliklar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_hazirliklar" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ai_hazirliklar ON "ai_hazirliklar";
CREATE POLICY tenant_isolation_ai_hazirliklar ON "ai_hazirliklar"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
