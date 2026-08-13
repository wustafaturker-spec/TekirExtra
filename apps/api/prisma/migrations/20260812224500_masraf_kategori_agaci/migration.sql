ALTER TABLE "masraf_kategorileri" ADD COLUMN "ust_id" UUID;
CREATE INDEX "masraf_kategorileri_tenant_id_ust_id_idx" ON "masraf_kategorileri"("tenant_id", "ust_id");
ALTER TABLE "masraf_kategorileri" ADD CONSTRAINT "masraf_kategorileri_ust_id_fkey" FOREIGN KEY ("ust_id") REFERENCES "masraf_kategorileri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
