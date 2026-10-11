-- RPR-24: zamanlanmış rapor e-postası aboneliği.
CREATE TABLE "rapor_abonelikleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gorunum_id" UUID NOT NULL,
    "siklik" TEXT NOT NULL,
    "gun" INTEGER,
    "saat" TEXT NOT NULL,
    "donem" TEXT NOT NULL,
    "bicim" TEXT NOT NULL,
    "bos_gonder" BOOLEAN NOT NULL DEFAULT false,
    "alici_idler" UUID[],
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sonraki_gonderim" TIMESTAMP(3) NOT NULL,
    "son_gonderim" TIMESTAMP(3),
    "son_durum" TEXT,
    "son_hata" TEXT,
    "deneme_sayisi" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rapor_abonelikleri_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rapor_abonelikleri_tenant_id_user_id_idx" ON "rapor_abonelikleri"("tenant_id", "user_id");
CREATE INDEX "rapor_abonelikleri_aktif_sonraki_gonderim_idx" ON "rapor_abonelikleri"("aktif", "sonraki_gonderim");

ALTER TABLE "rapor_abonelikleri" ADD CONSTRAINT "rapor_abonelikleri_gorunum_id_fkey" FOREIGN KEY ("gorunum_id") REFERENCES "rapor_gorunumleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kiracı yalıtımı (KLN-06)
ALTER TABLE "rapor_abonelikleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rapor_abonelikleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rapor_abonelikleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
