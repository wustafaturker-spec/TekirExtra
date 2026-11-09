-- ILT-02/06: firma gönderim kaydında iletinin hangi hesaptan çıktığı, deneme sayısı ve sağlayıcı numarası.
ALTER TABLE "eposta_gonderimleri" ADD COLUMN "gonderen" VARCHAR(10) NOT NULL DEFAULT 'firma';
ALTER TABLE "eposta_gonderimleri" ADD COLUMN "deneme" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "eposta_gonderimleri" ADD COLUMN "saglayici_no" TEXT;
ALTER TABLE "eposta_gonderimleri" ADD CONSTRAINT "eposta_gonderimleri_gonderen_check" CHECK ("gonderen" IN ('firma', 'platform'));
CREATE INDEX "eposta_gonderimleri_tenant_id_gonderen_created_at_idx" ON "eposta_gonderimleri"("tenant_id", "gonderen", "created_at");
