-- PRS-22 (P3-4): çalışan self-servisinden bilgi güncelleme talebi.
CREATE TABLE "personel_bilgi_talepleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "personel_id" UUID NOT NULL,
    "alanlar" JSONB NOT NULL,
    "aciklama" TEXT,
    "durum" TEXT NOT NULL DEFAULT 'bekliyor',
    "ret_nedeni" TEXT,
    "olusturan_user_id" UUID,
    "karar_veren_user_id" UUID,
    "karar_tarihi" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "personel_bilgi_talepleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "personel_bilgi_talepleri_durum_check" CHECK ("durum" IN ('bekliyor', 'onaylandi', 'reddedildi', 'iptal')),
    CONSTRAINT "personel_bilgi_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personel_bilgi_talepleri_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personel_bilgi_talepleri_tenant_id_durum_idx" ON "personel_bilgi_talepleri"("tenant_id", "durum");
CREATE INDEX "personel_bilgi_talepleri_tenant_id_personel_id_idx" ON "personel_bilgi_talepleri"("tenant_id", "personel_id");
-- Kişi başına tek açık talep.
CREATE UNIQUE INDEX "personel_bilgi_talepleri_acik_tekil" ON "personel_bilgi_talepleri"("tenant_id", "personel_id") WHERE "durum" = 'bekliyor';
ALTER TABLE "personel_bilgi_talepleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_bilgi_talepleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "personel_bilgi_talepleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
