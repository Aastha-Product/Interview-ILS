-- Pathfinder (auto-apply step 5): browsers' Pathfinder extensions, connected to a student. Only a
-- hash of each token is kept. Owned like every other student table.
CREATE TABLE "ExtensionToken" (
    "userId" TEXT NOT NULL DEFAULT current_setting('app.user_id'),
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ExtensionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExtensionToken_tokenHash_key" ON "ExtensionToken"("tokenHash");
CREATE INDEX "ExtensionToken_userId_idx" ON "ExtensionToken"("userId");

ALTER TABLE "ExtensionToken" ADD CONSTRAINT "ExtensionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
