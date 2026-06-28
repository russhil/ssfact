-- AlterTable
ALTER TABLE "Fabric" ADD COLUMN "form" TEXT;
ALTER TABLE "Fabric" ADD COLUMN "gsm" REAL;
ALTER TABLE "Fabric" ADD COLUMN "rollWidth" REAL;

-- AlterTable
ALTER TABLE "ReturnNote" ADD COLUMN "color" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "color" TEXT;

-- CreateTable
CREATE TABLE "FabricColor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "color" TEXT NOT NULL,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "fabricId" INTEGER NOT NULL,
    CONSTRAINT "FabricColor_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FabricSupplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "rate" REAL,
    "fabricId" INTEGER NOT NULL,
    CONSTRAINT "FabricSupplier_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobFabricLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "color" TEXT NOT NULL,
    "fabricId" INTEGER NOT NULL,
    "cutQty" REAL NOT NULL DEFAULT 0,
    "estAvg" REAL,
    "actualAvg" REAL,
    "gsm" REAL,
    "rollWidth" REAL,
    "qtyIssued" REAL,
    "qtyUsed" REAL,
    "jobCardId" INTEGER NOT NULL,
    CONSTRAINT "JobFabricLine_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobFabricLine_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FabricColor_fabricId_idx" ON "FabricColor"("fabricId");

-- CreateIndex
CREATE UNIQUE INDEX "FabricColor_fabricId_color_key" ON "FabricColor"("fabricId", "color");

-- CreateIndex
CREATE INDEX "FabricSupplier_fabricId_idx" ON "FabricSupplier"("fabricId");

-- CreateIndex
CREATE INDEX "JobFabricLine_jobCardId_idx" ON "JobFabricLine"("jobCardId");

-- CreateIndex
CREATE INDEX "JobFabricLine_fabricId_idx" ON "JobFabricLine"("fabricId");
