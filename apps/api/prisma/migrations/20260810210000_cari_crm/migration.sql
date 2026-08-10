CREATE TYPE "CrmEtkilesimTipi" AS ENUM ('gorusme', 'telefon', 'eposta', 'ziyaret', 'not');
CREATE TYPE "CrmGorevDurumu" AS ENUM ('acik', 'tamamlandi', 'iptal');
CREATE TYPE "CrmOncelik" AS ENUM ('dusuk', 'normal', 'yuksek');

CREATE TABLE "crm_etkilesimleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "cari_id" UUID NOT NULL, "user_id" UUID NOT NULL,
  "tip" "CrmEtkilesimTipi" NOT NULL, "konu" TEXT NOT NULL, "aciklama" TEXT,
  "tarih" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_etkilesimleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_etkilesimleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crm_etkilesimleri_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "crm_etkilesimleri_tenant_id_cari_id_tarih_idx" ON "crm_etkilesimleri"("tenant_id", "cari_id", "tarih");

CREATE TABLE "crm_gorevleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "cari_id" UUID NOT NULL, "atanan_user_id" UUID NOT NULL,
  "baslik" TEXT NOT NULL, "aciklama" TEXT, "son_tarih" TIMESTAMP(3), "hatirlatma_tarihi" TIMESTAMP(3),
  "oncelik" "CrmOncelik" NOT NULL DEFAULT 'normal', "durum" "CrmGorevDurumu" NOT NULL DEFAULT 'acik',
  "tamamlanma_zamani" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_gorevleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_gorevleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crm_gorevleri_atanan_user_id_fkey" FOREIGN KEY ("atanan_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "crm_gorevleri_tenant_id_cari_id_durum_son_tarih_idx" ON "crm_gorevleri"("tenant_id", "cari_id", "durum", "son_tarih");
CREATE INDEX "crm_gorevleri_tenant_id_atanan_user_id_durum_hatirlatma_tarihi_idx" ON "crm_gorevleri"("tenant_id", "atanan_user_id", "durum", "hatirlatma_tarihi");

ALTER TABLE "crm_etkilesimleri" ENABLE ROW LEVEL SECURITY; ALTER TABLE "crm_etkilesimleri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_gorevleri" ENABLE ROW LEVEL SECURITY; ALTER TABLE "crm_gorevleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_crm_etkilesimleri ON "crm_etkilesimleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_crm_gorevleri ON "crm_gorevleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
