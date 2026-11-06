ALTER TABLE "tenants" ADD COLUMN "vergi_dairesi_kodu" VARCHAR(10);

UPDATE "tenants" t
SET "vergi_dairesi_kodu" = d."kod"
FROM "vergi_daireleri" d
WHERE d."il" = t."il" AND d."ilce" = t."ilce" AND d."ad" = t."vergi_dairesi";
