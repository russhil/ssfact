-- AlterTable
ALTER TABLE "DispatchEvent" ADD COLUMN "voidedAt" DATETIME;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "reason" TEXT;

-- AlterTable
ALTER TABLE "TrimMovement" ADD COLUMN "note" TEXT;
ALTER TABLE "TrimMovement" ADD COLUMN "reason" TEXT;
