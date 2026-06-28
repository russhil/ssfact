-- AlterTable
ALTER TABLE "DispatchEvent" ADD COLUMN "arrangedBy" TEXT;

-- AlterTable
ALTER TABLE "JobFabricLine" ADD COLUMN "arrangedBy" TEXT;
ALTER TABLE "JobFabricLine" ADD COLUMN "challan" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "remarks" TEXT
);

-- CreateTable
CREATE TABLE "FabricOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fabricId" INTEGER NOT NULL,
    "color" TEXT,
    "supplierId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "rate" REAL,
    "gsm" REAL,
    "colorCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "shadeCardDone" BOOLEAN NOT NULL DEFAULT false,
    "orderDate" DATETIME,
    "expectedDate" DATETIME,
    "receivedDate" DATETIME,
    "remarks" TEXT,
    CONSTRAINT "FabricOrder_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BomLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sNo" INTEGER,
    "material" TEXT NOT NULL,
    "color" TEXT,
    "qty" REAL,
    "perPieceQty" REAL,
    "dimension" TEXT NOT NULL DEFAULT 'FLAT',
    "avg" TEXT,
    "bomId" INTEGER NOT NULL,
    "trimItemId" INTEGER,
    CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BomLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BomLine" ("avg", "bomId", "color", "id", "material", "qty", "sNo", "trimItemId") SELECT "avg", "bomId", "color", "id", "material", "qty", "sNo", "trimItemId" FROM "BomLine";
DROP TABLE "BomLine";
ALTER TABLE "new_BomLine" RENAME TO "BomLine";
CREATE INDEX "BomLine_bomId_idx" ON "BomLine"("bomId");
CREATE INDEX "BomLine_trimItemId_idx" ON "BomLine"("trimItemId");
CREATE TABLE "new_JobBomLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "material" TEXT NOT NULL,
    "color" TEXT,
    "dimension" TEXT NOT NULL DEFAULT 'FLAT',
    "perPieceQty" REAL,
    "totalQty" REAL,
    "requiredQty" REAL,
    "issuedQty" REAL DEFAULT 0,
    "arrangedBy" TEXT,
    "issueDate" DATETIME,
    "challan" TEXT,
    "trimItemId" INTEGER,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "JobBomLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobBomLine_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JobBomLine" ("color", "id", "jobCardId", "material", "perPieceQty", "totalQty", "trimItemId") SELECT "color", "id", "jobCardId", "material", "perPieceQty", "totalQty", "trimItemId" FROM "JobBomLine";
DROP TABLE "JobBomLine";
ALTER TABLE "new_JobBomLine" RENAME TO "JobBomLine";
CREATE INDEX "JobBomLine_jobCardId_idx" ON "JobBomLine"("jobCardId");
CREATE INDEX "JobBomLine_trimItemId_idx" ON "JobBomLine"("trimItemId");
CREATE TABLE "new_JobCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siNo" TEXT NOT NULL,
    "orderDate" DATETIME,
    "cutQty" REAL NOT NULL DEFAULT 0,
    "dispatchedQty" REAL NOT NULL DEFAULT 0,
    "estAvg" REAL,
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
    "productId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "cuttingMasterId" INTEGER,
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("actualAvg", "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "orderDate", "plannedEtd", "productId", "remark", "siNo", "stage", "status", "vendorId") SELECT "actualAvg", "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "orderDate", "plannedEtd", "productId", "remark", "siNo", "stage", "status", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
CREATE TABLE "new_TrimItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sno" TEXT,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "family" TEXT,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "category" TEXT,
    "supplierId" INTEGER,
    "ratePerUnit" REAL,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "imageUrl" TEXT,
    "size" TEXT,
    "material" TEXT,
    "weight" TEXT,
    "shape" TEXT,
    "color" TEXT,
    "estMonthlyReq" REAL,
    CONSTRAINT "TrimItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrimItem" ("currentStock", "family", "id", "name", "normName", "openingStock", "sno") SELECT "currentStock", "family", "id", "name", "normName", "openingStock", "sno" FROM "TrimItem";
DROP TABLE "TrimItem";
ALTER TABLE "new_TrimItem" RENAME TO "TrimItem";
CREATE UNIQUE INDEX "TrimItem_name_key" ON "TrimItem"("name");
CREATE INDEX "TrimItem_normName_idx" ON "TrimItem"("normName");
CREATE INDEX "TrimItem_family_idx" ON "TrimItem"("family");
CREATE INDEX "TrimItem_category_idx" ON "TrimItem"("category");
CREATE INDEX "TrimItem_supplierId_idx" ON "TrimItem"("supplierId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Supplier_type_idx" ON "Supplier"("type");

-- CreateIndex
CREATE INDEX "FabricOrder_fabricId_idx" ON "FabricOrder"("fabricId");

-- CreateIndex
CREATE INDEX "FabricOrder_supplierId_idx" ON "FabricOrder"("supplierId");

-- CreateIndex
CREATE INDEX "FabricOrder_status_idx" ON "FabricOrder"("status");
