-- Pathfinder (auto-apply step 4): what each student allowed auto-apply to do, and the applications
-- it prepares and submits for them. Both owned like every other student table.
ALTER TYPE "ApplicationOrigin" ADD VALUE 'AUTO_APPLY';

CREATE TYPE "ApplyState" AS ENUM ('PREPARING', 'READY', 'LEASED', 'SUBMITTING', 'APPLIED', 'NEEDS_STUDENT', 'UNCERTAIN', 'FAILED', 'SKIPPED');

CREATE TABLE "AutoApplySettings" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "preferences" JSONB,
    "minTier" "MatchTier" NOT NULL DEFAULT 'GOOD',
    "dailyLimit" INTEGER NOT NULL DEFAULT 10,
    "perCompanyLimit" INTEGER NOT NULL DEFAULT 2,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoApplySettings_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "ApplyTask" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "id" TEXT NOT NULL,
    "jobMatchId" TEXT NOT NULL,
    "sharedPostingId" TEXT NOT NULL,
    "applicationId" TEXT,
    "state" "ApplyState" NOT NULL DEFAULT 'PREPARING',
    "answers" JSONB,
    "reason" TEXT,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplyTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplyTask_jobMatchId_key" ON "ApplyTask"("jobMatchId");
CREATE UNIQUE INDEX "ApplyTask_applicationId_key" ON "ApplyTask"("applicationId");
-- One task per student and job, ever: the first guard against applying twice.
CREATE UNIQUE INDEX "ApplyTask_userId_sharedPostingId_key" ON "ApplyTask"("userId", "sharedPostingId");
CREATE INDEX "ApplyTask_userId_state_idx" ON "ApplyTask"("userId", "state");

ALTER TABLE "AutoApplySettings" ADD CONSTRAINT "AutoApplySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplyTask" ADD CONSTRAINT "ApplyTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplyTask" ADD CONSTRAINT "ApplyTask_jobMatchId_fkey" FOREIGN KEY ("jobMatchId") REFERENCES "JobMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplyTask" ADD CONSTRAINT "ApplyTask_sharedPostingId_fkey" FOREIGN KEY ("sharedPostingId") REFERENCES "SharedPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplyTask" ADD CONSTRAINT "ApplyTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
