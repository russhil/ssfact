-- CreateTable
CREATE TABLE "DefectType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobCardId" INTEGER NOT NULL,
    "layerId" INTEGER,
    "inspectedById" INTEGER,
    "sampleSize" INTEGER,
    "checkedQty" REAL NOT NULL DEFAULT 0,
    "passQty" REAL NOT NULL DEFAULT 0,
    "rejectQty" REAL NOT NULL DEFAULT 0,
    "reworkQty" REAL NOT NULL DEFAULT 0,
    "result" TEXT NOT NULL DEFAULT 'PASS',
    "note" TEXT,
    "voidedAt" DATETIME,
    CONSTRAINT "Inspection_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Inspection_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "CuttingLayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Inspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionDefect" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "inspectionId" INTEGER NOT NULL,
    "defectTypeId" INTEGER NOT NULL,
    "qty" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "InspectionDefect_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionDefect_defectTypeId_fkey" FOREIGN KEY ("defectTypeId") REFERENCES "DefectType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rework" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "docNo" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobCardId" INTEGER NOT NULL,
    "layerId" INTEGER,
    "vendorId" INTEGER,
    "qty" REAL NOT NULL,
    "qtyBack" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    CONSTRAINT "Rework_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rework_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "CuttingLayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Rework_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DefectType_name_key" ON "DefectType"("name");

-- CreateIndex
CREATE INDEX "Inspection_jobCardId_idx" ON "Inspection"("jobCardId");

-- CreateIndex
CREATE INDEX "Inspection_layerId_idx" ON "Inspection"("layerId");

-- CreateIndex
CREATE INDEX "InspectionDefect_inspectionId_idx" ON "InspectionDefect"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Rework_docNo_key" ON "Rework"("docNo");

-- CreateIndex
CREATE INDEX "Rework_jobCardId_idx" ON "Rework"("jobCardId");

-- CreateIndex
CREATE INDEX "Rework_vendorId_idx" ON "Rework"("vendorId");
