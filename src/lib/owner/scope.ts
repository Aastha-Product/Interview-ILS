import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Private accounts (Pathfinder). Every table that holds a student's data has an owner (userId).
 * `scopedClient` wraps the database client so every query only sees and changes the current
 * student's rows, and every row it creates, nested ones included, belongs to them. Existing code
 * keeps calling `prisma.application.findMany()` and gets only that student's applications.
 *
 * Where code looks a row up by a key that used to be unique for the single owner (a setting key,
 * a skill name, the Google account), it now names the owner too, with CURRENT_USER standing in
 * for the student: `where: { userId_key: { userId: CURRENT_USER, key } }`. The scope fills it in.
 *
 * Safety net: the owner columns default to the database setting app.user_id, which is never set,
 * so a write that somehow skipped this scope fails instead of storing a row without an owner.
 */

/** Stands in for the current student's id in compound keys; replaced before the query runs. */
export const CURRENT_USER = "__pathfinder_current_user__";

/** Tables holding one student's data (keep in step with prisma/schema.prisma; a test checks it). */
export const OWNED_MODELS = new Set([
  "ProfileField", "Skill", "Language", "Experience", "ExperienceSkill", "Project", "ProjectSkill",
  "Education", "Publication", "Reference", "Fact", "Theme", "Setting", "Application", "StatusEvent",
  "Document", "DocumentVersion", "ChatMessage", "Note", "Posting", "ClaudePaste", "AgentCandidate",
  "PostingScore", "PostingSearch", "Startup", "StartupBlock", "GoogleAccount", "EmailMessage", "Job",
]);

/** Tables only system code may touch, through the unscoped client. */
export const SYSTEM_MODELS = new Set(["User", "LoginThrottle"]);

export class OwnerScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerScopeError";
  }
}

type Args = Record<string, unknown>;

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate",
  "groupBy", "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany",
]);
const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
]);
const NESTED_WRITE_KEYS = ["create", "createMany", "connectOrCreate", "upsert", "update", "updateMany", "set", "connect"];

/**
 * Plain objects only. Values like Prisma.DbNull, Decimal, Date or bytes are class instances and
 * must reach Prisma untouched, so the scope never walks into or copies them.
 */
const isObject = (v: unknown): v is Args => {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Replaces CURRENT_USER anywhere inside a value with the student's id. */
export function fillCurrentUser<T>(value: T, userId: string): T {
  if (value === CURRENT_USER) return userId as T;
  if (Array.isArray(value)) return value.map((v) => fillCurrentUser(v, userId)) as T;
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillCurrentUser(v, userId)])) as T;
  }
  return value;
}

/**
 * True when a create payload links its parent rows with relation objects (Prisma's "checked"
 * form, e.g. `application: { connect: { id } }`) rather than plain ids (`applicationId`). Then the
 * owner must be given the same way. Creating children inside (`documents: { create: [...] }`)
 * is allowed in both forms, so it doesn't count.
 */
function usesRelationObjects(payload: Args): boolean {
  return Object.values(payload).some((v) => isObject(v) && ("connect" in v || "connectOrCreate" in v) && !Array.isArray(v.connect));
}

/** Gives a create payload (and everything it creates inside it) the student as owner. */
export function withOwner(payload: unknown, userId: string): unknown {
  if (Array.isArray(payload)) return payload.map((p) => withOwner(p, userId));
  if (!isObject(payload)) return payload;
  const out: Args = withNestedOwners(payload, userId);
  // An owner given by the caller is replaced, never trusted.
  delete out.user;
  delete out.userId;
  // Prisma takes either plain ids (userId) or relation objects (user: { connect }), not a mix.
  if (usesRelationObjects(out)) out.user = { connect: { id: userId } };
  else out.userId = userId;
  return out;
}

/** Walks a data object and gives every nested create the student as owner. */
function withNestedOwners(data: Args, userId: string): Args {
  const out: Args = {};
  for (const [key, value] of Object.entries(data)) {
    if (!isObject(value) || !NESTED_WRITE_KEYS.some((k) => k in value) || key === "user") {
      out[key] = value;
      continue;
    }
    const nested: Args = { ...value };
    if ("create" in nested) nested.create = withOwner(nested.create, userId);
    if (isObject(nested.createMany)) {
      nested.createMany = { ...nested.createMany, data: withOwner((nested.createMany as Args).data, userId) };
    }
    const mapEach = (v: unknown, fn: (x: Args) => Args) => (Array.isArray(v) ? v.map((x) => fn(x as Args)) : fn(v as Args));
    if ("connectOrCreate" in nested) {
      nested.connectOrCreate = mapEach(nested.connectOrCreate, (c) => ({ ...c, create: withOwner(c.create, userId) }));
    }
    if ("upsert" in nested) {
      nested.upsert = mapEach(nested.upsert, (u) => ({
        ...u,
        create: withOwner(u.create, userId),
        update: isObject(u.update) ? withNestedOwners(u.update, userId) : u.update,
      }));
    }
    if ("update" in nested) {
      nested.update = mapEach(nested.update, (u) =>
        isObject(u.data) ? { ...u, data: withNestedOwners(u.data as Args, userId) } : withNestedOwners(u, userId),
      );
    }
    out[key] = nested;
  }
  return out;
}

function andWhere(where: unknown, condition: Args): Args {
  const base = isObject(where) ? where : {};
  const existing = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...existing, condition] };
}

function assertOwnerUnchanged(data: unknown, model: string): void {
  for (const row of Array.isArray(data) ? data : [data]) {
    if (isObject(row) && ("userId" in row || "user" in row)) {
      throw new OwnerScopeError(`Changing the owner of a ${model} row is not allowed`);
    }
  }
}

/** Rewrites one query's arguments so it can only touch `userId`'s rows. Exported for tests. */
export function scopeArgs(model: string, operation: string, rawArgs: unknown, userId: string): Args {
  if (SYSTEM_MODELS.has(model)) {
    throw new OwnerScopeError(`${model} is only reachable through the system client`);
  }
  if (!OWNED_MODELS.has(model)) {
    throw new OwnerScopeError(`Model ${model} is not classified as owned or system`);
  }
  const args: Args = fillCurrentUser({ ...((rawArgs as Args | undefined) ?? {}) }, userId);
  const reading = READ_OPS.has(operation);
  // Built-in themes (no owner) are shared: everyone may read them, nobody may change them here.
  const owner = model === "Theme" && reading ? { OR: [{ userId }, { userId: null }] } : { userId };

  if (WHERE_OPS.has(operation)) {
    args.where = andWhere(args.where, owner);
    if (!reading && args.data !== undefined) {
      assertOwnerUnchanged(args.data, model);
      args.data = Array.isArray(args.data) ? args.data : withNestedOwners(args.data as Args, userId);
    }
    return args;
  }
  switch (operation) {
    case "create":
    case "createMany":
    case "createManyAndReturn":
      args.data = withOwner(args.data, userId);
      return args;
    case "upsert":
      assertOwnerUnchanged(args.update, model);
      args.where = andWhere(args.where, { userId });
      args.create = withOwner(args.create, userId);
      args.update = isObject(args.update) ? withNestedOwners(args.update, userId) : args.update;
      return args;
    default:
      throw new OwnerScopeError(`Operation ${model}.${operation} is not supported in the owner scope`);
  }
}

/** Resolves the current student's id, or throws when there is none. */
export type OwnerResolver = () => Promise<string>;

const RAW = Symbol.for("pathfinder.rawClient");

/**
 * The database client limited to one student. `owner` is asked on every query, so one client can
 * serve every request (each request resolves its own student). Raw SQL isn't available on it.
 */
export function scopedClient(base: PrismaClient, owner: OwnerResolver): PrismaClient {
  const extended = base.$extends({
    name: "owner-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const userId = await owner();
          return query(scopeArgs(model, operation, args, userId) as typeof args);
        },
      },
    },
  });
  const blocked = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === RAW) return base;
      if (typeof prop === "string" && blocked.has(prop)) {
        throw new OwnerScopeError(`${prop} is not available on the owner-scoped client; use the system client`);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as PrismaClient;
}

/** The unscoped client behind a scoped one (for test helpers and system code). */
export function rawClientOf(client: PrismaClient): PrismaClient {
  return ((client as unknown as Record<symbol, PrismaClient>)[RAW] ?? client) as PrismaClient;
}
