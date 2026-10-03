-- KRD-01…08: banka kredileri (taksitli, spot, rotatif).

CREATE TABLE "banka_kredileri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "banka_hesap_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "tur" TEXT NOT NULL,
    "plan_turu" TEXT,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "anapara" DECIMAL(15,2) NOT NULL,
    "aylik_faiz" DECIMAL(9,4) NOT NULL,
    "bsmv_orani" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "kkdf_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "kullanim_tarihi" DATE NOT NULL,
    "taksit_sayisi" INTEGER,
    "ilk_taksit_tarihi" DATE,
    "vade_tarihi" DATE,
    "tahsis_ucreti" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "muhasebe_kodu" TEXT,
    "durum" TEXT NOT NULL DEFAULT 'aktif',
    "aciklama" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "banka_kredileri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "banka_kredileri_tur_check" CHECK ("tur" IN ('taksitli', 'spot', 'rotatif'))
);
CREATE INDEX "banka_kredileri_tenant_id_durum_idx" ON "banka_kredileri"("tenant_id", "durum");
ALTER TABLE "banka_kredileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banka_kredileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "banka_kredileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "banka_kredi_islemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kredi_id" UUID NOT NULL,
    "tip" TEXT NOT NULL,
    "tarih" DATE NOT NULL,
    "anapara" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "faiz" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bsmv" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "kkdf" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "masraf" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "uzun_vadeli_anapara" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "hareket_id" UUID NOT NULL,
    "masraf_id" UUID,
    "aciklama" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "banka_kredi_islemleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "banka_kredi_islemleri_tip_check" CHECK ("tip" IN ('kullanim', 'taksit', 'geri_odeme', 'faiz')),
    CONSTRAINT "banka_kredi_islemleri_kredi_id_fkey" FOREIGN KEY ("kredi_id") REFERENCES "banka_kredileri"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "banka_kredi_islemleri_hareket_id_key" ON "banka_kredi_islemleri"("hareket_id");
CREATE UNIQUE INDEX "banka_kredi_islemleri_masraf_id_key" ON "banka_kredi_islemleri"("masraf_id");
CREATE INDEX "banka_kredi_islemleri_kredi_id_idx" ON "banka_kredi_islemleri"("kredi_id");
ALTER TABLE "banka_kredi_islemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banka_kredi_islemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "banka_kredi_islemleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "banka_kredi_taksitleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kredi_id" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "vade_tarihi" DATE NOT NULL,
    "anapara" DECIMAL(15,2) NOT NULL,
    "faiz" DECIMAL(15,2) NOT NULL,
    "bsmv" DECIMAL(15,2) NOT NULL,
    "kkdf" DECIMAL(15,2) NOT NULL,
    "islem_id" UUID,
    CONSTRAINT "banka_kredi_taksitleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "banka_kredi_taksitleri_kredi_id_fkey" FOREIGN KEY ("kredi_id") REFERENCES "banka_kredileri"("id") ON DELETE CASCADE,
    CONSTRAINT "banka_kredi_taksitleri_islem_id_fkey" FOREIGN KEY ("islem_id") REFERENCES "banka_kredi_islemleri"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "banka_kredi_taksitleri_kredi_id_sira_key" ON "banka_kredi_taksitleri"("kredi_id", "sira");
CREATE UNIQUE INDEX "banka_kredi_taksitleri_islem_id_key" ON "banka_kredi_taksitleri"("islem_id");
CREATE INDEX "banka_kredi_taksitleri_tenant_id_vade_tarihi_idx" ON "banka_kredi_taksitleri"("tenant_id", "vade_tarihi");
ALTER TABLE "banka_kredi_taksitleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banka_kredi_taksitleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "banka_kredi_taksitleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- KRD-04: banka ekstresinden kredi ödemesi/kullanımı eşleştirme türü.
ALTER TYPE "EkstreEslesmeTuru" ADD VALUE IF NOT EXISTS 'kredi';

-- Kredi hareketleri bankanın iç borçlandırmasıdır; tahsilat/tediye makbuzu almaz.
CREATE OR REPLACE FUNCTION makbuz_no_ver() RETURNS trigger AS $$
DECLARE
  fis_yili integer;
  seri_onek text;
  sira integer;
BEGIN
  IF NEW.makbuz_no IS NOT NULL
     OR NEW.tip::text NOT IN ('tahsilat', 'tediye')
     OR NEW.kaynak_tur IN ('ters_kayit', 'cek_senet', 'kredi_karti_ekstre', 'pos_mutabakat', 'personel_maas_iptal', 'acilis', 'banka_kredisi') THEN
    RETURN NEW;
  END IF;
  fis_yili := extract(year FROM NEW.tarih)::integer;
  -- Yeni yılın serisi, önceki yılın önekini sürdürür.
  SELECT onek INTO seri_onek FROM makbuz_serileri
   WHERE tenant_id = NEW.tenant_id AND tur = NEW.tip::text
   ORDER BY yil DESC LIMIT 1;
  -- ON CONFLICT satırı kilitler: eşzamanlı iki fiş aynı numarayı alamaz.
  INSERT INTO makbuz_serileri (tenant_id, tur, yil, onek, son_sira)
  VALUES (NEW.tenant_id, NEW.tip::text, fis_yili, COALESCE(seri_onek, CASE WHEN NEW.tip::text = 'tahsilat' THEN 'TM' ELSE 'TD' END), 1)
  ON CONFLICT (tenant_id, tur, yil) DO UPDATE SET son_sira = makbuz_serileri.son_sira + 1
  RETURNING onek, son_sira INTO seri_onek, sira;
  NEW.makbuz_no := seri_onek || fis_yili || '-' || lpad(sira::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
