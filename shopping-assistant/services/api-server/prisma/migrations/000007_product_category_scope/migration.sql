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
  );

CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product"("category");
