-- AlterTable
ALTER TABLE "JobFabricLine" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "JobFabricLine" ADD COLUMN "reqMtr" REAL;
ALTER TABLE "JobFabricLine" ADD COLUMN "reqPcs" REAL;
ALTER TABLE "JobFabricLine" ADD COLUMN "rolls" INTEGER;

-- CreateTable
CREATE TABLE "CuttingLayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobCardId" INTEGER NOT NULL,
    "layerNo" INTEGER NOT NULL,
    "label" TEXT,
    "cutDate" DATETIME,
    "cuttingMasterId" INTEGER,
    "avgConsumption" REAL,
    "rolls" INTEGER,
    "fabricMtr" REAL,
    "fabricBalance" REAL,
    CONSTRAINT "CuttingLayer_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CuttingLayerCell" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "layerId" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    CONSTRAINT "CuttingLayerCell_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "CuttingLayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StitchAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobCardId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "colour" TEXT,
    "lotQty" REAL,
    "note" TEXT,
    CONSTRAINT "StitchAssignment_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StitchAssignment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StitchReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assignmentId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "qty" REAL NOT NULL,
    "note" TEXT,
    CONSTRAINT "StitchReceipt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StitchAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DispatchEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "qty" REAL NOT NULL,
    "challan" TEXT,
    "note" TEXT,
    "arrangedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'ORDER',
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "DispatchEvent_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DispatchEvent" ("arrangedBy", "challan", "date", "id", "jobCardId", "note", "qty") SELECT "arrangedBy", "challan", "date", "id", "jobCardId", "note", "qty" FROM "DispatchEvent";
DROP TABLE "DispatchEvent";
ALTER TABLE "new_DispatchEvent" RENAME TO "DispatchEvent";
CREATE INDEX "DispatchEvent_jobCardId_idx" ON "DispatchEvent"("jobCardId");
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
    "needsPrint" BOOLEAN NOT NULL DEFAULT false,
    "needsLaser" BOOLEAN NOT NULL DEFAULT false,
    "needsEmb" BOOLEAN NOT NULL DEFAULT false,
    "merchandiser" TEXT,
    "mrp" REAL,
    "productId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "cuttingMasterId" INTEGER,
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("actualAvg", "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "orderDate", "plannedEtd", "productId", "remark", "siNo", "stage", "status", "trimsPending", "vendorId") SELECT "actualAvg", "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "orderDate", "plannedEtd", "productId", "remark", "siNo", "stage", "status", "trimsPending", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CuttingLayer_jobCardId_idx" ON "CuttingLayer"("jobCardId");

-- CreateIndex
CREATE INDEX "CuttingLayerCell_layerId_idx" ON "CuttingLayerCell"("layerId");

-- CreateIndex
CREATE INDEX "StitchAssignment_jobCardId_idx" ON "StitchAssignment"("jobCardId");

-- CreateIndex
CREATE INDEX "StitchAssignment_vendorId_idx" ON "StitchAssignment"("vendorId");

-- CreateIndex
CREATE INDEX "StitchReceipt_assignmentId_idx" ON "StitchReceipt"("assignmentId");
