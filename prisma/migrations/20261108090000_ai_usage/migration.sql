-- Pathfinder: AI requests each student made on the server's shared key, per day (IST), for
-- PATHFINDER_AI_DAILY_LIMIT. Owned like every other student table.
CREATE TABLE "AiUsage" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("userId","day")
);

ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
