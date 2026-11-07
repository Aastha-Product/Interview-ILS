-- Pathfinder: sessions carry this version; signing out raises it, so a copied session cookie stops working (QA M-4).
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
