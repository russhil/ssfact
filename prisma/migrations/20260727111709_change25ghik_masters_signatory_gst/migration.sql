-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "gstNo" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "signatureUrl" TEXT;

-- CreateTable
CREATE TABLE "Contact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sortOrder" INTEGER,
    "supplierId" INTEGER,
    "buyerId" INTEGER,
    CONSTRAINT "Contact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contact_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "gstNo" TEXT,
    "city" TEXT,
    "buyerAddress" TEXT,
    "billingAddress" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "BuyerDeliveryAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "buyerId" INTEGER NOT NULL,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "BuyerDeliveryAddress_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FabricOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fabricId" INTEGER NOT NULL,
    "color" TEXT,
    "supplierId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "rate" REAL,
    "gsm" REAL,
    "colorCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "shadeCardDone" BOOLEAN NOT NULL DEFAULT false,
    "orderDate" DATETIME,
    "expectedDate" DATETIME,
    "receivedDate" DATETIME,
    "remarks" TEXT,
    "poNumber" TEXT,
    "poGeneratedAt" DATETIME,
    "sentAt" DATETIME,
    "buyerId" INTEGER,
    "deliveryAddressId" INTEGER,
    "placedById" INTEGER,
    "gstRate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "FabricOrder_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "BuyerDeliveryAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FabricOrder" ("color", "colorCount", "createdAt", "createdById", "expectedDate", "fabricId", "gsm", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "shadeCardDone", "status", "supplierId", "unit", "updatedAt", "updatedById") SELECT "color", "colorCount", "createdAt", "createdById", "expectedDate", "fabricId", "gsm", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "shadeCardDone", "status", "supplierId", "unit", "updatedAt", "updatedById" FROM "FabricOrder";
DROP TABLE "FabricOrder";
ALTER TABLE "new_FabricOrder" RENAME TO "FabricOrder";
CREATE UNIQUE INDEX "FabricOrder_poNumber_key" ON "FabricOrder"("poNumber");
CREATE INDEX "FabricOrder_fabricId_idx" ON "FabricOrder"("fabricId");
CREATE INDEX "FabricOrder_supplierId_idx" ON "FabricOrder"("supplierId");
CREATE INDEX "FabricOrder_status_idx" ON "FabricOrder"("status");
CREATE TABLE "new_ImageAsset" (
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
    "trimOrderId" INTEGER,
    "materialChallanId" INTEGER,
    CONSTRAINT "ImageAsset_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_materialChallanId_fkey" FOREIGN KEY ("materialChallanId") REFERENCES "MaterialChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImageAsset" ("caption", "createdAt", "fabricId", "fabricOrderId", "id", "kind", "productId", "sortOrder", "thumbUrl", "trimItemId", "url") SELECT "caption", "createdAt", "fabricId", "fabricOrderId", "id", "kind", "productId", "sortOrder", "thumbUrl", "trimItemId", "url" FROM "ImageAsset";
DROP TABLE "ImageAsset";
ALTER TABLE "new_ImageAsset" RENAME TO "ImageAsset";
CREATE INDEX "ImageAsset_trimItemId_idx" ON "ImageAsset"("trimItemId");
CREATE INDEX "ImageAsset_fabricId_idx" ON "ImageAsset"("fabricId");
CREATE INDEX "ImageAsset_fabricOrderId_idx" ON "ImageAsset"("fabricOrderId");
CREATE INDEX "ImageAsset_productId_idx" ON "ImageAsset"("productId");
CREATE INDEX "ImageAsset_trimOrderId_idx" ON "ImageAsset"("trimOrderId");
CREATE INDEX "ImageAsset_materialChallanId_idx" ON "ImageAsset"("materialChallanId");
CREATE TABLE "new_TrimOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trimItemId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "qty" REAL NOT NULL,
    "unit" TEXT,
    "rate" REAL,
    "status" TEXT NOT NULL DEFAULT 'ORDER_PLACED',
    "orderDate" DATETIME,
    "expectedDate" DATETIME,
    "receivedDate" DATETIME,
    "remarks" TEXT,
    "poNumber" TEXT,
    "poGeneratedAt" DATETIME,
    "sentAt" DATETIME,
    "buyerId" INTEGER,
    "deliveryAddressId" INTEGER,
    "placedById" INTEGER,
    "gstRate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "TrimOrder_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "BuyerDeliveryAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrimOrder" ("createdAt", "createdById", "expectedDate", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "status", "supplierId", "trimItemId", "unit", "updatedAt", "updatedById") SELECT "createdAt", "createdById", "expectedDate", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "status", "supplierId", "trimItemId", "unit", "updatedAt", "updatedById" FROM "TrimOrder";
DROP TABLE "TrimOrder";
ALTER TABLE "new_TrimOrder" RENAME TO "TrimOrder";
CREATE UNIQUE INDEX "TrimOrder_poNumber_key" ON "TrimOrder"("poNumber");
CREATE INDEX "TrimOrder_trimItemId_idx" ON "TrimOrder"("trimItemId");
CREATE INDEX "TrimOrder_supplierId_idx" ON "TrimOrder"("supplierId");
CREATE INDEX "TrimOrder_status_idx" ON "TrimOrder"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Contact_supplierId_idx" ON "Contact"("supplierId");

-- CreateIndex
CREATE INDEX "Contact_buyerId_idx" ON "Contact"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_name_key" ON "Buyer"("name");

-- CreateIndex
CREATE INDEX "BuyerDeliveryAddress_buyerId_idx" ON "BuyerDeliveryAddress"("buyerId");
