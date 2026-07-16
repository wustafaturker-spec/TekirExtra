-- CreateEnum
CREATE TYPE "CekSenetYon" AS ENUM ('alinan', 'verilen');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CekSenetDurum" ADD VALUE 'verildi';
ALTER TYPE "CekSenetDurum" ADD VALUE 'odendi';

-- AlterTable
ALTER TABLE "cek_senetler" ADD COLUMN     "yon" "CekSenetYon" NOT NULL DEFAULT 'alinan';
