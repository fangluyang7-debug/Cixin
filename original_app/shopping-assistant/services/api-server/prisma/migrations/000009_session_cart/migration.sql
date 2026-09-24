CREATE TABLE IF NOT EXISTS "SessionCartItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "candidateItemId" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionCartItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SessionCartItem_candidateItemId_fkey" FOREIGN KEY ("candidateItemId") REFERENCES "CandidateItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionCartItem_sessionId_candidateItemId_key" ON "SessionCartItem"("sessionId", "candidateItemId");
CREATE INDEX IF NOT EXISTS "SessionCartItem_sessionId_createdAt_idx" ON "SessionCartItem"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "SessionCartItem_candidateItemId_idx" ON "SessionCartItem"("candidateItemId");
