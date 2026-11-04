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
