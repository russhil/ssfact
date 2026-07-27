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
    "fabricOrderId" INTEGER,
    "trimOrderId" INTEGER,
    "note" TEXT,
    "lockedAt" DATETIME,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnOfChallanId" INTEGER,
    "returnReason" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "MaterialChallan_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_returnOfChallanId_fkey" FOREIGN KEY ("returnOfChallanId") REFERENCES "MaterialChallan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaterialChallan" ("challanNo", "createdAt", "createdById", "date", "direction", "fabricOrderId", "id", "jobCardId", "kind", "lockedAt", "note", "status", "supplierId", "trimOrderId", "updatedAt", "updatedById", "vendorId", "voidedAt") SELECT "challanNo", "createdAt", "createdById", "date", "direction", "fabricOrderId", "id", "jobCardId", "kind", "lockedAt", "note", "status", "supplierId", "trimOrderId", "updatedAt", "updatedById", "vendorId", "voidedAt" FROM "MaterialChallan";
DROP TABLE "MaterialChallan";
ALTER TABLE "new_MaterialChallan" RENAME TO "MaterialChallan";
CREATE UNIQUE INDEX "MaterialChallan_challanNo_key" ON "MaterialChallan"("challanNo");
CREATE INDEX "MaterialChallan_direction_idx" ON "MaterialChallan"("direction");
CREATE INDEX "MaterialChallan_vendorId_idx" ON "MaterialChallan"("vendorId");
CREATE INDEX "MaterialChallan_supplierId_idx" ON "MaterialChallan"("supplierId");
CREATE INDEX "MaterialChallan_jobCardId_idx" ON "MaterialChallan"("jobCardId");
CREATE INDEX "MaterialChallan_fabricOrderId_idx" ON "MaterialChallan"("fabricOrderId");
CREATE INDEX "MaterialChallan_trimOrderId_idx" ON "MaterialChallan"("trimOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
