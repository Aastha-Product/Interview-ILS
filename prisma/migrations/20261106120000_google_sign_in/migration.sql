-- Pathfinder: students sign in with Google; their Google account id links them to their account.
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
