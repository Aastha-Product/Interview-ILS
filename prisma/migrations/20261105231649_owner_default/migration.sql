-- Pathfinder: the owner column of every student table defaults to the database setting
-- app.user_id, which the app never sets. A write that skips the owner scope therefore fails
-- ("unrecognized configuration parameter") instead of storing a row without an owner.

-- AlterTable
ALTER TABLE "AgentCandidate" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Application" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "ChatMessage" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "ClaudePaste" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "DocumentVersion" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Education" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "EmailMessage" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Experience" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "ExperienceSkill" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Fact" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "GoogleAccount" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Language" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Note" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Posting" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "PostingScore" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "PostingSearch" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "ProfileField" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "ProjectSkill" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Publication" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Reference" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Setting" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Skill" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "Startup" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "StartupBlock" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

-- AlterTable
ALTER TABLE "StatusEvent" ALTER COLUMN "userId" SET DEFAULT current_setting('app.user_id');

