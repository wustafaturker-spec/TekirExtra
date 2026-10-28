-- KLN-21: 2FA'nın zorunlu olduğu roller (varsayılan boş = kapalı).
-- KLN-22: oturumun girişten itibaren açık kalma süresi ve hareketsizlik süresi.
ALTER TABLE "tenants"
  ADD COLUMN "iki_adim_zorunlu_roller" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "oturum_suresi_gun" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "hareketsizlik_dk" INTEGER;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_oturum_suresi_gun_check" CHECK ("oturum_suresi_gun" BETWEEN 1 AND 30),
  ADD CONSTRAINT "tenants_hareketsizlik_dk_check" CHECK ("hareketsizlik_dk" IS NULL OR "hareketsizlik_dk" IN (15, 30, 60, 240));
