/**
 * Unscoped database access. Only the auth adapter, account deletion, migrations and tests may use
 * this entry point; ESLint blocks importing `@pathfinder/db/raw` anywhere else.
 */
export { getPrisma, createPrismaClient, setPrismaForTests } from "./client";
