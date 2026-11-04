import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The single .env file lives at the repo root.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // `prisma generate` does not need a database, so a placeholder keeps it working in CI.
    url: process.env.DATABASE_URL ?? "postgresql://placeholder@localhost:5432/placeholder",
  },
});
