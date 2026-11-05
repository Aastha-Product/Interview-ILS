-- Pathfinder: feedback from testers, owned by the student who sent it.
CREATE TABLE "Feedback" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
