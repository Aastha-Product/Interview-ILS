-- Pathfinder: the Job table is the queue (P0 task 3). Workers claim queued jobs with FOR UPDATE SKIP LOCKED,
-- note which worker runs each one and when it last said it was alive, and see a cancel asked for elsewhere.
ALTER TABLE "Job" ADD COLUMN "workerId" TEXT;
ALTER TABLE "Job" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false;

-- The claim reads queued jobs oldest first.
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");
