-- BLD-15: artımlı stok tutarlılık denetimi son taramadan beri oluşan hareketleri
-- ve güncellenen kartları okur; firma + zaman indeksi olmadan tablo taranırdı.
CREATE INDEX "stok_hareketleri_tenant_id_created_at_idx" ON "stok_hareketleri" ("tenant_id", "created_at");
CREATE INDEX "stok_kartlari_tenant_id_updated_at_idx" ON "stok_kartlari" ("tenant_id", "updated_at");
