-- AlterTable
ALTER TABLE "CuttingLayer" ADD COLUMN "fabricLotNo" TEXT;

-- AlterTable
ALTER TABLE "MaterialChallanLine" ADD COLUMN "lotNo" TEXT;
ALTER TABLE "MaterialChallanLine" ADD COLUMN "shadeRef" TEXT;

-- CreateTable
CREATE TABLE "Sample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "productId" INTEGER,
    "vendorId" INTEGER,
    "requestedById" INTEGER,
    "notes" TEXT,
    "decidedAt" DATETIME,
    "remark" TEXT,
    "targetMrp" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sample_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Sample_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Sample_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleCostLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sampleId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "qty" REAL NOT NULL DEFAULT 1,
    "rate" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "SampleCostLine_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleMeasurement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sampleId" INTEGER NOT NULL,
    "pom" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "valueCm" REAL NOT NULL,
    "tolerance" REAL,
    CONSTRAINT "SampleMeasurement_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImageAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "caption" TEXT,
    "kind" TEXT,
    "sortOrder" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trimItemId" INTEGER,
    "fabricId" INTEGER,
    "fabricOrderId" INTEGER,
    "productId" INTEGER,
    "trimOrderId" INTEGER,
    "materialChallanId" INTEGER,
    "sampleId" INTEGER,
    CONSTRAINT "ImageAsset_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_materialChallanId_fkey" FOREIGN KEY ("materialChallanId") REFERENCES "MaterialChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImageAsset" ("caption", "createdAt", "fabricId", "fabricOrderId", "id", "kind", "materialChallanId", "productId", "sortOrder", "thumbUrl", "trimItemId", "trimOrderId", "url") SELECT "caption", "createdAt", "fabricId", "fabricOrderId", "id", "kind", "materialChallanId", "productId", "sortOrder", "thumbUrl", "trimItemId", "trimOrderId", "url" FROM "ImageAsset";
DROP TABLE "ImageAsset";
ALTER TABLE "new_ImageAsset" RENAME TO "ImageAsset";
CREATE INDEX "ImageAsset_trimItemId_idx" ON "ImageAsset"("trimItemId");
CREATE INDEX "ImageAsset_fabricId_idx" ON "ImageAsset"("fabricId");
CREATE INDEX "ImageAsset_fabricOrderId_idx" ON "ImageAsset"("fabricOrderId");
CREATE INDEX "ImageAsset_productId_idx" ON "ImageAsset"("productId");
CREATE INDEX "ImageAsset_trimOrderId_idx" ON "ImageAsset"("trimOrderId");
CREATE INDEX "ImageAsset_materialChallanId_idx" ON "ImageAsset"("materialChallanId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Sample_code_key" ON "Sample"("code");

-- CreateIndex
CREATE INDEX "Sample_productId_idx" ON "Sample"("productId");

-- CreateIndex
CREATE INDEX "Sample_status_idx" ON "Sample"("status");

-- CreateIndex
CREATE INDEX "SampleCostLine_sampleId_idx" ON "SampleCostLine"("sampleId");

-- CreateIndex
CREATE INDEX "SampleMeasurement_sampleId_idx" ON "SampleMeasurement"("sampleId");
