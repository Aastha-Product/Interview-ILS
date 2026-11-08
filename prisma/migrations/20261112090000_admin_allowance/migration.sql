-- Pathfinder: a daily AI allowance an admin sets for one student (null: the server's default).
ALTER TABLE "User" ADD COLUMN "aiDailyLimit" INTEGER;
