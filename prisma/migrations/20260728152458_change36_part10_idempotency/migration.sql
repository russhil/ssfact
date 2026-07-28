-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "userId" INTEGER,
    "username" TEXT NOT NULL,
    "resultJson" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_at_idx" ON "IdempotencyRecord"("at");
