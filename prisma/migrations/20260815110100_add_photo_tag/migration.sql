-- CreateEnum
CREATE TYPE "PhotoTag" AS ENUM ('BEFORE', 'AFTER');

-- AlterTable
ALTER TABLE "photo" ADD COLUMN "tag" "PhotoTag";
