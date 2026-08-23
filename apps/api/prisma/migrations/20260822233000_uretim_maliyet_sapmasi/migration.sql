ALTER TABLE "uretim_emirleri" ADD COLUMN "planlanan_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0;
ALTER TABLE "uretim_emri_kalemleri" ADD COLUMN "planlanan_birim_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0;
ALTER TABLE "uretim_emri_operasyonlari" ADD COLUMN "saatlik_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0;

UPDATE "uretim_emri_kalemleri" AS k SET "planlanan_birim_maliyet" = s."ortalama_maliyet"
FROM "stok_kartlari" AS s WHERE s."id" = k."malzeme_stok_id";
UPDATE "uretim_emri_operasyonlari" AS o SET "saatlik_maliyet" = m."saatlik_maliyet"
FROM "is_merkezleri" AS m WHERE m."id" = o."is_merkezi_id";
UPDATE "uretim_emirleri" AS e SET "planlanan_maliyet" = COALESCE((
  SELECT SUM(k."planlanan_miktar" * k."planlanan_birim_maliyet") FROM "uretim_emri_kalemleri" k WHERE k."uretim_emri_id" = e."id"
), 0) + COALESCE((
  SELECT SUM(o."planlanan_dakika" * o."saatlik_maliyet" / 60) FROM "uretim_emri_operasyonlari" o WHERE o."uretim_emri_id" = e."id"
), 0);
