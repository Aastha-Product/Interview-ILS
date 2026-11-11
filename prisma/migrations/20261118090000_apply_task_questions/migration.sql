-- Pathfinder (auto-apply): the questions an application is waiting on, so the student can answer
-- them on the Auto-apply page instead of in the job site's tab.
ALTER TABLE "ApplyTask" ADD COLUMN "questions" JSONB NOT NULL DEFAULT '[]';
