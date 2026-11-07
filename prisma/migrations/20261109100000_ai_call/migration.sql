-- Pathfinder: the AI cost log. One row per call on the server's shared key: task, model, tokens
-- and cost, never the prompt or the answer. Owned like every other student table.
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiCall_userId_createdAt_idx" ON "AiCall"("userId", "createdAt");

CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
