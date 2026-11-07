-- Pathfinder: resume analyses (upload → results), owned like every other student table.
CREATE TABLE "ResumeAnalysis" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "profile" JSONB NOT NULL,
    "review" JSONB NOT NULL,
    "readWith" TEXT NOT NULL DEFAULT '',
    "profileFilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResumeAnalysis_userId_createdAt_idx" ON "ResumeAnalysis"("userId", "createdAt");

ALTER TABLE "ResumeAnalysis" ADD CONSTRAINT "ResumeAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
