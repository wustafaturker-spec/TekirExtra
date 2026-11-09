-- ILT-05: firma e-postasında çift gönderim koruması.
ALTER TABLE "eposta_gonderimleri" ADD COLUMN "anahtar" VARCHAR(128);
CREATE UNIQUE INDEX "eposta_gonderimleri_tenant_id_anahtar_key" ON "eposta_gonderimleri"("tenant_id", "anahtar");
