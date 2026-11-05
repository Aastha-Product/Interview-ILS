-- Pathfinder: private accounts. Adds User and an owner (userId) to every table that holds a
-- student's data, and makes single-owner keys (setting keys, skill names, Gmail ids, posting keys)
-- unique per owner. Written for new, empty databases: an existing single-owner install needs its
-- rows given an owner first (not part of this migration).

-- DropIndex
DROP INDEX "AgentCandidate_dedupeKey_key";

-- DropIndex
DROP INDEX "AgentCandidate_source_externalId_key";

-- DropIndex
DROP INDEX "EmailMessage_gmailId_key";

-- DropIndex
DROP INDEX "Language_name_key";

-- DropIndex
DROP INDEX "Posting_source_externalId_key";

-- DropIndex
DROP INDEX "Skill_name_key";

-- DropIndex
DROP INDEX "Startup_source_externalId_key";

-- AlterTable
ALTER TABLE "AgentCandidate" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ClaudePaste" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Education" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Experience" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ExperienceSkill" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Fact" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "GoogleAccount" DROP CONSTRAINT "GoogleAccount_pkey",
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("userId", "id");

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Language" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Posting" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PostingScore" DROP CONSTRAINT "PostingScore_pkey",
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "PostingScore_pkey" PRIMARY KEY ("userId", "source", "externalId");

-- AlterTable
ALTER TABLE "PostingSearch" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ProfileField" DROP CONSTRAINT "ProfileField_pkey",
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "ProfileField_pkey" PRIMARY KEY ("userId", "key");

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ProjectSkill" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Reference" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey",
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("userId", "key");

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Startup" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StartupBlock" DROP CONSTRAINT "StartupBlock_pkey",
ADD COLUMN     "userId" TEXT NOT NULL,
ADD CONSTRAINT "StartupBlock_pkey" PRIMARY KEY ("userId", "hash");

-- AlterTable
ALTER TABLE "StatusEvent" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidate_userId_source_externalId_key" ON "AgentCandidate"("userId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidate_userId_dedupeKey_key" ON "AgentCandidate"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Application_userId_idx" ON "Application"("userId");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId");

-- CreateIndex
CREATE INDEX "ClaudePaste_userId_idx" ON "ClaudePaste"("userId");

-- CreateIndex
CREATE INDEX "Document_userId_idx" ON "Document"("userId");

-- CreateIndex
CREATE INDEX "DocumentVersion_userId_idx" ON "DocumentVersion"("userId");

-- CreateIndex
CREATE INDEX "Education_userId_idx" ON "Education"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_userId_gmailId_key" ON "EmailMessage"("userId", "gmailId");

-- CreateIndex
CREATE INDEX "Experience_userId_idx" ON "Experience"("userId");

-- CreateIndex
CREATE INDEX "ExperienceSkill_userId_idx" ON "ExperienceSkill"("userId");

-- CreateIndex
CREATE INDEX "Fact_userId_idx" ON "Fact"("userId");

-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Language_userId_name_key" ON "Language"("userId", "name");

-- CreateIndex
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Posting_userId_source_externalId_key" ON "Posting"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX "PostingSearch_userId_idx" ON "PostingSearch"("userId");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "ProjectSkill_userId_idx" ON "ProjectSkill"("userId");

-- CreateIndex
CREATE INDEX "Publication_userId_idx" ON "Publication"("userId");

-- CreateIndex
CREATE INDEX "Reference_userId_idx" ON "Reference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_userId_name_key" ON "Skill"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Startup_userId_source_externalId_key" ON "Startup"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX "StatusEvent_userId_idx" ON "StatusEvent"("userId");

-- CreateIndex
CREATE INDEX "Theme_userId_idx" ON "Theme"("userId");

-- AddForeignKey
ALTER TABLE "ProfileField" ADD CONSTRAINT "ProfileField_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Language" ADD CONSTRAINT "Language_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceSkill" ADD CONSTRAINT "ExperienceSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Education" ADD CONSTRAINT "Education_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudePaste" ADD CONSTRAINT "ClaudePaste_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCandidate" ADD CONSTRAINT "AgentCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingScore" ADD CONSTRAINT "PostingScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingSearch" ADD CONSTRAINT "PostingSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Startup" ADD CONSTRAINT "Startup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StartupBlock" ADD CONSTRAINT "StartupBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

