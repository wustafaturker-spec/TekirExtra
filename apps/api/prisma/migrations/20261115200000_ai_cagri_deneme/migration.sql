-- AI-102: her yeniden deneme ve yedek modele geçiş ayrı iz satırıdır.
ALTER TABLE "ai_cagri_izleri" ADD COLUMN "deneme" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "ai_cagri_izleri" ADD COLUMN "deneme_nedeni" VARCHAR(40);
