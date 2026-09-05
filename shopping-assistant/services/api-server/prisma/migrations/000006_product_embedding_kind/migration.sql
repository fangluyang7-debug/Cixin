ALTER TABLE "ProductImageEmbedding" ADD COLUMN "embeddingKind" TEXT NOT NULL DEFAULT 'multimodal';

CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_productId_embeddingKind_idx" ON "ProductImageEmbedding"("productId", "embeddingKind");
CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_idx" ON "ProductImageEmbedding"("embeddingKind");
CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_embeddingKind_provider_dimension_idx" ON "ProductImageEmbedding"("embeddingKind", "provider", "dimension");
