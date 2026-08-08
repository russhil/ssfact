-- AlterTable
ALTER TABLE "FabricOrder" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "FabricOrder" ADD COLUMN "voidedAt" DATETIME;

-- AlterTable
ALTER TABLE "MaterialChallanLine" ADD COLUMN "rolls" INTEGER;
ALTER TABLE "MaterialChallanLine" ADD COLUMN "widthInch" REAL;

-- AlterTable
ALTER TABLE "TrimOrder" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "TrimOrder" ADD COLUMN "voidedAt" DATETIME;

-- CreateTable
CREATE TABLE "TrimItemSupplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trimItemId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "name" TEXT,
    "rate" REAL,
    "poNumber" TEXT,
    "sourcedAt" DATETIME,
    CONSTRAINT "TrimItemSupplier_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrimItemSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FabricColorStock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fabricColorId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "openingStock" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "FabricColorStock_fabricColorId_fkey" FOREIGN KEY ("fabricColorId") REFERENCES "FabricColor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FabricColorStock_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrimItemStock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trimItemId" INTEGER NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "reorderLevel" REAL,
    CONSTRAINT "TrimItemStock_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrimItemStock_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PressChallan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "docNo" TEXT,
    "direction" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobCardId" INTEGER NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "qty" REAL NOT NULL,
    "note" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "pressOutId" INTEGER,
    "supplementaryOfId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    CONSTRAINT "PressChallan_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PressChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PressChallan_pressOutId_fkey" FOREIGN KEY ("pressOutId") REFERENCES "PressChallan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PressChallan_supplementaryOfId_fkey" FOREIGN KEY ("supplementaryOfId") REFERENCES "PressChallan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PressChallan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PressChallanLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "challanId" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    CONSTRAINT "PressChallanLine_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "PressChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_PressLayers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_PressLayers_A_fkey" FOREIGN KEY ("A") REFERENCES "CuttingLayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PressLayers_B_fkey" FOREIGN KEY ("B") REFERENCES "PressChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Buyer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "gstNo" TEXT,
    "city" TEXT,
    "buyerAddress" TEXT,
    "billingAddress" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "holdsStock" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Buyer" ("active", "billingAddress", "buyerAddress", "city", "gstNo", "id", "name") SELECT "active", "billingAddress", "buyerAddress", "city", "gstNo", "id", "name" FROM "Buyer";
DROP TABLE "Buyer";
ALTER TABLE "new_Buyer" RENAME TO "Buyer";
CREATE UNIQUE INDEX "Buyer_name_key" ON "Buyer"("name");
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
    "sampleId" INTEGER,
    "pressChallanId" INTEGER,
    CONSTRAINT "ImageAsset_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_materialChallanId_fkey" FOREIGN KEY ("materialChallanId") REFERENCES "MaterialChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageAsset_pressChallanId_fkey" FOREIGN KEY ("pressChallanId") REFERENCES "PressChallan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImageAsset" ("caption", "createdAt", "fabricId", "fabricOrderId", "id", "kind", "materialChallanId", "productId", "sampleId", "sortOrder", "thumbUrl", "trimItemId", "trimOrderId", "url") SELECT "caption", "createdAt", "fabricId", "fabricOrderId", "id", "kind", "materialChallanId", "productId", "sampleId", "sortOrder", "thumbUrl", "trimItemId", "trimOrderId", "url" FROM "ImageAsset";
DROP TABLE "ImageAsset";
ALTER TABLE "new_ImageAsset" RENAME TO "ImageAsset";
CREATE INDEX "ImageAsset_trimItemId_idx" ON "ImageAsset"("trimItemId");
CREATE INDEX "ImageAsset_fabricId_idx" ON "ImageAsset"("fabricId");
CREATE INDEX "ImageAsset_fabricOrderId_idx" ON "ImageAsset"("fabricOrderId");
CREATE INDEX "ImageAsset_productId_idx" ON "ImageAsset"("productId");
CREATE INDEX "ImageAsset_trimOrderId_idx" ON "ImageAsset"("trimOrderId");
CREATE INDEX "ImageAsset_materialChallanId_idx" ON "ImageAsset"("materialChallanId");
CREATE INDEX "ImageAsset_pressChallanId_idx" ON "ImageAsset"("pressChallanId");
CREATE TABLE "new_JobCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siNo" TEXT NOT NULL,
    "orderDate" DATETIME,
    "cutQty" REAL NOT NULL DEFAULT 0,
    "dispatchedQty" REAL NOT NULL DEFAULT 0,
    "estAvg" REAL,
    "stdFabricPerPc" REAL,
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
    "productionOrderId" INTEGER,
    "buyerId" INTEGER,
    "editLockedAt" DATETIME,
    "signatoryName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("actualAvg", "alterQty", "avgConsumption", "createdAt", "createdById", "customItem", "customMrp", "customSku", "customStyle", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "editLockedAt", "estAvg", "estFabric", "extraQty", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "productionOrderId", "rejectQty", "remark", "siNo", "signatoryName", "stage", "status", "stdFabricPerPc", "trimsPending", "updatedAt", "updatedById", "vendorId") SELECT "actualAvg", "alterQty", "avgConsumption", "createdAt", "createdById", "customItem", "customMrp", "customSku", "customStyle", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "editLockedAt", "estAvg", "estFabric", "extraQty", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "productionOrderId", "rejectQty", "remark", "siNo", "signatoryName", "stage", "status", "stdFabricPerPc", "trimsPending", "updatedAt", "updatedById", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
CREATE INDEX "JobCard_buyerId_idx" ON "JobCard"("buyerId");
CREATE TABLE "new_MaterialChallan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "challanNo" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT,
    "jobCardId" INTEGER,
    "supplierId" INTEGER,
    "vendorId" INTEGER,
    "fabricOrderId" INTEGER,
    "trimOrderId" INTEGER,
    "note" TEXT,
    "lockedAt" DATETIME,
    "voidedAt" DATETIME,
    "poPending" BOOLEAN NOT NULL DEFAULT false,
    "workType" TEXT,
    "fromBuyerId" INTEGER,
    "toBuyerId" INTEGER,
    "transferPair" INTEGER,
    "signatoryName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnOfChallanId" INTEGER,
    "returnReason" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "MaterialChallan_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_fromBuyerId_fkey" FOREIGN KEY ("fromBuyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_toBuyerId_fkey" FOREIGN KEY ("toBuyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_returnOfChallanId_fkey" FOREIGN KEY ("returnOfChallanId") REFERENCES "MaterialChallan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaterialChallan" ("challanNo", "createdAt", "createdById", "date", "direction", "fabricOrderId", "id", "jobCardId", "kind", "lockedAt", "note", "returnOfChallanId", "returnReason", "signatoryName", "status", "supplierId", "trimOrderId", "updatedAt", "updatedById", "vendorId", "voidedAt") SELECT "challanNo", "createdAt", "createdById", "date", "direction", "fabricOrderId", "id", "jobCardId", "kind", "lockedAt", "note", "returnOfChallanId", "returnReason", "signatoryName", "status", "supplierId", "trimOrderId", "updatedAt", "updatedById", "vendorId", "voidedAt" FROM "MaterialChallan";
DROP TABLE "MaterialChallan";
ALTER TABLE "new_MaterialChallan" RENAME TO "MaterialChallan";
CREATE UNIQUE INDEX "MaterialChallan_challanNo_key" ON "MaterialChallan"("challanNo");
CREATE INDEX "MaterialChallan_direction_idx" ON "MaterialChallan"("direction");
CREATE INDEX "MaterialChallan_vendorId_idx" ON "MaterialChallan"("vendorId");
CREATE INDEX "MaterialChallan_supplierId_idx" ON "MaterialChallan"("supplierId");
CREATE INDEX "MaterialChallan_jobCardId_idx" ON "MaterialChallan"("jobCardId");
CREATE INDEX "MaterialChallan_fabricOrderId_idx" ON "MaterialChallan"("fabricOrderId");
CREATE INDEX "MaterialChallan_trimOrderId_idx" ON "MaterialChallan"("trimOrderId");
CREATE TABLE "new_StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "note" TEXT,
    "reason" TEXT,
    "color" TEXT,
    "fabricId" INTEGER NOT NULL,
    "jobCardId" INTEGER,
    "buyerId" INTEGER,
    CONSTRAINT "StockMovement_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("color", "date", "fabricId", "id", "jobCardId", "note", "qty", "reason", "type") SELECT "color", "date", "fabricId", "id", "jobCardId", "note", "qty", "reason", "type" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE INDEX "StockMovement_fabricId_idx" ON "StockMovement"("fabricId");
CREATE INDEX "StockMovement_buyerId_idx" ON "StockMovement"("buyerId");
CREATE TABLE "new_TrimMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "date" DATETIME,
    "invoice" TEXT,
    "rate" REAL,
    "vendor" TEXT,
    "note" TEXT,
    "reason" TEXT,
    "trimItemId" INTEGER NOT NULL,
    "buyerId" INTEGER,
    CONSTRAINT "TrimMovement_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrimMovement_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrimMovement" ("date", "id", "invoice", "note", "qty", "rate", "reason", "trimItemId", "type", "vendor") SELECT "date", "id", "invoice", "note", "qty", "rate", "reason", "trimItemId", "type", "vendor" FROM "TrimMovement";
DROP TABLE "TrimMovement";
ALTER TABLE "new_TrimMovement" RENAME TO "TrimMovement";
CREATE INDEX "TrimMovement_trimItemId_idx" ON "TrimMovement"("trimItemId");
CREATE INDEX "TrimMovement_buyerId_idx" ON "TrimMovement"("buyerId");
CREATE TABLE "new_TrimOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trimOrderId" INTEGER NOT NULL,
    "colour" TEXT,
    "size" TEXT,
    "qty" REAL NOT NULL,
    "trimItemId" INTEGER,
    "rate" REAL,
    CONSTRAINT "TrimOrderLine_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrimOrderLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrimOrderLine" ("colour", "id", "qty", "size", "trimOrderId") SELECT "colour", "id", "qty", "size", "trimOrderId" FROM "TrimOrderLine";
DROP TABLE "TrimOrderLine";
ALTER TABLE "new_TrimOrderLine" RENAME TO "TrimOrderLine";
CREATE INDEX "TrimOrderLine_trimOrderId_idx" ON "TrimOrderLine"("trimOrderId");
CREATE INDEX "TrimOrderLine_trimItemId_idx" ON "TrimOrderLine"("trimItemId");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "vendorName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureUrl" TEXT,
    "buyerId" INTEGER,
    CONSTRAINT "User_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "displayName", "email", "id", "passwordHash", "phone", "role", "signatureUrl", "username", "vendorName") SELECT "active", "createdAt", "displayName", "email", "id", "passwordHash", "phone", "role", "signatureUrl", "username", "vendorName" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_buyerId_idx" ON "User"("buyerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TrimItemSupplier_trimItemId_idx" ON "TrimItemSupplier"("trimItemId");

-- CreateIndex
CREATE INDEX "TrimItemSupplier_supplierId_idx" ON "TrimItemSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "FabricColorStock_buyerId_idx" ON "FabricColorStock"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "FabricColorStock_fabricColorId_buyerId_key" ON "FabricColorStock"("fabricColorId", "buyerId");

-- CreateIndex
CREATE INDEX "TrimItemStock_buyerId_idx" ON "TrimItemStock"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrimItemStock_trimItemId_buyerId_key" ON "TrimItemStock"("trimItemId", "buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "PressChallan_docNo_key" ON "PressChallan"("docNo");

-- CreateIndex
CREATE INDEX "PressChallan_jobCardId_idx" ON "PressChallan"("jobCardId");

-- CreateIndex
CREATE INDEX "PressChallan_vendorId_idx" ON "PressChallan"("vendorId");

-- CreateIndex
CREATE INDEX "PressChallan_pressOutId_idx" ON "PressChallan"("pressOutId");

-- CreateIndex
CREATE INDEX "PressChallanLine_challanId_idx" ON "PressChallanLine"("challanId");

-- CreateIndex
CREATE UNIQUE INDEX "_PressLayers_AB_unique" ON "_PressLayers"("A", "B");

-- CreateIndex
CREATE INDEX "_PressLayers_B_index" ON "_PressLayers"("B");
