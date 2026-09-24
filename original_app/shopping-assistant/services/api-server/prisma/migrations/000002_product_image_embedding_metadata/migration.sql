ALTER TABLE "ProductImageEmbedding" ADD COLUMN "styleId" TEXT;
ALTER TABLE "ProductImageEmbedding" ADD COLUMN "imageRole" TEXT NOT NULL DEFAULT 'main';
ALTER TABLE "ProductImageEmbedding" ADD COLUMN "sourceImageUrl" TEXT;
ALTER TABLE "ProductImageEmbedding" ADD COLUMN "imageBucketGroup" TEXT;
ALTER TABLE "ProductImageEmbedding" ADD COLUMN "imageObjectKey" TEXT;
ALTER TABLE "ProductImageEmbedding" ADD COLUMN "qualityScore" REAL;

CREATE INDEX IF NOT EXISTS "ProductImageEmbedding_productId_styleId_idx" ON "ProductImageEmbedding"("productId", "styleId");
