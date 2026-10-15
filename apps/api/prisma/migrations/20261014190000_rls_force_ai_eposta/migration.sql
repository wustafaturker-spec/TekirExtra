-- RLS sahibi olan uygulama rolüne de uygulansın; yalnız ENABLE, tablo sahibini korumaz.
ALTER TABLE "ai_arac_istekleri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_cagri_izleri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_ocr_denetimleri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gelen_eposta_ekleri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gelen_epostalar" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_ai_gorev_calismalari" FORCE ROW LEVEL SECURITY;
