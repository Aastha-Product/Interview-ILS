-- Pathfinder (Phase 3): recruiter outreach, one email (and one follow-up) per application. Owned like every other student table.
CREATE TABLE "Outreach" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "linkedinNote" TEXT NOT NULL DEFAULT '',
    "followUpBody" TEXT NOT NULL DEFAULT '',
    "threadId" TEXT,
    "sentAt" TIMESTAMP(3),
    "followUpSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Outreach_applicationId_key" ON "Outreach"("applicationId");
CREATE INDEX "Outreach_userId_idx" ON "Outreach"("userId");

ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
