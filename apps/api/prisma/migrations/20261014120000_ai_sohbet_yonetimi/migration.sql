ALTER TABLE "ajan_oturumlari" ADD COLUMN "baslik" VARCHAR(120);
ALTER TABLE "ajan_oturumlari" ADD COLUMN "arsivlendi_at" TIMESTAMP(3);
CREATE INDEX "ajan_oturumlari_tenant_id_user_id_arsivlendi_at_son_etkilesim_idx"
  ON "ajan_oturumlari"("tenant_id", "user_id", "arsivlendi_at", "son_etkilesim");
