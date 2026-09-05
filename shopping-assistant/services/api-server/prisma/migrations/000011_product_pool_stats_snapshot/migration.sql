CREATE TABLE IF NOT EXISTS "ProductPoolStatsSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payloadJson" TEXT NOT NULL,
  "generatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ProductImportBatch_createdAt_idx" ON "ProductImportBatch"("createdAt");
