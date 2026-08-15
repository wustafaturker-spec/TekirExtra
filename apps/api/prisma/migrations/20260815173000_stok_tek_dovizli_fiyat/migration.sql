DROP INDEX IF EXISTS "stok_fiyatlari_tenant_id_stok_id_varyant_id_tip_doviz_cinsi_key";
DROP INDEX IF EXISTS "stok_fiyatlari_tenant_id_stok_id_tip_doviz_cinsi_idx";

CREATE UNIQUE INDEX "stok_fiyatlari_tenant_id_stok_id_varyant_id_tip_key"
ON "stok_fiyatlari"("tenant_id", "stok_id", "varyant_id", "tip") NULLS NOT DISTINCT;

CREATE INDEX "stok_fiyatlari_tenant_id_stok_id_tip_idx"
ON "stok_fiyatlari"("tenant_id", "stok_id", "tip");
