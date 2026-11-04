export { scopedDb, ScopeViolationError, USER_OWNED_MODELS, SHARED_MODELS } from "./scoped";
export type { ScopedDb, ScopedTx } from "./scoped";
export {
  Prisma,
  AuditAction,
  ExperienceLevel,
  ApplicationStatus,
  JobSource,
  DocumentKind,
  TaskKind,
  TaskState,
} from "./generated/prisma/client";
export type {
  User,
  Profile,
  Experience,
  Project,
  Education,
  Skill,
  ResumeFile,
  JobPreference,
  Application,
  ApplicationTask,
  GeneratedDocument,
} from "./generated/prisma/client";
