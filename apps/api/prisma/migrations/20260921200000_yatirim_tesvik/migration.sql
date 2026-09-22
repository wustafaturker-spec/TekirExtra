-- EBLG-78: yatırım teşvik belgeli (YTB) faturalar.
ALTER TABLE "faturalar" ADD COLUMN "ytb_no" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "ytb_tarihi" DATE;

ALTER TABLE "fatura_satirlari" ADD COLUMN "ytb_harcama_tipi" TEXT;
ALTER TABLE "fatura_satirlari" ADD COLUMN "ytb_makine_adi" TEXT;
ALTER TABLE "fatura_satirlari" ADD COLUMN "ytb_makine_id" TEXT;
ALTER TABLE "fatura_satirlari" ADD COLUMN "ytb_makine_sira_no" TEXT;
