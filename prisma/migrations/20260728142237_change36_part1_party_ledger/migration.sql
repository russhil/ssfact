-- AlterTable
ALTER TABLE "CuttingLayer" ADD COLUMN "vendorRate" REAL;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "jobRate" REAL;
ALTER TABLE "Vendor" ADD COLUMN "jobRateType" TEXT;

-- CreateTable
CREATE TABLE "PartyLedgerEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "note" TEXT,
    "vendorId" INTEGER,
    "supplierId" INTEGER,
    "jobCardId" INTEGER,
    "dispatchEventId" INTEGER,
    "finishingJobId" INTEGER,
    "challanId" INTEGER,
    "rateAtPosting" REAL,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartyLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartyLedgerEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartyLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PartyLedgerEntry_vendorId_idx" ON "PartyLedgerEntry"("vendorId");

-- CreateIndex
CREATE INDEX "PartyLedgerEntry_supplierId_idx" ON "PartyLedgerEntry"("supplierId");

-- CreateIndex
CREATE INDEX "PartyLedgerEntry_at_idx" ON "PartyLedgerEntry"("at");
