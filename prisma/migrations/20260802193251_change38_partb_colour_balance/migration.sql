-- AlterTable
ALTER TABLE "CuttingLayerColour" ADD COLUMN "fabricBalance" REAL;

-- Change 38 Part B backfill.
--
-- Change 37 stored issued + used and derived balance on the fly. The typed column is now
-- balance, so every row written under 37 needs the balance it always implied — otherwise an
-- old card opens with a blank balance and its derived USED collapses to the issued figure.
-- Rows missing either input are left alone: there is nothing to infer from one number.
UPDATE "CuttingLayerColour"
   SET "fabricBalance" = ROUND("fabricIssued" - "fabricUsed", 2)
 WHERE "fabricIssued" IS NOT NULL
   AND "fabricUsed" IS NOT NULL;

-- The layer-level strip is the Σ of its colour rows once any exist (see colourFabricRows),
-- so bring CuttingLayer.fabricBalance in line for the lays that carry rows. A legacy lay
-- with no colour rows keeps whatever was hand-typed.
UPDATE "CuttingLayer"
   SET "fabricBalance" = (
     SELECT ROUND(SUM("fabricBalance"), 2) FROM "CuttingLayerColour"
      WHERE "CuttingLayerColour"."layerId" = "CuttingLayer"."id"
        AND "fabricBalance" IS NOT NULL
   )
 WHERE EXISTS (
   SELECT 1 FROM "CuttingLayerColour"
    WHERE "CuttingLayerColour"."layerId" = "CuttingLayer"."id"
      AND "fabricBalance" IS NOT NULL
 );
