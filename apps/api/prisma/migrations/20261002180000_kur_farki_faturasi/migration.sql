-- KSB-07: gerçekleşen kur farkının kur farkı faturasıyla kapatılması.
ALTER TABLE "kasa_banka_hareketleri" ADD COLUMN "kur_farki_fatura_id" UUID,
ADD COLUMN "kur_farki_kapandi" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_kur_farki_fatura_id_fkey" FOREIGN KEY ("kur_farki_fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
