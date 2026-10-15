ALTER TABLE "ajan_mesaj_gecmisi" ADD COLUMN "request_id" UUID;
ALTER TABLE "ajan_mesaj_gecmisi" ADD COLUMN "yanit" JSONB;
CREATE UNIQUE INDEX "ajan_mesaj_gecmisi_oturum_id_request_id_key"
  ON "ajan_mesaj_gecmisi"("oturum_id", "request_id");
