-- SAT-12: gelen e-İrsaliyeden oluşturulan alış irsaliyesi kaynağını taşır.
ALTER TABLE "belgeler" ADD COLUMN "gelen_eirsaliye_id" UUID;
CREATE UNIQUE INDEX "belgeler_gelen_eirsaliye_id_key" ON "belgeler"("gelen_eirsaliye_id");
ALTER TABLE "belgeler" ADD CONSTRAINT "belgeler_gelen_eirsaliye_id_fkey" FOREIGN KEY ("gelen_eirsaliye_id") REFERENCES "gelen_eirsaliyeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
