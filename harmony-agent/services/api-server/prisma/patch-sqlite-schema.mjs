import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await ensureQuerySessionUserId();
  await ensureProductImageEmbeddingMetadata();
  await ensureQueryImagePreprocessSnapshot();
  await ensureQueryImagePreprocessPaginationColumns();
  await ensureCandidateItemPaginationColumns();
  await ensureCandidatePaginationCursor();
  await ensureSessionCartItem();
  await ensureProductImportChange();
  await ensureProductPoolStatsSnapshot();
  await normalizeProductCategoryScope();
  await ensureIndexes();
} finally {
  await prisma.$disconnect();
}

async function ensureQuerySessionUserId() {
  if (!(await tableExists('QuerySession'))) return;
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("QuerySession")');
  const hasUserId = Array.isArray(columns) && columns.some((column) => column.name === 'userId');
  if (!hasUserId) {
    await prisma.$executeRawUnsafe('ALTER TABLE "QuerySession" ADD COLUMN "userId" TEXT');
  }
}

async function ensureIndexes() {
  const statements = [
    'CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "UserCredential_userId_key" ON "UserCredential"("userId")',
    'CREATE INDEX IF NOT EXISTS "ImageAsset_bucketGroup_objectKey_idx" ON "ImageAsset"("bucketGroup", "objectKey")',
    'CREATE INDEX IF NOT EXISTS "ImageAsset_assetGroupId_variantType_idx" ON "ImageAsset"("assetGroupId", "variantType")',
    'CREATE INDEX IF NOT EXISTS "QuerySession_userId_idx" ON "QuerySession"("userId")',
    'CREATE INDEX IF NOT EXISTS "UserProfileBlock_userId_blockType_idx" ON "UserProfileBlock"("userId", "blockType")',
    'CREATE INDEX IF NOT EXISTS "UserProfileBlock_userId_scope_status_idx" ON "UserProfileBlock"("userId", "scope", "status")',
    'CREATE INDEX IF NOT EXISTS "UserProfileIndex_userId_key_value_idx" ON "UserProfileIndex"("userId", "key", "value")',
    'CREATE INDEX IF NOT EXISTS "UserProfileIndex_blockId_idx" ON "UserProfileIndex"("blockId")',
    'CREATE INDEX IF NOT EXISTS "UserMemoryProposal_userId_status_idx" ON "UserMemoryProposal"("userId", "status")',
    'CREATE INDEX IF NOT EXISTS "UserMemoryProposal_sessionId_idx" ON "UserMemoryProposal"("sessionId")',
    'CREATE INDEX IF NOT EXISTS "UserMemoryAuditLog_userId_createdAt_idx" ON "UserMemoryAuditLog"("userId", "createdAt")',
    'CREATE INDEX IF NOT EXISTS "UserMemoryAuditLog_blockId_idx" ON "UserMemoryAuditLog"("blockId")',
    'CREATE INDEX IF NOT EXISTS "UserMemoryAuditLog_proposalId_idx" ON "UserMemoryAuditLog"("proposalId")',
    'CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product"("category")',
    'CREATE INDEX IF NOT EXISTS "Product_platform_externalId_idx" ON "Product"("platform", "externalId")',
    'CREATE INDEX IF NOT EXISTS "Product_tagStatus_category_idx" ON "Product"("tagStatus", "category")',
    'CREATE INDEX IF NOT EXISTS "Product_tagStatus_platform_idx" ON "Product"("tagStatus", "platform")',
    'CREATE INDEX IF NOT EXISTS "Product_tagStatus_updatedAt_idx" ON "Product"("tagStatus", "updatedAt")',
    'CREATE INDEX IF NOT EXISTS "ProductImportBatch_createdAt_idx" ON "ProductImportBatch"("createdAt")',
    'CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_productId_styleId_idx" ON "ProductImageEmbedding"("productId", "styleId")',
    'CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_productId_embeddingKind_idx" ON "ProductImageEmbedding"("productId", "embeddingKind")',
    'CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_idx" ON "ProductImageEmbedding"("embeddingKind")',
    'CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_provider_dimension_idx" ON "ProductImageEmbedding"("embeddingKind", "provider", "dimension")',
    'CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_provider_dimension_id_idx" ON "ProductImageEmbedding"("embeddingKind", "provider", "dimension", "id")',
    'CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_provider_dimension_productId_idx" ON "ProductImageEmbedding"("embeddingKind", "provider", "dimension", "productId")',
    'CREATE INDEX IF NOT EXISTS "QueryImagePreprocessSnapshot_sessionId_createdAt_idx" ON "QueryImagePreprocessSnapshot"("sessionId", "createdAt")',
    'CREATE INDEX IF NOT EXISTS "QueryImagePreprocessSnapshot_sessionId_status_createdAt_idx" ON "QueryImagePreprocessSnapshot"("sessionId", "status", "createdAt")',
    'CREATE INDEX IF NOT EXISTS "QueryImagePreprocessSnapshot_assetId_idx" ON "QueryImagePreprocessSnapshot"("assetId")',
    'CREATE INDEX IF NOT EXISTS "CandidateItem_snapshotId_rank_idx" ON "CandidateItem"("snapshotId", "rank")',
    'CREATE INDEX IF NOT EXISTS "CandidateItem_productPoolKey_idx" ON "CandidateItem"("productPoolKey")',
    'CREATE INDEX IF NOT EXISTS "CandidatePaginationCursor_sessionId_idx" ON "CandidatePaginationCursor"("sessionId")',
    'CREATE INDEX IF NOT EXISTS "CandidatePaginationCursor_candidateSnapshotId_idx" ON "CandidatePaginationCursor"("candidateSnapshotId")',
    'CREATE INDEX IF NOT EXISTS "CandidatePaginationCursor_expiresAt_idx" ON "CandidatePaginationCursor"("expiresAt")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "SessionCartItem_sessionId_candidateItemId_key" ON "SessionCartItem"("sessionId", "candidateItemId")',
    'CREATE INDEX IF NOT EXISTS "SessionCartItem_sessionId_createdAt_idx" ON "SessionCartItem"("sessionId", "createdAt")',
    'CREATE INDEX IF NOT EXISTS "SessionCartItem_candidateItemId_idx" ON "SessionCartItem"("candidateItemId")',
    'CREATE INDEX IF NOT EXISTS "ProductImportChange_batchId_createdAt_idx" ON "ProductImportChange"("batchId", "createdAt")',
    'CREATE INDEX IF NOT EXISTS "ProductImportChange_productId_idx" ON "ProductImportChange"("productId")',
  ];
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

async function ensureProductImportChange() {
  if (await tableExists('ProductImportChange')) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductImportChange" (
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
    )
  `);
}

async function ensureProductPoolStatsSnapshot() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductPoolStatsSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "payloadJson" TEXT NOT NULL,
      "generatedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function normalizeProductCategoryScope() {
  if (!(await tableExists('Product'))) return;
  await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "category" = 'shoe'
    WHERE "category" IS NOT NULL
      AND (
        lower("category") IN (
          'shoe',
          'shoes',
          'sneaker',
          'sneakers',
          'boot',
          'boots',
          'sandal',
          'running_shoes',
          'basketball_shoes',
          'lifestyle_shoes',
          'training_shoes',
          'skate_shoes',
          'football_shoes',
          'unknown_shoes'
        )
        OR lower("category") LIKE '%shoe%'
      )
  `);
}

async function ensureQueryImagePreprocessSnapshot() {
  if (await tableExists('QueryImagePreprocessSnapshot')) return;
  await prisma.$executeRawUnsafe(`
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
      "embeddingVectorJson" TEXT NOT NULL DEFAULT '[]',
      "cropImageRefJson" TEXT NOT NULL DEFAULT '{}',
      "rawJson" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "QueryImagePreprocessSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "QueryImagePreprocessSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
}

async function ensureQueryImagePreprocessPaginationColumns() {
  if (!(await tableExists('QueryImagePreprocessSnapshot'))) return;
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("QueryImagePreprocessSnapshot")');
  const names = Array.isArray(columns) ? new Set(columns.map((column) => column.name)) : new Set();
  if (!names.has('embeddingVectorJson')) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "QueryImagePreprocessSnapshot" ADD COLUMN "embeddingVectorJson" TEXT NOT NULL DEFAULT \'[]\'',
    );
  }
}

async function ensureCandidateItemPaginationColumns() {
  if (!(await tableExists('CandidateItem'))) return;
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("CandidateItem")');
  const names = Array.isArray(columns) ? new Set(columns.map((column) => column.name)) : new Set();
  const statements = [
    ['rank', 'ALTER TABLE "CandidateItem" ADD COLUMN "rank" INTEGER'],
    ['pageIndex', 'ALTER TABLE "CandidateItem" ADD COLUMN "pageIndex" INTEGER'],
    ['productPoolKey', 'ALTER TABLE "CandidateItem" ADD COLUMN "productPoolKey" TEXT'],
  ];

  for (const [name, statement] of statements) {
    if (!names.has(name)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
}

async function ensureCandidatePaginationCursor() {
  if (await tableExists('CandidatePaginationCursor')) return;
  await prisma.$executeRawUnsafe(`
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
    )
  `);
}

async function ensureSessionCartItem() {
  if (await tableExists('SessionCartItem')) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SessionCartItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "candidateItemId" TEXT NOT NULL,
      "source" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SessionCartItem_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "QuerySession" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "SessionCartItem_candidateItemId_fkey"
        FOREIGN KEY ("candidateItemId") REFERENCES "CandidateItem" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
}

async function ensureProductImageEmbeddingMetadata() {
  if (!(await tableExists('ProductImageEmbedding'))) return;
  const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("ProductImageEmbedding")');
  const names = Array.isArray(columns) ? new Set(columns.map((column) => column.name)) : new Set();
  const statements = [
    ['styleId', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "styleId" TEXT'],
    ['imageRole', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "imageRole" TEXT NOT NULL DEFAULT \'main\''],
    ['embeddingKind', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "embeddingKind" TEXT NOT NULL DEFAULT \'multimodal\''],
    ['sourceImageUrl', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "sourceImageUrl" TEXT'],
    ['imageBucketGroup', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "imageBucketGroup" TEXT'],
    ['imageObjectKey', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "imageObjectKey" TEXT'],
    ['qualityScore', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "qualityScore" REAL'],
    ['preprocessJson', 'ALTER TABLE "ProductImageEmbedding" ADD COLUMN "preprocessJson" TEXT NOT NULL DEFAULT \'{}\''],
  ];

  for (const [name, statement] of statements) {
    if (!names.has(name)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
}

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    'table',
    tableName,
  );
  return Array.isArray(rows) && rows.length > 0;
}
