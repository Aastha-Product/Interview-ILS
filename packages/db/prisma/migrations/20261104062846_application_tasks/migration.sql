-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('TAILOR', 'PDF');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('QUEUED', 'WORKING', 'NEEDS_INPUT', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "GeneratedDocument" ADD COLUMN     "editedByStudent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pdfRenderedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ApplicationTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT NOT NULL,
    "bossJobId" TEXT,
    "documentId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationTask_idempotencyKey_key" ON "ApplicationTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApplicationTask_userId_state_idx" ON "ApplicationTask"("userId", "state");

-- CreateIndex
CREATE INDEX "ApplicationTask_applicationId_createdAt_idx" ON "ApplicationTask"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApplicationTask" ADD CONSTRAINT "ApplicationTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTask" ADD CONSTRAINT "ApplicationTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
