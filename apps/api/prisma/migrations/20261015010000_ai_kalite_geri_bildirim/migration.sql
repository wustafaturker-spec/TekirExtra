ALTER TABLE "ajan_mesaj_gecmisi"
  ADD COLUMN "saglayici" VARCHAR(40),
  ADD COLUMN "model" VARCHAR(120),
  ADD COLUMN "geri_bildirim" VARCHAR(12),
  ADD COLUMN "geri_bildirim_notu" VARCHAR(500),
  ADD COLUMN "geri_bildirim_at" TIMESTAMP(3);
ALTER TABLE "ajan_mesaj_gecmisi" ADD CONSTRAINT "ajan_mesaj_geri_bildirim_check"
  CHECK ("geri_bildirim" IS NULL OR ("rol" = 'assistant' AND "geri_bildirim" IN ('dogru', 'yanlis', 'eksik')));
CREATE INDEX "ajan_mesaj_geri_bildirim_at_idx" ON "ajan_mesaj_gecmisi"("geri_bildirim_at") WHERE "geri_bildirim" IS NOT NULL;
