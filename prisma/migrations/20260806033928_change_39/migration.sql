-- AlterTable
ALTER TABLE "CuttingLayer" ADD COLUMN "layerLength" REAL;

-- AlterTable
ALTER TABLE "CuttingLayerColour" ADD COLUMN "bundles" INTEGER;

-- AlterTable
ALTER TABLE "MaterialChallan" ADD COLUMN "signatoryName" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siNo" TEXT NOT NULL,
    "orderDate" DATETIME,
    "cutQty" REAL NOT NULL DEFAULT 0,
    "dispatchedQty" REAL NOT NULL DEFAULT 0,
    "estAvg" REAL,
    "stdFabricPerPc" REAL,
    "estFabric" REAL,
    "actualAvg" REAL,
    "fabricDispatched" REAL,
    "fabricUsed" REAL,
    "avgConsumption" REAL,
    "fabricIssued" REAL,
    "fabricConsumed" REAL,
    "fabricIssueDate" DATETIME,
    "cuttingIssuedOn" DATETIME,
    "plannedEtd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stage" TEXT NOT NULL DEFAULT 'CUTTING',
    "remark" TEXT,
    "trimsPending" BOOLEAN NOT NULL DEFAULT false,
    "needsPrint" BOOLEAN NOT NULL DEFAULT false,
    "needsLaser" BOOLEAN NOT NULL DEFAULT false,
    "needsEmb" BOOLEAN NOT NULL DEFAULT false,
    "merchandiser" TEXT,
    "mrp" REAL,
    "customItem" TEXT,
    "customSku" TEXT,
    "customStyle" TEXT,
    "customMrp" REAL,
    "rejectQty" REAL,
    "alterQty" REAL,
    "extraQty" REAL,
    "productId" INTEGER,
    "vendorId" INTEGER NOT NULL,
    "cuttingMasterId" INTEGER,
    "productionOrderId" INTEGER,
    "editLockedAt" DATETIME,
    "signatoryName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("actualAvg", "alterQty", "avgConsumption", "createdAt", "createdById", "customItem", "customMrp", "customSku", "customStyle", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "extraQty", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "rejectQty", "remark", "siNo", "stage", "status", "stdFabricPerPc", "trimsPending", "updatedAt", "updatedById", "vendorId") SELECT "actualAvg", "alterQty", "avgConsumption", "createdAt", "createdById", "customItem", "customMrp", "customSku", "customStyle", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "extraQty", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "rejectQty", "remark", "siNo", "stage", "status", "stdFabricPerPc", "trimsPending", "updatedAt", "updatedById", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
CREATE TABLE "new_MaterialChallanLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "challanId" INTEGER NOT NULL,
    "fabricId" INTEGER,
    "colour" TEXT,
    "trimItemId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT,
    "rate" REAL,
    "note" TEXT,
    "cuttingLayerId" INTEGER,
    "size" TEXT,
    "lotNo" TEXT,
    "shadeRef" TEXT,
    CONSTRAINT "MaterialChallanLine_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "MaterialChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallanLine_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallanLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallanLine_cuttingLayerId_fkey" FOREIGN KEY ("cuttingLayerId") REFERENCES "CuttingLayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaterialChallanLine" ("challanId", "colour", "fabricId", "id", "lotNo", "note", "qty", "rate", "shadeRef", "trimItemId", "unit") SELECT "challanId", "colour", "fabricId", "id", "lotNo", "note", "qty", "rate", "shadeRef", "trimItemId", "unit" FROM "MaterialChallanLine";
DROP TABLE "MaterialChallanLine";
ALTER TABLE "new_MaterialChallanLine" RENAME TO "MaterialChallanLine";
CREATE INDEX "MaterialChallanLine_challanId_idx" ON "MaterialChallanLine"("challanId");
CREATE INDEX "MaterialChallanLine_fabricId_idx" ON "MaterialChallanLine"("fabricId");
CREATE INDEX "MaterialChallanLine_trimItemId_idx" ON "MaterialChallanLine"("trimItemId");
CREATE INDEX "MaterialChallanLine_cuttingLayerId_idx" ON "MaterialChallanLine"("cuttingLayerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
