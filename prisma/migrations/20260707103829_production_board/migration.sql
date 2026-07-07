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
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("actualAvg", "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "remark", "siNo", "stage", "status", "trimsPending", "vendorId") SELECT "actualAvg", "avgConsumption", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "remark", "siNo", "stage", "status", "trimsPending", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Change 12, Part B: migrate legacy stage value to the new lifecycle.
UPDATE "JobCard" SET "stage" = 'ON_MACHINE' WHERE "stage" = 'STITCHING';
