-- Pathfinder (auto-apply step 1): the job queue gains worker pools, priorities and automatic retries
-- with a wait between them, and a shared rate limit per outside service.
ALTER TABLE "Job" ADD COLUMN "queue" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Job" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Job" ADD COLUMN "runAfter" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "lastError" TEXT;

-- The claim skips queued jobs still waiting to be retried.
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

CREATE TABLE "ProviderBudget" (
    "provider" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderBudget_pkey" PRIMARY KEY ("provider")
);
