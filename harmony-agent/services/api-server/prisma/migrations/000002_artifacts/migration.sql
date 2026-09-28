CREATE TABLE IF NOT EXISTS "ArtifactRecord" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "schemaId" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL, "contentVersion" INTEGER NOT NULL,
 "contentHash" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "mediaType" TEXT NOT NULL,
 "state" TEXT NOT NULL, "locatorJson" TEXT NOT NULL, "dependenciesJson" TEXT NOT NULL,
 "payloadJson" TEXT, "pinCount" INTEGER NOT NULL DEFAULT 0,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "ArtifactRecord_ownerId_state_idx" ON "ArtifactRecord"("ownerId", "state");
