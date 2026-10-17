-- Eski satırlara tahmini eşleştirme yapılmaz. Mevcut RLS/FORCE RLS korunur.
ALTER TABLE fatura_satirlari ADD COLUMN kaynak_belge_satir_id UUID;
CREATE UNIQUE INDEX belge_satirlari_f03_kapsam ON belge_satirlari(id,tenant_id,stok_id);
ALTER TABLE fatura_satirlari ADD CONSTRAINT fatura_satirlari_f03_kaynak_fk
 FOREIGN KEY(kaynak_belge_satir_id,tenant_id,stok_id)
 REFERENCES belge_satirlari(id,tenant_id,stok_id)
 ON UPDATE RESTRICT ON DELETE SET NULL(kaynak_belge_satir_id);
CREATE INDEX fatura_satirlari_f03_kaynak_idx ON fatura_satirlari(tenant_id,kaynak_belge_satir_id);
