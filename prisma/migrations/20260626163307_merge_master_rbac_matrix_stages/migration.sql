/*
  Warnings:

  - You are about to drop the column `styleId` on the `JobCard` table. All the data in the column will be lost.
  - You are about to drop the column `linkedStyleId` on the `Product` table. All the data in the column will be lost.
  - Added the required column `productId` to the `JobCard` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DispatchEvent" ADD COLUMN "challan" TEXT;
ALTER TABLE "DispatchEvent" ADD COLUMN "note" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "JobBomLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "material" TEXT NOT NULL,
    "color" TEXT,
    "perPieceQty" REAL,
    "totalQty" REAL,
    "trimItemId" INTEGER,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "JobBomLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobBomLine_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReturnNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "qty" REAL NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "fabricId" INTEGER NOT NULL,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "ReturnNote_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReturnNote_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "vendorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProductColor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "sortOrder" INTEGER,
    "productId" INTEGER NOT NULL,
    CONSTRAINT "ProductColor_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "productId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "cuttingMasterId" INTEGER,
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "fabricConsumed", "fabricIssueDate", "fabricIssued", "id", "orderDate", "plannedEtd", "remark", "siNo", "status", "vendorId") SELECT "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "fabricConsumed", "fabricIssueDate", "fabricIssued", "id", "orderDate", "plannedEtd", "remark", "siNo", "status", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "extId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "normSku" TEXT NOT NULL,
    "styleNo" TEXT,
    "name" TEXT NOT NULL,
    "itemDesc" TEXT,
    "headCategory" TEXT,
    "mrp" REAL,
    "customWsRate" REAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "styleGroup" TEXT,
    "bomCode" TEXT,
    "avgConsumption" REAL,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "fabricId" INTEGER,
    "imageUrl" TEXT,
    "sizeRatioJson" TEXT,
    "colorRatioJson" TEXT,
    CONSTRAINT "Product_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("bomCode", "customWsRate", "extId", "headCategory", "id", "mrp", "name", "normSku", "skuCode", "status", "styleGroup", "styleNo") SELECT "bomCode", "customWsRate", "extId", "headCategory", "id", "mrp", "name", "normSku", "skuCode", "status", "styleGroup", "styleNo" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_extId_key" ON "Product"("extId");
CREATE INDEX "Product_headCategory_idx" ON "Product"("headCategory");
CREATE INDEX "Product_normSku_idx" ON "Product"("normSku");
CREATE INDEX "Product_fabricId_idx" ON "Product"("fabricId");
CREATE TABLE "new_SizeBreakup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "size" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '',
    "qty" REAL NOT NULL,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "SizeBreakup_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SizeBreakup" ("id", "jobCardId", "qty", "size") SELECT "id", "jobCardId", "qty", "size" FROM "SizeBreakup";
DROP TABLE "SizeBreakup";
ALTER TABLE "new_SizeBreakup" RENAME TO "SizeBreakup";
CREATE INDEX "SizeBreakup_jobCardId_idx" ON "SizeBreakup"("jobCardId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "JobBomLine_jobCardId_idx" ON "JobBomLine"("jobCardId");

-- CreateIndex
CREATE INDEX "JobBomLine_trimItemId_idx" ON "JobBomLine"("trimItemId");

-- CreateIndex
CREATE INDEX "ReturnNote_jobCardId_idx" ON "ReturnNote"("jobCardId");

-- CreateIndex
CREATE INDEX "ReturnNote_fabricId_idx" ON "ReturnNote"("fabricId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "ProductColor_productId_idx" ON "ProductColor"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductColor_productId_name_key" ON "ProductColor"("productId", "name");
