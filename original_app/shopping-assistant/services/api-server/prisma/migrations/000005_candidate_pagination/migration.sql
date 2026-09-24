ALTER TABLE "QueryImagePreprocessSnapshot" ADD COLUMN "embeddingVectorJson" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "CandidateItem" ADD COLUMN "rank" INTEGER;
ALTER TABLE "CandidateItem" ADD COLUMN "pageIndex" INTEGER;
ALTER TABLE "CandidateItem" ADD COLUMN "productPoolKey" TEXT;

CREATE TABLE IF NOT EXISTS "CandidatePaginationCursor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "candidateSnapshotId" TEXT NOT NULL,
  "preprocessSnapshotId" TEXT,
  "filterHash" TEXT NOT NULL,
  "offset" INTEGER NOT NULL DEFAULT 0,
  "limit" INTEGER NOT NULL DEFAULT 30,
  "sortRule" TEXT,
  "exhausted" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" DATETIME NOT NULL,
  "rawJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidatePaginationCursor_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CandidatePaginationCursor_candidateSnapshotId_fkey" FOREIGN KEY ("candidateSnapshotId") REFERENCES "CandidateSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CandidateItem_snapshotId_rank_idx" ON "CandidateItem"("snapshotId", "rank");
CREATE INDEX IF NOT EXISTS "CandidateItem_productPoolKey_idx" ON "CandidateItem"("productPoolKey");
CREATE INDEX IF NOT EXISTS "CandidatePaginationCursor_sessionId_idx" ON "CandidatePaginationCursor"("sessionId");
CREATE INDEX IF NOT EXISTS "CandidatePaginationCursor_candidateSnapshotId_idx" ON "CandidatePaginationCursor"("candidateSnapshotId");
CREATE INDEX IF NOT EXISTS "CandidatePaginationCursor_expiresAt_idx" ON "CandidatePaginationCursor"("expiresAt");
