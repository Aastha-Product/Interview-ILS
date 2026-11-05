export { getConfig, parseConfig, isDevSignInEnabled, ConfigError } from "./config";
export type { ServerConfig } from "./config";
export { getLogger } from "./logger";
export { UserFacingError } from "./errors";
export { hashIp, recordAudit } from "./audit";
export { istDay, createAiRecorder } from "./usage";
export * from "./profile/schema";
export { profileStrength } from "./profile/strength";
export type { ProfileStrength } from "./profile/strength";
export { draftToProfileInput } from "./profile/normalize";
export { getProfile, saveProfile, getPreferences, savePreferences } from "./profile/service";
export {
  getStorage,
  createLocalStorage,
  createMemoryStorage,
  createS3Storage,
} from "./storage";
export type { FileStorage } from "./storage";
export { exportAccount, deleteAccount, confirmsEmail, EXPORT_FORMAT } from "./account/service";
export type { AccountExport } from "./account/service";
export { enforceApiLimit, checkSignInLimit } from "./rate-limits";
export { importResume } from "./resume/import";
export type { ImportResumeResult } from "./resume/import";
export { extractResumeText, sniffResumeKind, MAX_RESUME_BYTES } from "./resume/extract";
// Matching track
export { scoreMatch, SCORER_VERSION, WEIGHTS } from "./matching/score";
export type { MatchInput, MatchResult, MatchGap, Factor } from "./matching/score";
export { ensureExtraction } from "./jobs/extraction";
export type { ExtractionView, ExtractionDeps } from "./jobs/extraction";
export { getMatch, listMatches } from "./jobs/match";
export type {
  MatchView,
  MatchGapView,
  MatchListItem,
  MatchDeps,
  JobListingSummary,
  RequirementsSummary,
} from "./jobs/match";
// Feeds and import
export { searchJobs, feedCacheKey } from "./jobs/search";
export type { SearchJobsDeps, SearchJobsResult } from "./jobs/search";
export { saveListing } from "./jobs/listings";
export { importJob, importJobInputSchema } from "./jobs/import";
export type { ImportJobInput, ImportJobResult } from "./jobs/import";
export { fetchJobPage, isPublicAddress, isAllowedByRobots, PageFetchError } from "./jobs/fetch-page";
export { parsePostingHtml, htmlToText } from "./jobs/posting";
export { incrementUsage } from "./usage";
// Applications (Phase 3)
export type * from "./applications/types";
export { QUEUE, QUEUE_SETTINGS, deadLetterQueue } from "./queue/names";
export type { QueueName, QueueSettings, TailorJobData, PdfJobData } from "./queue/names";
// Applications domain
export {
  APPLICATION_STATUSES,
  createApplication,
  getApplication,
  listApplications,
  updateApplication,
  saveDraftEdits,
  getLatestResumePdf,
} from "./applications/service";
export type { ApplicationView, ApplicationSummary, DocumentView, ApplicationJobView } from "./applications/service";
export { startApplication } from "./applications/start";
export { computeDashboard, getDashboard, istWeekStart } from "./applications/dashboard";
export type { Dashboard, WeekStats, DashboardRow } from "./applications/dashboard";
export { resumeContentSchema, answersContentSchema } from "./applications/draft-schema";
// Queue track
export { getBoss, ensureQueues, stopBoss } from "./queue/boss";
export type { BossOptions } from "./queue/boss";
export {
  enqueueTailor,
  enqueuePdf,
  getTasks,
  toTaskView,
  markTaskWorking,
  markTaskDone,
  markTaskFailed,
} from "./applications/tasks";
export type { TaskView, TaskLimits } from "./applications/tasks";
export { resumeToHtml, escapeHtml, safeHref } from "./pdf/resume-html";
export {
  authorizeLocalFileRequest,
  contentTypeForKey,
  safeFilename,
  signLocalFileUrl,
  verifyLocalFileUrl,
} from "./storage";
export type { LocalFileUrlCheck, LocalSigning, SignedUrlOptions } from "./storage";
// Drafting track
export { buildProfileFacts, dateRange } from "./applications/facts";
export { codeCheckBullet, factCheckResume, factCheckAnswers } from "./applications/fact-check";
export type {
  CheckResult,
  RemovedItem,
  FactCheckDeps,
  CodeCheckOptions,
  CheckedResume,
  CheckedAnswer,
} from "./applications/fact-check";
export { generateDrafts } from "./applications/tailor";
export type { GenerateDraftsDeps, GenerateDraftsResult } from "./applications/tailor";
