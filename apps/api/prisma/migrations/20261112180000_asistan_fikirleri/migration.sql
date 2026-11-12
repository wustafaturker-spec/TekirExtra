-- CNL-11 (aşama D): haftalık fikirler. Her fikir hesaplanmış rakama ve rapora dayanır; model
-- yalnız anlatır. Kullanıcının işareti hafızaya da yazılır ve sonraki haftaların seçimini etkiler.
CREATE TABLE "asistan_fikirleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hafta" VARCHAR(8) NOT NULL,
    "tur" VARCHAR(16) NOT NULL,
    "varlik_id" UUID,
    "baslik" VARCHAR(200) NOT NULL,
    "metin" TEXT NOT NULL,
    "olgular" JSONB NOT NULL,
    "rapor_kodu" VARCHAR(60),
    "hedef_yol" VARCHAR(300) NOT NULL,
    "etki_tl" DECIMAL(15,2) NOT NULL,
    "model_anlatti" BOOLEAN NOT NULL DEFAULT false,
    "isaret" VARCHAR(10),
    "isaretleyen_user_id" UUID,
    "isaret_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asistan_fikirleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asistan_fikirleri_tur_check" CHECK ("tur" IN ('marj', 'yavas_stok', 'gec_odeme', 'erken_odeme')),
    CONSTRAINT "asistan_fikirleri_isaret_check" CHECK ("isaret" IS NULL OR "isaret" IN ('yarar', 'yaramaz', 'getirme'))
);
-- CNL-11: haftada tür başına bir fikir (en çok üçü seçilir).
CREATE UNIQUE INDEX "asistan_fikirleri_tenant_id_hafta_tur_key" ON "asistan_fikirleri"("tenant_id", "hafta", "tur");
CREATE INDEX "asistan_fikirleri_tenant_id_created_at_idx" ON "asistan_fikirleri"("tenant_id", "created_at");
ALTER TABLE "asistan_fikirleri" ADD CONSTRAINT "asistan_fikirleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asistan_fikirleri" ADD CONSTRAINT "asistan_fikirleri_isaretleyen_user_id_fkey" FOREIGN KEY ("isaretleyen_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asistan_fikirleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asistan_fikirleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_asistan_fikirleri ON "asistan_fikirleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_asistan_fikirleri_isaretleyen_user_id_fkey AFTER INSERT OR UPDATE OF isaretleyen_user_id, tenant_id ON "asistan_fikirleri"
  FOR EACH ROW WHEN (NEW.isaretleyen_user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('isaretleyen_user_id', 'users', 'id');
