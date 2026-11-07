-- Pathfinder: students sign in with Firebase Authentication; its stable user id links them.
ALTER TABLE "User" ADD COLUMN "firebaseUid" TEXT;

CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");
