CREATE TABLE IF NOT EXISTS "PhoneDispatchPairing" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "claimedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PhoneDispatchPairing_codeHash_key" ON "PhoneDispatchPairing"("codeHash");
CREATE INDEX IF NOT EXISTS "PhoneDispatchPairing_ownerUserId_expiresAt_idx" ON "PhoneDispatchPairing"("ownerUserId","expiresAt");
CREATE TABLE IF NOT EXISTS "PhoneDispatchDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL,
  "workerUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PhoneDispatchDevice_ownerUserId_status_idx" ON "PhoneDispatchDevice"("ownerUserId","status");
CREATE INDEX IF NOT EXISTS "PhoneDispatchDevice_workerUserId_status_idx" ON "PhoneDispatchDevice"("workerUserId","status");
CREATE TABLE IF NOT EXISTS "PhoneDispatchJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL,
  "workerUserId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "inputJson" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "resultHash" TEXT,
  "computedMs" INTEGER,
  "fence" INTEGER NOT NULL DEFAULT 0,
  "leasedAt" DATETIME,
  "leaseUntil" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PhoneDispatchJob_ownerUserId_createdAt_idx" ON "PhoneDispatchJob"("ownerUserId","createdAt");
CREATE INDEX IF NOT EXISTS "PhoneDispatchJob_workerUserId_deviceId_state_idx" ON "PhoneDispatchJob"("workerUserId","deviceId","state");
