ALTER TYPE "EkSahipTur" ADD VALUE IF NOT EXISTS 'personel';

CREATE TYPE "PersonelBelgeTuru" AS ENUM (
  'kimlik', 'is_sozlesmesi', 'diploma', 'sertifika', 'saglik_raporu',
  'adli_sicil', 'ikametgah', 'askerlik', 'sgk_bildirgesi', 'diger'
);

CREATE TABLE "personel_belgeleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "personel_id" UUID NOT NULL,
  "ek_id" UUID NOT NULL,
  "tur" "PersonelBelgeTuru" NOT NULL,
  "aciklama" TEXT,
  "belge_tarihi" DATE,
  "gecerlilik_tarihi" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personel_belgeleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_belgeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_belgeleri_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_belgeleri_ek_id_fkey" FOREIGN KEY ("ek_id") REFERENCES "ekler"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "personel_belgeleri_ek_id_key" ON "personel_belgeleri"("ek_id");
CREATE INDEX "personel_belgeleri_tenant_id_personel_id_created_at_idx" ON "personel_belgeleri"("tenant_id", "personel_id", "created_at");
CREATE INDEX "personel_belgeleri_tenant_id_gecerlilik_tarihi_idx" ON "personel_belgeleri"("tenant_id", "gecerlilik_tarihi");

ALTER TABLE "personel_belgeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_belgeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "personel_belgeleri"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
