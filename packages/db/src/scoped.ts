import type { PrismaClient } from "./generated/prisma/client";
import { getPrisma } from "./client";

/**
 * Models whose rows belong to one user. Every one of them has a `userId` column.
 * When you add a user-owned model to schema.prisma, add it here too
 * (the integration test "every model with userId is scoped" fails otherwise).
 */
export const USER_OWNED_MODELS = new Set([
  "Profile",
  "Experience",
  "Project",
  "Education",
  "Skill",
  "ResumeFile",
  "JobPreference",
  "JobMatch",
  "Application",
  "ApplicationEvent",
  "GeneratedDocument",
  "AiRun",
  "UsageRecord",
  "AuditLog",
  "FeedSearch",
  "ApplicationTask",
  "StoredFile",
]);

/** Shared models any signed-in user may read, minus their user-owned relations. */
export const SHARED_MODELS = new Set(["JobListing", "JobExtraction", "FeedCache", "FeedBudget"]);

/**
 * Relations on shared models that point at user-owned rows (JobListing.matches and
 * JobListing.applications). Reading them at any depth of an include/select would leak other
 * users' rows, so they are refused everywhere.
 */
const BLOCKED_RELATION_KEYS = new Set(["matches", "applications"]);

/** Keys that mark a nested relation write. Nested writes skip the owner check, so they are refused. */
const NESTED_WRITE_KEYS = new Set([
  "create",
  "createMany",
  "connect",
  "connectOrCreate",
  "upsert",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "set",
  "disconnect",
]);

/** Auth.js tables. Only the auth adapter (raw client) may touch these. */
const AUTH_MODELS = new Set(["Account", "Session", "VerificationToken"]);

/** Cross-user infrastructure (rate-limit counters keyed by user id or IP hash). Only packages/db touches these. */
export const INTERNAL_MODELS = new Set(["RateLimit"]);

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeViolationError";
  }
}

type Args = Record<string, unknown>;

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

function assertNoBlockedRelations(tree: unknown, model: string): void {
  if (!tree || typeof tree !== "object") return;
  for (const [key, value] of Object.entries(tree as Args)) {
    if (BLOCKED_RELATION_KEYS.has(key) && value) {
      throw new ScopeViolationError(
        `Cannot read ${key} through ${model}: they belong to other users`,
      );
    }
    assertNoBlockedRelations(value, model);
  }
}

function assertNoNestedWrites(data: unknown, model: string): void {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const value of Object.values(row as Args)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (Object.keys(value).some((k) => NESTED_WRITE_KEYS.has(k))) {
          throw new ScopeViolationError(`Nested relation writes on ${model} are not allowed`);
        }
      }
    }
  }
}

function assertNoUserIdChange(data: unknown, model: string): void {
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (row && typeof row === "object" && ("userId" in row || "user" in row)) {
      throw new ScopeViolationError(`Changing the owner of a ${model} row is not allowed`);
    }
  }
}

/**
 * Adds an owner condition with AND rather than overwriting the caller's filter, so a query that
 * names someone else's id or userId matches nothing instead of silently returning your own rows.
 * AND is accepted by unique lookups (findUnique, update, delete, upsert) as well.
 */
function andWhere(where: unknown, condition: Args): Args {
  const base = (where as Args | undefined) ?? {};
  const existing = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...existing, condition] };
}

function withUser(data: unknown, userId: string, model: string): unknown {
  if (Array.isArray(data)) return data.map((row) => withUser(row, userId, model));
  if (!data || typeof data !== "object") return data;
  if ("user" in data) {
    throw new ScopeViolationError(`Set the owner of ${model} through the scoped client only`);
  }
  return { ...(data as Args), userId };
}

/** Exported for unit tests. Rewrites query arguments so they can only touch `userId`'s rows. */
export function scopeArgs(
  model: string,
  operation: string,
  rawArgs: unknown,
  userId: string,
): Args {
  const args: Args = { ...((rawArgs as Args | undefined) ?? {}) };

  if (AUTH_MODELS.has(model)) {
    throw new ScopeViolationError(`${model} is only accessible to the auth adapter`);
  }
  if (INTERNAL_MODELS.has(model)) {
    throw new ScopeViolationError(
      `${model} is internal and not reachable through the scoped client`,
    );
  }

  assertNoBlockedRelations(args.include, model);
  assertNoBlockedRelations(args.select, model);
  assertNoNestedWrites(args.data, model);
  assertNoNestedWrites(args.create, model);
  assertNoNestedWrites(args.update, model);

  if (SHARED_MODELS.has(model)) {
    // Writes to shared job data go through the raw client in the ingest code, not user requests.
    if (!READ_OPS.has(operation)) {
      throw new ScopeViolationError(
        `${model}.${operation} is not allowed through the scoped client`,
      );
    }
    return args;
  }

  if (model === "User") {
    // A user can see and update only themselves. Creating and deleting users is done elsewhere.
    if (WHERE_OPS.has(operation) && !operation.startsWith("delete")) {
      if (!READ_OPS.has(operation)) assertNoUserIdChange(args.data, model);
      args.where = andWhere(args.where, { id: userId });
      return args;
    }
    throw new ScopeViolationError(`User.${operation} is not allowed through the scoped client`);
  }

  if (!USER_OWNED_MODELS.has(model)) {
    // Fail closed: a model nobody classified is not reachable.
    throw new ScopeViolationError(`Model ${model} is not classified as user-owned or shared`);
  }

  if (WHERE_OPS.has(operation)) {
    if (!READ_OPS.has(operation)) assertNoUserIdChange(args.data, model);
    args.where = andWhere(args.where, { userId });
    return args;
  }

  switch (operation) {
    case "create":
    case "createMany":
    case "createManyAndReturn":
      args.data = withUser(args.data, userId, model);
      return args;
    case "upsert":
      assertNoUserIdChange(args.update, model);
      args.where = andWhere(args.where, { userId });
      args.create = withUser(args.create, userId, model);
      return args;
    default:
      throw new ScopeViolationError(`Operation ${model}.${operation} is not supported when scoped`);
  }
}

function buildScopedClient(base: PrismaClient, userId: string) {
  return base.$extends({
    name: "user-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args, userId) as typeof args);
        },
      },
    },
  });
}

type Extended = ReturnType<typeof buildScopedClient>;

/** A database client that can only see and change one user's rows. Raw SQL is not available on it. */
export type ScopedDb = Omit<
  Extended,
  "$queryRaw" | "$queryRawUnsafe" | "$executeRaw" | "$executeRawUnsafe" | "$connect" | "$disconnect"
> & { readonly userId: string };

/** The client handed to an interactive transaction callback. */
export type ScopedTx = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];

export function scopedDb(userId: string, base: PrismaClient = getPrisma()): ScopedDb {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new ScopeViolationError("scopedDb needs a signed-in user id");
  }
  const client = buildScopedClient(base, userId);
  const blocked = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "userId") return userId;
      if (typeof prop === "string" && blocked.has(prop)) {
        throw new ScopeViolationError(`${prop} is not available on the scoped client`);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as ScopedDb;
}
