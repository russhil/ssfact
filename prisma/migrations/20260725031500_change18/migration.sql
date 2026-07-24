-- CreateTable
CREATE TABLE "TrimOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trimItemId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT,
    "rate" REAL,
    "status" TEXT NOT NULL DEFAULT 'ORDER_PLACED',
    "orderDate" DATETIME,
    "expectedDate" DATETIME,
    "receivedDate" DATETIME,
    "remarks" TEXT,
    "poNumber" TEXT,
    "poGeneratedAt" DATETIME,
    "sentAt" DATETIME,
    CONSTRAINT "TrimOrder_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrimOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trimOrderId" INTEGER NOT NULL,
    "colour" TEXT,
    "size" TEXT,
    "qty" REAL NOT NULL,
    CONSTRAINT "TrimOrderLine_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FabricSupplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "rate" REAL,
    "supplierId" INTEGER,
    "poNumber" TEXT,
    "sourcedAt" DATETIME,
    "fabricId" INTEGER NOT NULL,
    CONSTRAINT "FabricSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricSupplier_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FabricSupplier" ("fabricId", "id", "name", "rate") SELECT "fabricId", "id", "name", "rate" FROM "FabricSupplier";
DROP TABLE "FabricSupplier";
ALTER TABLE "new_FabricSupplier" RENAME TO "FabricSupplier";
CREATE INDEX "FabricSupplier_fabricId_idx" ON "FabricSupplier"("fabricId");
CREATE INDEX "FabricSupplier_supplierId_idx" ON "FabricSupplier"("supplierId");
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
    CONSTRAINT "MaterialChallan_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaterialChallan" ("challanNo", "createdAt", "date", "direction", "id", "jobCardId", "kind", "lockedAt", "note", "status", "supplierId", "vendorId", "voidedAt") SELECT "challanNo", "createdAt", "date", "direction", "id", "jobCardId", "kind", "lockedAt", "note", "status", "supplierId", "vendorId", "voidedAt" FROM "MaterialChallan";
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

-- CreateIndex
CREATE UNIQUE INDEX "TrimOrder_poNumber_key" ON "TrimOrder"("poNumber");

-- CreateIndex
CREATE INDEX "TrimOrder_trimItemId_idx" ON "TrimOrder"("trimItemId");

-- CreateIndex
CREATE INDEX "TrimOrder_supplierId_idx" ON "TrimOrder"("supplierId");

-- CreateIndex
CREATE INDEX "TrimOrder_status_idx" ON "TrimOrder"("status");

-- CreateIndex
CREATE INDEX "TrimOrderLine_trimOrderId_idx" ON "TrimOrderLine"("trimOrderId");

-- Change 19 Part C: vendor roll-ups now read CuttingLayer.vendorId. Both writers have
-- guaranteed a value since Change 14, so only pre-Change-14 rows can be null — backfill
-- them from their job card's header vendor so no layer falls out of a roll-up.
UPDATE "CuttingLayer"
SET "vendorId" = (SELECT "vendorId" FROM "JobCard" WHERE "JobCard"."id" = "CuttingLayer"."jobCardId")
WHERE "vendorId" IS NULL;

