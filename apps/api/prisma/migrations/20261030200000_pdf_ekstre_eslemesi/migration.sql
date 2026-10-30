-- KSB-34: PDF ekstre sütun eşlemesi CSV/Excel eşlemesinden ayrı saklanır.
ALTER TABLE "banka_hesaplari" ADD COLUMN "ekstre_pdf_eslemesi" JSONB;
