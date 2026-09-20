CREATE TABLE "ProductImportChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "beforeJson" TEXT NOT NULL DEFAULT '{}',
  "afterJson" TEXT NOT NULL DEFAULT '{}',
  "rolledBackAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImportChange_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "ProductImportBatch" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ProductImportChange_batchId_createdAt_idx"
  ON "ProductImportChange"("batchId", "createdAt");

CREATE INDEX "ProductImportChange_productId_idx"
  ON "ProductImportChange"("productId");
