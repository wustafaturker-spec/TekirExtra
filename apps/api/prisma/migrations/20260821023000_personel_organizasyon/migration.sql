CREATE TABLE "personel_isyerleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "kod" TEXT NOT NULL, "ad" TEXT NOT NULL, "adres" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personel_isyerleri_pkey" PRIMARY KEY ("id"), CONSTRAINT "personel_isyerleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_isyerleri_tenant_id_kod_key" ON "personel_isyerleri"("tenant_id", "kod");
CREATE TABLE "personel_departmanlari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "isyeri_id" UUID NOT NULL, "ust_departman_id" UUID, "kod" TEXT NOT NULL, "ad" TEXT NOT NULL,
  "aktif" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personel_departmanlari_pkey" PRIMARY KEY ("id"), CONSTRAINT "personel_departmanlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_departmanlari_isyeri_id_fkey" FOREIGN KEY ("isyeri_id") REFERENCES "personel_isyerleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_departmanlari_ust_departman_id_fkey" FOREIGN KEY ("ust_departman_id") REFERENCES "personel_departmanlari"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_departmanlari_tenant_id_kod_key" ON "personel_departmanlari"("tenant_id", "kod");
CREATE INDEX "personel_departmanlari_tenant_id_isyeri_id_aktif_idx" ON "personel_departmanlari"("tenant_id", "isyeri_id", "aktif");
CREATE TABLE "personel_pozisyonlari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "departman_id" UUID, "kod" TEXT NOT NULL, "ad" TEXT NOT NULL,
  "aktif" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personel_pozisyonlari_pkey" PRIMARY KEY ("id"), CONSTRAINT "personel_pozisyonlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_pozisyonlari_departman_id_fkey" FOREIGN KEY ("departman_id") REFERENCES "personel_departmanlari"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_pozisyonlari_tenant_id_kod_key" ON "personel_pozisyonlari"("tenant_id", "kod");
CREATE INDEX "personel_pozisyonlari_tenant_id_departman_id_aktif_idx" ON "personel_pozisyonlari"("tenant_id", "departman_id", "aktif");
ALTER TABLE "personel" ADD COLUMN "isyeri_id" UUID, ADD COLUMN "departman_id" UUID, ADD COLUMN "pozisyon_id" UUID, ADD COLUMN "yonetici_id" UUID;
ALTER TABLE "personel" ADD CONSTRAINT "personel_isyeri_id_fkey" FOREIGN KEY ("isyeri_id") REFERENCES "personel_isyerleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "personel" ADD CONSTRAINT "personel_departman_id_fkey" FOREIGN KEY ("departman_id") REFERENCES "personel_departmanlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "personel" ADD CONSTRAINT "personel_pozisyon_id_fkey" FOREIGN KEY ("pozisyon_id") REFERENCES "personel_pozisyonlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "personel" ADD CONSTRAINT "personel_yonetici_id_fkey" FOREIGN KEY ("yonetici_id") REFERENCES "personel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
INSERT INTO "personel_isyerleri" ("id", "tenant_id", "kod", "ad", "updated_at") SELECT gen_random_uuid(), "id", 'merkez', 'Merkez İşyeri', CURRENT_TIMESTAMP FROM "tenants";
INSERT INTO "personel_departmanlari" ("id", "tenant_id", "isyeri_id", "kod", "ad", "updated_at")
SELECT gen_random_uuid(), p."tenant_id", i."id", 'dep_' || substr(md5(lower(p."departman")),1,10), p."departman", CURRENT_TIMESTAMP FROM "personel" p JOIN "personel_isyerleri" i ON i."tenant_id"=p."tenant_id" AND i."kod"='merkez' WHERE p."departman" IS NOT NULL GROUP BY p."tenant_id", i."id", p."departman";
INSERT INTO "personel_pozisyonlari" ("id", "tenant_id", "departman_id", "kod", "ad", "updated_at")
SELECT gen_random_uuid(), p."tenant_id", d."id", 'poz_' || substr(md5(lower(p."unvan") || coalesce(d."id"::text,'')),1,10), p."unvan", CURRENT_TIMESTAMP FROM "personel" p LEFT JOIN "personel_departmanlari" d ON d."tenant_id"=p."tenant_id" AND d."ad"=p."departman" WHERE p."unvan" IS NOT NULL GROUP BY p."tenant_id", d."id", p."unvan";
UPDATE "personel" p SET
  "isyeri_id"=(SELECT i."id" FROM "personel_isyerleri" i WHERE i."tenant_id"=p."tenant_id" AND i."kod"='merkez'),
  "departman_id"=(SELECT d."id" FROM "personel_departmanlari" d WHERE d."tenant_id"=p."tenant_id" AND d."ad"=p."departman" LIMIT 1),
  "pozisyon_id"=(SELECT z."id" FROM "personel_pozisyonlari" z WHERE z."tenant_id"=p."tenant_id" AND z."ad"=p."unvan" AND (z."departman_id"=(SELECT d2."id" FROM "personel_departmanlari" d2 WHERE d2."tenant_id"=p."tenant_id" AND d2."ad"=p."departman" LIMIT 1) OR z."departman_id" IS NULL) LIMIT 1);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['personel_isyerleri','personel_departmanlari','personel_pozisyonlari'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t); EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true)::uuid)', t); END LOOP; END $$;
