-- CreateTable
CREATE TABLE "MaterialChallan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "challanNo" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" INTEGER,
    "vendorId" INTEGER,
    "note" TEXT,
    "lockedAt" DATETIME,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialChallan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialChallanLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "challanId" INTEGER NOT NULL,
    "fabricId" INTEGER,
    "colour" TEXT,
    "trimItemId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT,
    "rate" REAL,
    "note" TEXT,
    CONSTRAINT "MaterialChallanLine_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "MaterialChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallanLine_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallanLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialChallan_challanNo_key" ON "MaterialChallan"("challanNo");

-- CreateIndex
CREATE INDEX "MaterialChallan_direction_idx" ON "MaterialChallan"("direction");

-- CreateIndex
CREATE INDEX "MaterialChallan_vendorId_idx" ON "MaterialChallan"("vendorId");

-- CreateIndex
CREATE INDEX "MaterialChallan_supplierId_idx" ON "MaterialChallan"("supplierId");

-- CreateIndex
CREATE INDEX "MaterialChallanLine_challanId_idx" ON "MaterialChallanLine"("challanId");

-- CreateIndex
CREATE INDEX "MaterialChallanLine_fabricId_idx" ON "MaterialChallanLine"("fabricId");

-- CreateIndex
CREATE INDEX "MaterialChallanLine_trimItemId_idx" ON "MaterialChallanLine"("trimItemId");
