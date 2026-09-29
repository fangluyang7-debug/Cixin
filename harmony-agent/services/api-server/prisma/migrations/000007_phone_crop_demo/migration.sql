ALTER TABLE "PhoneDispatchJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'vector.norm.demo';
ALTER TABLE "PhoneDispatchJob" ADD COLUMN "resultJson" TEXT;
