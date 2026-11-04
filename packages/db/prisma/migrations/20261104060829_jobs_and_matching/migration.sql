/*
  Warnings:

  - Added the required column `dedupeKey` to the `JobListing` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "JobExtraction" ADD COLUMN     "promptVersion" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "JobListing" ADD COLUMN     "applyUrl" TEXT,
ADD COLUMN     "dedupeKey" TEXT NOT NULL,
ADD COLUMN     "employmentType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "remote" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "JobMatch" ADD COLUMN     "breakdown" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "explanation" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "inputHash" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "FeedCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "source" "JobSource" NOT NULL,
    "listingIds" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedBudget" (
    "id" TEXT NOT NULL,
    "source" "JobSource" NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "liveCalls" INTEGER NOT NULL DEFAULT 0,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedCache_cacheKey_key" ON "FeedCache"("cacheKey");

-- CreateIndex
CREATE INDEX "FeedCache_expiresAt_idx" ON "FeedCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedBudget_source_day_key" ON "FeedBudget"("source", "day");

-- CreateIndex
CREATE INDEX "FeedSearch_userId_createdAt_idx" ON "FeedSearch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "JobListing_dedupeKey_createdAt_idx" ON "JobListing"("dedupeKey", "createdAt");

-- CreateIndex
CREATE INDEX "JobMatch_userId_score_idx" ON "JobMatch"("userId", "score");

-- AddForeignKey
ALTER TABLE "FeedSearch" ADD CONSTRAINT "FeedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
