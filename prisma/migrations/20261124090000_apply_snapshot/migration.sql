-- Pathfinder (Phase 3): what the job page said when an application stopped short of applied.
ALTER TABLE "ApplyTask" ADD COLUMN "snapshot" JSONB;
ALTER TABLE "ApplyTask" ADD COLUMN "snapshotAt" TIMESTAMP(3);
