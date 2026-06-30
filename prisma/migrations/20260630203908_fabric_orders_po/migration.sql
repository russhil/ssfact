-- AlterTable
ALTER TABLE "FabricOrder" ADD COLUMN "poGeneratedAt" DATETIME;
ALTER TABLE "FabricOrder" ADD COLUMN "poNumber" TEXT;
ALTER TABLE "FabricOrder" ADD COLUMN "sentAt" DATETIME;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "address" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "email" TEXT;

-- CreateTable
CREATE TABLE "Colour" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FabricOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fabricOrderId" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    CONSTRAINT "FabricOrderLine_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Colour_name_key" ON "Colour"("name");

-- CreateIndex
CREATE INDEX "FabricOrderLine_fabricOrderId_idx" ON "FabricOrderLine"("fabricOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "FabricOrder_poNumber_key" ON "FabricOrder"("poNumber");

