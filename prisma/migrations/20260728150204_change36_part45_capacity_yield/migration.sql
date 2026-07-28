-- AlterTable
ALTER TABLE "JobCard" ADD COLUMN "stdFabricPerPc" REAL;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "capacityNote" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "dailyCapacityPcs" REAL;
