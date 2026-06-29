-- AlterTable
ALTER TABLE "Product" ADD COLUMN "fabricRemarks" TEXT;
ALTER TABLE "Product" ADD COLUMN "otherRemarks" TEXT;
ALTER TABLE "Product" ADD COLUMN "productionLot" TEXT;
ALTER TABLE "Product" ADD COLUMN "samplingStatus" TEXT;

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "caption" TEXT,
    "kind" TEXT,
    "sortOrder" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trimItemId" INTEGER,
    "fabricId" INTEGER,
    "fabricOrderId" INTEGER,
    "productId" INTEGER,
    CONSTRAINT "ImageAsset_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImageAsset_trimItemId_idx" ON "ImageAsset"("trimItemId");

-- CreateIndex
CREATE INDEX "ImageAsset_fabricId_idx" ON "ImageAsset"("fabricId");

-- CreateIndex
CREATE INDEX "ImageAsset_fabricOrderId_idx" ON "ImageAsset"("fabricOrderId");

-- CreateIndex
CREATE INDEX "ImageAsset_productId_idx" ON "ImageAsset"("productId");
