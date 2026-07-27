-- CreateTable
CREATE TABLE "FinishingJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "docNo" TEXT,
    "process" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "vendorId" INTEGER NOT NULL,
    "jobCardId" INTEGER NOT NULL,
    "issuedDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedDate" DATETIME,
    "qtyOut" REAL NOT NULL,
    "qtyBack" REAL NOT NULL DEFAULT 0,
    "rate" REAL,
    "billNo" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinishingJob_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinishingJob_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinishingJobLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" INTEGER NOT NULL,
    "colour" TEXT,
    "size" TEXT NOT NULL,
    "qtyOut" REAL NOT NULL,
    "qtyBack" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "FinishingJobLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "FinishingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_FinishingLayers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_FinishingLayers_A_fkey" FOREIGN KEY ("A") REFERENCES "CuttingLayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_FinishingLayers_B_fkey" FOREIGN KEY ("B") REFERENCES "FinishingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FinishingJob_docNo_key" ON "FinishingJob"("docNo");

-- CreateIndex
CREATE INDEX "FinishingJob_vendorId_idx" ON "FinishingJob"("vendorId");

-- CreateIndex
CREATE INDEX "FinishingJob_jobCardId_idx" ON "FinishingJob"("jobCardId");

-- CreateIndex
CREATE INDEX "FinishingJob_process_idx" ON "FinishingJob"("process");

-- CreateIndex
CREATE INDEX "FinishingJobLine_jobId_idx" ON "FinishingJobLine"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "_FinishingLayers_AB_unique" ON "_FinishingLayers"("A", "B");

-- CreateIndex
CREATE INDEX "_FinishingLayers_B_index" ON "_FinishingLayers"("B");
