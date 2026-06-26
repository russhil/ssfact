-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "extId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "normSku" TEXT NOT NULL,
    "styleNo" TEXT,
    "name" TEXT NOT NULL,
    "headCategory" TEXT,
    "mrp" REAL,
    "customWsRate" REAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "styleGroup" TEXT,
    "bomCode" TEXT,
    "linkedStyleId" INTEGER,
    CONSTRAINT "Product_linkedStyleId_fkey" FOREIGN KEY ("linkedStyleId") REFERENCES "Style" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bom" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "productId" INTEGER,
    CONSTRAINT "Bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sNo" INTEGER,
    "material" TEXT NOT NULL,
    "color" TEXT,
    "qty" REAL,
    "avg" TEXT,
    "bomId" INTEGER NOT NULL,
    "trimItemId" INTEGER,
    CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BomLine_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrimItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sno" TEXT,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "family" TEXT,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "currentStock" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "TrimMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "date" DATETIME,
    "invoice" TEXT,
    "rate" REAL,
    "vendor" TEXT,
    "trimItemId" INTEGER NOT NULL,
    CONSTRAINT "TrimMovement_trimItemId_fkey" FOREIGN KEY ("trimItemId") REFERENCES "TrimItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNo" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderDate" DATETIME,
    "targetQty" REAL NOT NULL,
    "avgMonthlySale" REAL,
    "status" TEXT NOT NULL DEFAULT 'ORDER_GIVEN',
    "urgency" TEXT,
    "remarks" TEXT,
    CONSTRAINT "ProductionOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_extId_key" ON "Product"("extId");

-- CreateIndex
CREATE INDEX "Product_headCategory_idx" ON "Product"("headCategory");

-- CreateIndex
CREATE INDEX "Product_normSku_idx" ON "Product"("normSku");

-- CreateIndex
CREATE INDEX "Bom_productId_idx" ON "Bom"("productId");

-- CreateIndex
CREATE INDEX "BomLine_bomId_idx" ON "BomLine"("bomId");

-- CreateIndex
CREATE INDEX "BomLine_trimItemId_idx" ON "BomLine"("trimItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrimItem_name_key" ON "TrimItem"("name");

-- CreateIndex
CREATE INDEX "TrimItem_normName_idx" ON "TrimItem"("normName");

-- CreateIndex
CREATE INDEX "TrimItem_family_idx" ON "TrimItem"("family");

-- CreateIndex
CREATE INDEX "TrimMovement_trimItemId_idx" ON "TrimMovement"("trimItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_orderNo_key" ON "ProductionOrder"("orderNo");

-- CreateIndex
CREATE INDEX "ProductionOrder_productId_idx" ON "ProductionOrder"("productId");
