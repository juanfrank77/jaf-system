-- CreateEnum
CREATE TYPE "PhotoTag" AS ENUM ('BEFORE', 'AFTER');

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN "tag" "PhotoTag";
