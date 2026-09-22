ALTER TABLE "tenants" ADD COLUMN "eirsaliye_mukellefi" BOOLEAN;
ALTER TABLE "faturalar" ADD COLUMN "irsaliye_sonra" BOOLEAN NOT NULL DEFAULT false;
