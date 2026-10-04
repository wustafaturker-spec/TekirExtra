-- PRS-06: yürürlük tarihli ücret geçmişi; net anlaşılan ücret mevzuatla brüte çevrilir.

CREATE TABLE "personel_ucretleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "personel_id" UUID NOT NULL,
    "yururluk_tarihi" DATE NOT NULL,
    "tip" TEXT NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "neden" TEXT,
    "olusturan_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "personel_ucretleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "personel_ucretleri_tip_check" CHECK ("tip" IN ('net', 'brut')),
    CONSTRAINT "personel_ucretleri_tutar_check" CHECK ("tutar" > 0),
    CONSTRAINT "personel_ucretleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "personel_ucretleri_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_ucretleri_tenant_id_personel_id_yururluk_tarihi_key" ON "personel_ucretleri"("tenant_id", "personel_id", "yururluk_tarihi");
ALTER TABLE "personel_ucretleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_ucretleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "personel_ucretleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Mevcut personel: işe giriş tarihli ilk kayıt (brüt girilmişse brüt, yoksa net).
INSERT INTO "personel_ucretleri" ("id", "tenant_id", "personel_id", "yururluk_tarihi", "tip", "tutar", "neden")
SELECT gen_random_uuid(), "tenant_id", "id", "giris_tarihi",
       CASE WHEN "brut_maas" IS NOT NULL THEN 'brut' ELSE 'net' END,
       COALESCE("brut_maas", "net_maas"), 'Başlangıç kaydı (PRS-06 göçü)'
FROM "personel";
