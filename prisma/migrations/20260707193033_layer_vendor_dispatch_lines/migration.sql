-- CreateTable
CREATE TABLE "DispatchLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "colour" TEXT,
    "size" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    CONSTRAINT "DispatchLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DispatchEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_DispatchLayers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_DispatchLayers_A_fkey" FOREIGN KEY ("A") REFERENCES "CuttingLayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_DispatchLayers_B_fkey" FOREIGN KEY ("B") REFERENCES "DispatchEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CuttingLayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobCardId" INTEGER NOT NULL,
    "layerNo" INTEGER NOT NULL,
    "label" TEXT,
    "cutDate" DATETIME,
    "cuttingMasterId" INTEGER,
    "vendorId" INTEGER,
    "avgConsumption" REAL,
    "rolls" INTEGER,
    "fabricMtr" REAL,
    "fabricBalance" REAL,
    CONSTRAINT "CuttingLayer_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CuttingLayer" ("avgConsumption", "cutDate", "cuttingMasterId", "fabricBalance", "fabricMtr", "id", "jobCardId", "label", "layerNo", "rolls") SELECT "avgConsumption", "cutDate", "cuttingMasterId", "fabricBalance", "fabricMtr", "id", "jobCardId", "label", "layerNo", "rolls" FROM "CuttingLayer";
DROP TABLE "CuttingLayer";
ALTER TABLE "new_CuttingLayer" RENAME TO "CuttingLayer";
CREATE INDEX "CuttingLayer_jobCardId_idx" ON "CuttingLayer"("jobCardId");
CREATE INDEX "CuttingLayer_vendorId_idx" ON "CuttingLayer"("vendorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DispatchLine_eventId_idx" ON "DispatchLine"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "_DispatchLayers_AB_unique" ON "_DispatchLayers"("A", "B");

-- CreateIndex
CREATE INDEX "_DispatchLayers_B_index" ON "_DispatchLayers"("B");
