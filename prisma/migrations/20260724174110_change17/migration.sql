-- AlterTable
ALTER TABLE "CuttingLayer" ADD COLUMN "fabricIssued" REAL;
ALTER TABLE "CuttingLayer" ADD COLUMN "sizeRatio" TEXT;

-- AlterTable
ALTER TABLE "DispatchEvent" ADD COLUMN "dispatchNo" TEXT;

-- AlterTable
ALTER TABLE "TrimItem" ADD COLUMN "dimension" TEXT;
ALTER TABLE "TrimItem" ADD COLUMN "perPieceAvg" REAL;
ALTER TABLE "TrimItem" ADD COLUMN "reorderLevel" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MaterialChallan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "challanNo" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT,
    "jobCardId" INTEGER,
    "supplierId" INTEGER,
    "vendorId" INTEGER,
    "note" TEXT,
    "lockedAt" DATETIME,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialChallan_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaterialChallan" ("challanNo", "createdAt", "date", "direction", "id", "lockedAt", "note", "status", "supplierId", "vendorId", "voidedAt") SELECT "challanNo", "createdAt", "date", "direction", "id", "lockedAt", "note", "status", "supplierId", "vendorId", "voidedAt" FROM "MaterialChallan";
DROP TABLE "MaterialChallan";
ALTER TABLE "new_MaterialChallan" RENAME TO "MaterialChallan";
CREATE UNIQUE INDEX "MaterialChallan_challanNo_key" ON "MaterialChallan"("challanNo");
CREATE INDEX "MaterialChallan_direction_idx" ON "MaterialChallan"("direction");
CREATE INDEX "MaterialChallan_vendorId_idx" ON "MaterialChallan"("vendorId");
CREATE INDEX "MaterialChallan_supplierId_idx" ON "MaterialChallan"("supplierId");
CREATE INDEX "MaterialChallan_jobCardId_idx" ON "MaterialChallan"("jobCardId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DispatchEvent_dispatchNo_key" ON "DispatchEvent"("dispatchNo");

