-- Pathfinder (Phase 4): each student's plan and when a paid one ends (src/lib/plans.ts).
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "User" ADD COLUMN "planUntil" TIMESTAMP(3);
