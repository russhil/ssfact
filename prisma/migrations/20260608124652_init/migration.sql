-- CreateTable
CREATE TABLE "Vendor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EXTERNAL'
);

-- CreateTable
CREATE TABLE "CuttingMaster" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Fabric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "openingStock" REAL NOT NULL DEFAULT 0,
    "ratePerUnit" REAL
);

-- CreateTable
CREATE TABLE "Style" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "styleNo" TEXT NOT NULL,
    "sku" TEXT,
    "itemDesc" TEXT NOT NULL,
    "mrp" REAL,
    "category" TEXT,
    "avgConsumption" REAL,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "fabricId" INTEGER,
    CONSTRAINT "Style_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siNo" TEXT NOT NULL,
    "orderDate" DATETIME,
    "cutQty" REAL NOT NULL DEFAULT 0,
    "dispatchedQty" REAL NOT NULL DEFAULT 0,
    "avgConsumption" REAL,
    "fabricIssued" REAL,
    "fabricConsumed" REAL,
    "fabricIssueDate" DATETIME,
    "cuttingIssuedOn" DATETIME,
    "plannedEtd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "remark" TEXT,
    "styleId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "cuttingMasterId" INTEGER,
    CONSTRAINT "JobCard_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DispatchEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "qty" REAL NOT NULL,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "DispatchEvent_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SizeBreakup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "size" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "SizeBreakup_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "fabricId" INTEGER NOT NULL,
    "jobCardId" INTEGER,
    CONSTRAINT "StockMovement_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CuttingMaster_name_key" ON "CuttingMaster"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Fabric_name_key" ON "Fabric"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Style_styleNo_key" ON "Style"("styleNo");

-- CreateIndex
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");

-- CreateIndex
CREATE INDEX "JobCard_styleId_idx" ON "JobCard"("styleId");

-- CreateIndex
CREATE INDEX "DispatchEvent_jobCardId_idx" ON "DispatchEvent"("jobCardId");

-- CreateIndex
CREATE INDEX "SizeBreakup_jobCardId_idx" ON "SizeBreakup"("jobCardId");

-- CreateIndex
CREATE INDEX "StockMovement_fabricId_idx" ON "StockMovement"("fabricId");
