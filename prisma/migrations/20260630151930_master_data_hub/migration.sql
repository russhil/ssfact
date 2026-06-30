-- CreateTable
CREATE TABLE "Lookup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hex" TEXT,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lookup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Lookup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Lookup_kind_parentId_idx" ON "Lookup"("kind", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Lookup_kind_code_key" ON "Lookup"("kind", "code");
