-- KSB-13: Kasa & Banka hareket listesi sunucuda süzülür ve sayfalanır.
--
-- Arama açıklama ve makbuz numarasında aksansız yapılır (ARA-01 ile aynı
-- kural); cari unvanı ve fatura numarası kendi tablolarının arama_normal
-- kolonlarından aranır.
ALTER TABLE "kasa_banka_hareketleri" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (
    tekir_arama_normal("aciklama") || ' ' || tekir_arama_normal("makbuz_no")
  ) STORED;

CREATE INDEX "kasa_banka_hareketleri_arama_normal_trgm_idx"
  ON "kasa_banka_hareketleri" USING GIN ("arama_normal" gin_trgm_ops);

-- Liste hesap süzgeciyle tarih sırasında okunur.
CREATE INDEX "kasa_banka_hareketleri_tenant_id_kasa_id_tarih_idx"
  ON "kasa_banka_hareketleri" ("tenant_id", "kasa_id", "tarih");
CREATE INDEX "kasa_banka_hareketleri_tenant_id_banka_hesap_id_tarih_idx"
  ON "kasa_banka_hareketleri" ("tenant_id", "banka_hesap_id", "tarih");
-- Geri alınmış fişler ters kaydın kaynak_ref'inden bulunur.
CREATE INDEX "kasa_banka_hareketleri_tenant_id_kaynak_tur_kaynak_ref_idx"
  ON "kasa_banka_hareketleri" ("tenant_id", "kaynak_tur", "kaynak_ref");
