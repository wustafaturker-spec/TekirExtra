-- İade faturasının iade edilen faturalara referansı (EBLG-58).
--
-- GİB şematronu IADE tipinde iade edilen her fatura için 16 haneli numara ve
-- tarih ister. Fatura sistemdeyse kaynak_fatura_id onu gösterir; sistemde
-- olmayan faturanın numarası elle girilir.

CREATE TABLE "fatura_iade_referanslari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fatura_id" UUID NOT NULL,
    "kaynak_fatura_id" UUID,
    "sira" INTEGER NOT NULL,
    "belge_no" TEXT NOT NULL,
    "tarih" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fatura_iade_referanslari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fatura_iade_referanslari_fatura_id_belge_no_key" ON "fatura_iade_referanslari"("fatura_id", "belge_no");
CREATE INDEX "fatura_iade_referanslari_tenant_id_kaynak_fatura_id_idx" ON "fatura_iade_referanslari"("tenant_id", "kaynak_fatura_id");

ALTER TABLE "fatura_iade_referanslari" ADD CONSTRAINT "fatura_iade_referanslari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fatura_iade_referanslari" ADD CONSTRAINT "fatura_iade_referanslari_kaynak_fatura_id_fkey" FOREIGN KEY ("kaynak_fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kiracı yalıtımı.
ALTER TABLE "fatura_iade_referanslari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fatura_iade_referanslari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_fatura_iade_referanslari" ON "fatura_iade_referanslari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
