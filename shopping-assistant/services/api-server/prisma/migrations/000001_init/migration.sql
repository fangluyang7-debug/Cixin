CREATE TABLE IF NOT EXISTS "ImageAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetGroupId" TEXT NOT NULL,
    "variantType" TEXT NOT NULL,
    "isPrimaryRecognitionAsset" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "bucketGroup" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uploadStatus" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UserCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'scrypt',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "QuerySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "entrySource" TEXT NOT NULL,
    "categoryHint" TEXT,
    "currentTurnIndex" INTEGER NOT NULL DEFAULT 0,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" DATETIME NOT NULL,
    CONSTRAINT "QuerySession_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuerySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProductProfileSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT,
    "size" TEXT,
    "color" TEXT,
    "keywordsJson" TEXT NOT NULL DEFAULT '[]',
    "styleTagsJson" TEXT NOT NULL DEFAULT '[]',
    "sceneTagsJson" TEXT NOT NULL DEFAULT '[]',
    "confidence" REAL,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductProfileSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SessionTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "parsedFilterJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ConversationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ConversationSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "summaryText" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "coveredTurnIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserProfileBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "blockType" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "sensitivity" TEXT NOT NULL DEFAULT 'low',
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserProfileBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserProfileIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "blockType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserProfileIndex_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserProfileIndex_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "UserProfileBlock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserMemoryProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "turnIndex" INTEGER,
    "blockType" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "sourceText" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confidence" REAL NOT NULL DEFAULT 0.7,
    "sensitivity" TEXT NOT NULL DEFAULT 'low',
    "schemaVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserMemoryProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserMemoryProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserMemoryAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "blockId" TEXT,
    "proposalId" TEXT,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL DEFAULT '{}',
    "afterJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserMemoryAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "FilterSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "priceMin" TEXT,
    "priceMax" TEXT,
    "timeConstraintDays" INTEGER,
    "urgentDeliveryPreferred" BOOLEAN NOT NULL DEFAULT false,
    "stockOnly" BOOLEAN NOT NULL DEFAULT false,
    "shopType" TEXT,
    "color" TEXT,
    "brand" TEXT,
    "platform" TEXT,
    "sortRule" TEXT NOT NULL DEFAULT 'relevance_desc',
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FilterSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CandidateSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "appliedFilterJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CandidateItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "platformName" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "shopName" TEXT,
    "shopType" TEXT,
    "stockStatus" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "productUrl" TEXT,
    "matchSummaryJson" TEXT NOT NULL DEFAULT '{}',
    "normalizedAttributesJson" TEXT NOT NULL DEFAULT '{}',
    "rawPayloadJson" TEXT NOT NULL DEFAULT '{}',
    "recommendationReasonJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CandidateSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProductImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchSource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importBatchId" TEXT,
    "externalId" TEXT,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceAmount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "stockStatus" TEXT NOT NULL,
    "shopName" TEXT,
    "shopType" TEXT,
    "productUrl" TEXT NOT NULL,
    "sourceImageUrl" TEXT,
    "imageBucketGroup" TEXT,
    "imageObjectKey" TEXT,
    "imagePublicUrl" TEXT,
    "tagStatus" TEXT NOT NULL DEFAULT 'pending',
    "brand" TEXT,
    "category" TEXT,
    "modelLine" TEXT,
    "colorFamily" TEXT,
    "colorway" TEXT,
    "shoeType" TEXT,
    "keywordsJson" TEXT NOT NULL DEFAULT '[]',
    "normalizedTagsJson" TEXT NOT NULL DEFAULT '{}',
    "rawPayloadJson" TEXT NOT NULL DEFAULT '{}',
    "tagConfidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ProductImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProductTagAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT,
    "importBatchId" TEXT,
    "status" TEXT NOT NULL,
    "modelAJson" TEXT NOT NULL DEFAULT '{}',
    "modelBJson" TEXT NOT NULL DEFAULT '{}',
    "consensusJson" TEXT NOT NULL DEFAULT '{}',
    "conflictJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductTagAudit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductTagAudit_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ProductImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProductImageEmbedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT,
    "dimension" INTEGER NOT NULL,
    "vectorJson" TEXT NOT NULL,
    "vectorHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductImageEmbedding_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExternalSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL DEFAULT '{}',
    "responseJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "FallbackSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FallbackSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductProfileSnapshot_sessionId_key" ON "ProductProfileSnapshot"("sessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "UserCredential_userId_key" ON "UserCredential"("userId");
CREATE INDEX IF NOT EXISTS "QuerySession_userId_idx" ON "QuerySession"("userId");
CREATE INDEX IF NOT EXISTS "SessionTurn_sessionId_turnIndex_idx" ON "SessionTurn"("sessionId", "turnIndex");
CREATE INDEX IF NOT EXISTS "ConversationMessage_sessionId_turnIndex_idx" ON "ConversationMessage"("sessionId", "turnIndex");
CREATE INDEX IF NOT EXISTS "ConversationMessage_sessionId_createdAt_idx" ON "ConversationMessage"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationSummary_sessionId_coveredTurnIndex_idx" ON "ConversationSummary"("sessionId", "coveredTurnIndex");
CREATE INDEX IF NOT EXISTS "UserProfileBlock_userId_blockType_idx" ON "UserProfileBlock"("userId", "blockType");
CREATE INDEX IF NOT EXISTS "UserProfileBlock_userId_scope_status_idx" ON "UserProfileBlock"("userId", "scope", "status");
CREATE INDEX IF NOT EXISTS "UserProfileIndex_userId_key_value_idx" ON "UserProfileIndex"("userId", "key", "value");
CREATE INDEX IF NOT EXISTS "UserProfileIndex_blockId_idx" ON "UserProfileIndex"("blockId");
CREATE INDEX IF NOT EXISTS "UserMemoryProposal_userId_status_idx" ON "UserMemoryProposal"("userId", "status");
CREATE INDEX IF NOT EXISTS "UserMemoryProposal_sessionId_idx" ON "UserMemoryProposal"("sessionId");
CREATE INDEX IF NOT EXISTS "UserMemoryAuditLog_userId_createdAt_idx" ON "UserMemoryAuditLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserMemoryAuditLog_blockId_idx" ON "UserMemoryAuditLog"("blockId");
CREATE INDEX IF NOT EXISTS "UserMemoryAuditLog_proposalId_idx" ON "UserMemoryAuditLog"("proposalId");
CREATE INDEX IF NOT EXISTS "FilterSnapshot_sessionId_turnIndex_idx" ON "FilterSnapshot"("sessionId", "turnIndex");
CREATE INDEX IF NOT EXISTS "CandidateSnapshot_sessionId_turnIndex_idx" ON "CandidateSnapshot"("sessionId", "turnIndex");
CREATE INDEX IF NOT EXISTS "CandidateItem_snapshotId_idx" ON "CandidateItem"("snapshotId");
CREATE INDEX IF NOT EXISTS "Product_platform_idx" ON "Product"("platform");
CREATE INDEX IF NOT EXISTS "Product_tagStatus_idx" ON "Product"("tagStatus");
CREATE INDEX IF NOT EXISTS "Product_brand_category_idx" ON "Product"("brand", "category");
CREATE INDEX IF NOT EXISTS "Product_modelLine_idx" ON "Product"("modelLine");
CREATE INDEX IF NOT EXISTS "ProductTagAudit_productId_idx" ON "ProductTagAudit"("productId");
CREATE INDEX IF NOT EXISTS "ProductTagAudit_importBatchId_idx" ON "ProductTagAudit"("importBatchId");
CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_productId_idx" ON "ProductImageEmbedding"("productId");
CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_provider_idx" ON "ProductImageEmbedding"("provider");
