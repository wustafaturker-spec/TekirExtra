CREATE TYPE "ReceteDurum" AS ENUM ('taslak', 'onay_bekliyor', 'aktif', 'pasif', 'arsiv');

ALTER TABLE "urun_receteleri"
  ADD COLUMN "surum" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "durum" "ReceteDurum" NOT NULL DEFAULT 'aktif',
  ADD COLUMN "yururluk_baslangic" DATE,
  ADD COLUMN "yururluk_bitis" DATE,
  ADD COLUMN "onaylayan_user_id" UUID,
  ADD COLUMN "onay_zamani" TIMESTAMP(3),
  ADD COLUMN "degisiklik_nedeni" TEXT;

DROP INDEX IF EXISTS "urun_receteleri_stok_id_key";
DROP INDEX IF EXISTS "urun_receteleri_tenant_id_stok_id_key";
CREATE UNIQUE INDEX "urun_receteleri_tenant_id_stok_id_surum_key" ON "urun_receteleri"("tenant_id", "stok_id", "surum");

ALTER TABLE "uretim_emirleri" ADD COLUMN "recete_id" UUID;
UPDATE "uretim_emirleri" AS ue SET "recete_id" = ur."id"
FROM "urun_receteleri" AS ur
WHERE ur."tenant_id" = ue."tenant_id" AND ur."stok_id" = ue."stok_id";
ALTER TABLE "uretim_emirleri" ADD CONSTRAINT "uretim_emirleri_recete_id_fkey" FOREIGN KEY ("recete_id") REFERENCES "urun_receteleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "uretim_emirleri_tenant_id_recete_id_idx" ON "uretim_emirleri"("tenant_id", "recete_id");
