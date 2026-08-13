CREATE TABLE "eposta_gonderimleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "alici" TEXT NOT NULL,
    "konu" TEXT NOT NULL,
    "tur" TEXT NOT NULL DEFAULT 'genel',
    "durum" TEXT NOT NULL,
    "ek_sayisi" INTEGER NOT NULL DEFAULT 0,
    "hata_mesaji" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eposta_gonderimleri_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eposta_gonderimleri_tenant_id_created_at_idx" ON "eposta_gonderimleri"("tenant_id", "created_at");
ALTER TABLE "eposta_gonderimleri" ADD CONSTRAINT "eposta_gonderimleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eposta_gonderimleri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_eposta_gonderimleri ON "eposta_gonderimleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
