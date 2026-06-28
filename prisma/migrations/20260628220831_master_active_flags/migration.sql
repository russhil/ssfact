-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CuttingMaster" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_CuttingMaster" ("id", "name") SELECT "id", "name" FROM "CuttingMaster";
DROP TABLE "CuttingMaster";
ALTER TABLE "new_CuttingMaster" RENAME TO "CuttingMaster";
CREATE UNIQUE INDEX "CuttingMaster_name_key" ON "CuttingMaster"("name");
CREATE TABLE "new_Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "remarks" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Supplier" ("city", "id", "name", "phone", "remarks", "type") SELECT "city", "id", "name", "phone", "remarks", "type" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
CREATE INDEX "Supplier_type_idx" ON "Supplier"("type");
CREATE TABLE "new_Vendor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Vendor" ("id", "kind", "name") SELECT "id", "kind", "name" FROM "Vendor";
DROP TABLE "Vendor";
ALTER TABLE "new_Vendor" RENAME TO "Vendor";
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
