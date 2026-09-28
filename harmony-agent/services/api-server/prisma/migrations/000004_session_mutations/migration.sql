CREATE TABLE IF NOT EXISTS "SessionMutation" ("id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "baseVersion" INTEGER NOT NULL, "revision" INTEGER NOT NULL, "state" TEXT NOT NULL, "resultJson" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "SessionMutation_sessionId_requestKey_key" ON "SessionMutation"("sessionId", "requestKey");
CREATE INDEX IF NOT EXISTS "SessionMutation_sessionId_state_idx" ON "SessionMutation"("sessionId", "state");
CREATE TABLE IF NOT EXISTS "SessionWriteLock" ("sessionId" TEXT NOT NULL PRIMARY KEY, "mutationId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS "SessionWriteLock_mutationId_key" ON "SessionWriteLock"("mutationId");
