-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "summary" TEXT NOT NULL,
    "changes" TEXT,
    "meta" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "fabricIssued" REAL,
    "sizeRatio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "CuttingLayer_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CuttingLayer_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CuttingLayer" ("avgConsumption", "cutDate", "cuttingMasterId", "fabricBalance", "fabricIssued", "fabricMtr", "id", "jobCardId", "label", "layerNo", "rolls", "sizeRatio", "vendorId") SELECT "avgConsumption", "cutDate", "cuttingMasterId", "fabricBalance", "fabricIssued", "fabricMtr", "id", "jobCardId", "label", "layerNo", "rolls", "sizeRatio", "vendorId" FROM "CuttingLayer";
DROP TABLE "CuttingLayer";
ALTER TABLE "new_CuttingLayer" RENAME TO "CuttingLayer";
CREATE INDEX "CuttingLayer_jobCardId_idx" ON "CuttingLayer"("jobCardId");
CREATE INDEX "CuttingLayer_vendorId_idx" ON "CuttingLayer"("vendorId");
CREATE TABLE "new_DispatchEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "qty" REAL NOT NULL,
    "challan" TEXT,
    "dispatchNo" TEXT,
    "note" TEXT,
    "voidedAt" DATETIME,
    "arrangedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'ORDER',
    "jobCardId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "DispatchEvent_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DispatchEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DispatchEvent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DispatchEvent" ("arrangedBy", "challan", "date", "dispatchNo", "id", "jobCardId", "note", "qty", "reason", "voidedAt") SELECT "arrangedBy", "challan", "date", "dispatchNo", "id", "jobCardId", "note", "qty", "reason", "voidedAt" FROM "DispatchEvent";
DROP TABLE "DispatchEvent";
ALTER TABLE "new_DispatchEvent" RENAME TO "DispatchEvent";
CREATE UNIQUE INDEX "DispatchEvent_dispatchNo_key" ON "DispatchEvent"("dispatchNo");
CREATE INDEX "DispatchEvent_jobCardId_idx" ON "DispatchEvent"("jobCardId");
CREATE TABLE "new_FabricColor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "color" TEXT NOT NULL,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "fabricId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "FabricColor_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FabricColor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricColor_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FabricColor" ("color", "currentStock", "fabricId", "id", "openingStock") SELECT "color", "currentStock", "fabricId", "id", "openingStock" FROM "FabricColor";
DROP TABLE "FabricColor";
ALTER TABLE "new_FabricColor" RENAME TO "FabricColor";
CREATE INDEX "FabricColor_fabricId_idx" ON "FabricColor"("fabricId");
CREATE UNIQUE INDEX "FabricColor_fabricId_color_key" ON "FabricColor"("fabricId", "color");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "FabricOrder_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "Fabric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FabricOrder_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FabricOrder" ("color", "colorCount", "expectedDate", "fabricId", "gsm", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "shadeCardDone", "status", "supplierId", "unit") SELECT "color", "colorCount", "expectedDate", "fabricId", "gsm", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "shadeCardDone", "status", "supplierId", "unit" FROM "FabricOrder";
DROP TABLE "FabricOrder";
ALTER TABLE "new_FabricOrder" RENAME TO "FabricOrder";
CREATE UNIQUE INDEX "FabricOrder_poNumber_key" ON "FabricOrder"("poNumber");
CREATE INDEX "FabricOrder_fabricId_idx" ON "FabricOrder"("fabricId");
CREATE INDEX "FabricOrder_supplierId_idx" ON "FabricOrder"("supplierId");
CREATE INDEX "FabricOrder_status_idx" ON "FabricOrder"("status");
CREATE TABLE "new_JobCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siNo" TEXT NOT NULL,
    "orderDate" DATETIME,
    "cutQty" REAL NOT NULL DEFAULT 0,
    "dispatchedQty" REAL NOT NULL DEFAULT 0,
    "estAvg" REAL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "JobCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobCard_cuttingMasterId_fkey" FOREIGN KEY ("cuttingMasterId") REFERENCES "CuttingMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobCard_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobCard" ("actualAvg", "alterQty", "avgConsumption", "customItem", "customMrp", "customSku", "customStyle", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "extraQty", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "rejectQty", "remark", "siNo", "stage", "status", "trimsPending", "vendorId") SELECT "actualAvg", "alterQty", "avgConsumption", "customItem", "customMrp", "customSku", "customStyle", "cutQty", "cuttingIssuedOn", "cuttingMasterId", "dispatchedQty", "estAvg", "estFabric", "extraQty", "fabricConsumed", "fabricDispatched", "fabricIssueDate", "fabricIssued", "fabricUsed", "id", "merchandiser", "mrp", "needsEmb", "needsLaser", "needsPrint", "orderDate", "plannedEtd", "productId", "rejectQty", "remark", "siNo", "stage", "status", "trimsPending", "vendorId" FROM "JobCard";
DROP TABLE "JobCard";
ALTER TABLE "new_JobCard" RENAME TO "JobCard";
CREATE INDEX "JobCard_vendorId_idx" ON "JobCard"("vendorId");
CREATE INDEX "JobCard_productId_idx" ON "JobCard"("productId");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "MaterialChallan_jobCardId_fkey" FOREIGN KEY ("jobCardId") REFERENCES "JobCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_fabricOrderId_fkey" FOREIGN KEY ("fabricOrderId") REFERENCES "FabricOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_trimOrderId_fkey" FOREIGN KEY ("trimOrderId") REFERENCES "TrimOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MaterialChallan_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MaterialChallan" ("challanNo", "createdAt", "date", "direction", "fabricOrderId", "id", "jobCardId", "kind", "lockedAt", "note", "status", "supplierId", "trimOrderId", "vendorId", "voidedAt") SELECT "challanNo", "createdAt", "date", "direction", "fabricOrderId", "id", "jobCardId", "kind", "lockedAt", "note", "status", "supplierId", "trimOrderId", "vendorId", "voidedAt" FROM "MaterialChallan";
DROP TABLE "MaterialChallan";
ALTER TABLE "new_MaterialChallan" RENAME TO "MaterialChallan";
CREATE UNIQUE INDEX "MaterialChallan_challanNo_key" ON "MaterialChallan"("challanNo");
CREATE INDEX "MaterialChallan_direction_idx" ON "MaterialChallan"("direction");
CREATE INDEX "MaterialChallan_vendorId_idx" ON "MaterialChallan"("vendorId");
CREATE INDEX "MaterialChallan_supplierId_idx" ON "MaterialChallan"("supplierId");
CREATE INDEX "MaterialChallan_jobCardId_idx" ON "MaterialChallan"("jobCardId");
CREATE INDEX "MaterialChallan_fabricOrderId_idx" ON "MaterialChallan"("fabricOrderId");
CREATE INDEX "MaterialChallan_trimOrderId_idx" ON "MaterialChallan"("trimOrderId");
CREATE TABLE "new_TrimItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sno" TEXT,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "family" TEXT,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "category" TEXT,
    "supplierId" INTEGER,
    "ratePerUnit" REAL,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "imageUrl" TEXT,
    "dimension" TEXT,
    "perPieceAvg" REAL,
    "reorderLevel" REAL,
    "size" TEXT,
    "material" TEXT,
    "weight" TEXT,
    "shape" TEXT,
    "color" TEXT,
    "estMonthlyReq" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "TrimItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrimItem" ("category", "color", "currentStock", "dimension", "estMonthlyReq", "family", "id", "imageUrl", "material", "name", "normName", "openingStock", "perPieceAvg", "ratePerUnit", "remarks", "reorderLevel", "shape", "size", "sno", "status", "supplierId", "unit", "weight") SELECT "category", "color", "currentStock", "dimension", "estMonthlyReq", "family", "id", "imageUrl", "material", "name", "normName", "openingStock", "perPieceAvg", "ratePerUnit", "remarks", "reorderLevel", "shape", "size", "sno", "status", "supplierId", "unit", "weight" FROM "TrimItem";
DROP TABLE "TrimItem";
ALTER TABLE "new_TrimItem" RENAME TO "TrimItem";
CREATE UNIQUE INDEX "TrimItem_name_key" ON "TrimItem"("name");
CREATE INDEX "TrimItem_normName_idx" ON "TrimItem"("normName");
CREATE INDEX "TrimItem_family_idx" ON "TrimItem"("family");
CREATE INDEX "TrimItem_category_idx" ON "TrimItem"("category");
CREATE INDEX "TrimItem_supplierId_idx" ON "TrimItem"("supplierId");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    CONSTRAINT "TrimOrder_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrimOrder_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrimOrder" ("expectedDate", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "status", "supplierId", "trimItemId", "unit") SELECT "expectedDate", "id", "orderDate", "poGeneratedAt", "poNumber", "qty", "rate", "receivedDate", "remarks", "sentAt", "status", "supplierId", "trimItemId", "unit" FROM "TrimOrder";
DROP TABLE "TrimOrder";
ALTER TABLE "new_TrimOrder" RENAME TO "TrimOrder";
CREATE UNIQUE INDEX "TrimOrder_poNumber_key" ON "TrimOrder"("poNumber");
CREATE INDEX "TrimOrder_trimItemId_idx" ON "TrimOrder"("trimItemId");
CREATE INDEX "TrimOrder_supplierId_idx" ON "TrimOrder"("supplierId");
CREATE INDEX "TrimOrder_status_idx" ON "TrimOrder"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
