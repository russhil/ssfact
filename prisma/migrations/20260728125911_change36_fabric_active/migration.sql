-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Fabric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MTR',
    "openingStock" REAL NOT NULL DEFAULT 0,
    "ratePerUnit" REAL,
    "gsm" REAL,
    "rollWidth" REAL,
    "form" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Fabric" ("form", "gsm", "id", "name", "openingStock", "ratePerUnit", "rollWidth", "unit") SELECT "form", "gsm", "id", "name", "openingStock", "ratePerUnit", "rollWidth", "unit" FROM "Fabric";
DROP TABLE "Fabric";
ALTER TABLE "new_Fabric" RENAME TO "Fabric";
CREATE UNIQUE INDEX "Fabric_name_key" ON "Fabric"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
