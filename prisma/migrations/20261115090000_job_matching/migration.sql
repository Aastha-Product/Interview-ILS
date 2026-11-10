-- Pathfinder (auto-apply step 3): matching shared jobs to students.

-- Full-text search over the shared jobs, kept up to date by the database itself: the title counts
-- most, then the department, then the description (its first 20,000 characters, which is where
-- the requirements are). Prisma can't describe a generated column, so it isn't in schema.prisma;
-- src/lib/match/rank.ts reads it with raw SQL.
ALTER TABLE "SharedPosting" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("department", '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce("description", ''), 20000)), 'C')
) STORED;

CREATE INDEX "SharedPosting_search_idx" ON "SharedPosting" USING GIN ("search");

CREATE TYPE "MatchTier" AS ENUM ('STRONG', 'GOOD', 'PARTIAL', 'NOT_RECOMMENDED');

CREATE TYPE "MatchStatus" AS ENUM ('RANKED', 'SCORED', 'FAILED');

-- A shared job shortlisted for one student. Owned like every other student table.
CREATE TABLE "JobMatch" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "id" TEXT NOT NULL,
    "sharedPostingId" TEXT NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'RANKED',
    "score" INTEGER,
    "tier" "MatchTier",
    "reasons" JSONB,
    "redFlags" JSONB,
    "scoredWith" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobMatch_userId_sharedPostingId_key" ON "JobMatch"("userId", "sharedPostingId");

CREATE INDEX "JobMatch_userId_tier_idx" ON "JobMatch"("userId", "tier");

CREATE INDEX "JobMatch_sharedPostingId_idx" ON "JobMatch"("sharedPostingId");

ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobMatch" ADD CONSTRAINT "JobMatch_sharedPostingId_fkey" FOREIGN KEY ("sharedPostingId") REFERENCES "SharedPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
