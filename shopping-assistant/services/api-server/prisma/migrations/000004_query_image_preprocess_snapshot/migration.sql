CREATE TABLE IF NOT EXISTS "QueryImagePreprocessSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "selectedBoxJson" TEXT NOT NULL DEFAULT '{}',
  "detectedBoxesJson" TEXT NOT NULL DEFAULT '[]',
  "selectionSource" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "imageWidth" INTEGER,
  "imageHeight" INTEGER,
  "embeddingProvider" TEXT,
  "embeddingModel" TEXT,
  "embeddingDimension" INTEGER,
  "embeddingVectorHash" TEXT,
  "cropImageRefJson" TEXT NOT NULL DEFAULT '{}',
  "rawJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QueryImagePreprocessSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QueryImagePreprocessSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "QueryImagePreprocessSnapshot_sessionId_createdAt_idx" ON "QueryImagePreprocessSnapshot"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "QueryImagePreprocessSnapshot_assetId_idx" ON "QueryImagePreprocessSnapshot"("assetId");
