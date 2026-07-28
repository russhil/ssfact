-- CreateTable
CREATE TABLE "CuttingLayerColour" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "layerId" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "fabricIssued" REAL,
    "fabricUsed" REAL,
    CONSTRAINT "CuttingLayerColour_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "CuttingLayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CuttingLayerColour_layerId_idx" ON "CuttingLayerColour"("layerId");

-- CreateIndex
CREATE UNIQUE INDEX "CuttingLayerColour_layerId_colour_key" ON "CuttingLayerColour"("layerId", "colour");
