ALTER TABLE "users" ADD COLUMN "bayi_cari_id" UUID;
ALTER TABLE "belgeler" ADD COLUMN "b2b_idempotency_anahtari" UUID;
ALTER TABLE "belge_satirlari" ADD COLUMN "fiyat_listesi_id" UUID;

CREATE INDEX "users_tenant_id_bayi_cari_id_idx" ON "users"("tenant_id", "bayi_cari_id");
CREATE UNIQUE INDEX "belgeler_tenant_id_b2b_idempotency_anahtari_key"
  ON "belgeler"("tenant_id", "b2b_idempotency_anahtari");

ALTER TABLE "users" ADD CONSTRAINT "users_bayi_cari_id_fkey"
  FOREIGN KEY ("bayi_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
