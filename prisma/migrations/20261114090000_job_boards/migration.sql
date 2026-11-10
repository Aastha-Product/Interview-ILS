-- Pathfinder (auto-apply step 2): companies whose public job boards the crawler reads, and the jobs
-- it finds there, shared by every student.
CREATE TYPE "BoardSystem" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY', 'SMARTRECRUITERS');

CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" "BoardSystem" NOT NULL,
    "boardToken" TEXT NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY['in']::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextCrawlAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crawlingUntil" TIMESTAMP(3),
    "lastCrawledAt" TIMESTAMP(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "openJobs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SharedPosting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "system" "BoardSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "remote" BOOLEAN,
    "employmentType" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "salary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "applyUrl" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "SharedPosting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_system_boardToken_key" ON "Company"("system", "boardToken");
CREATE INDEX "Company_active_nextCrawlAt_idx" ON "Company"("active", "nextCrawlAt");
CREATE UNIQUE INDEX "SharedPosting_companyId_externalId_key" ON "SharedPosting"("companyId", "externalId");
CREATE INDEX "SharedPosting_closedAt_country_idx" ON "SharedPosting"("closedAt", "country");
CREATE INDEX "SharedPosting_dedupeKey_idx" ON "SharedPosting"("dedupeKey");

ALTER TABLE "SharedPosting" ADD CONSTRAINT "SharedPosting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
