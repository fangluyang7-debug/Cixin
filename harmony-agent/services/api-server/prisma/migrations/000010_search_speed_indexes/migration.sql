CREATE INDEX IF NOT EXISTS "ImageAsset_bucketGroup_objectKey_idx" ON "ImageAsset"("bucketGroup", "objectKey");
CREATE INDEX IF NOT EXISTS "ImageAsset_assetGroupId_variantType_idx" ON "ImageAsset"("assetGroupId", "variantType");

CREATE INDEX IF NOT EXISTS "QueryImagePreprocessSnapshot_sessionId_status_createdAt_idx" ON "QueryImagePreprocessSnapshot"("sessionId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "Product_platform_externalId_idx" ON "Product"("platform", "externalId");
CREATE INDEX IF NOT EXISTS "Product_tagStatus_category_idx" ON "Product"("tagStatus", "category");
CREATE INDEX IF NOT EXISTS "Product_tagStatus_platform_idx" ON "Product"("tagStatus", "platform");
CREATE INDEX IF NOT EXISTS "Product_tagStatus_updatedAt_idx" ON "Product"("tagStatus", "updatedAt");

CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_provider_dimension_id_idx" ON "ProductImageEmbedding"("embeddingKind", "provider", "dimension", "id");
CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_provider_dimension_productId_idx" ON "ProductImageEmbedding"("embeddingKind", "provider", "dimension", "productId");
